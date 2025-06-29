import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { ClientService } from '../../clients/client.service';
import { TelegramService } from '../../telegram/telegram.service';
import { Client } from '../../clients/schemas/client.schema';
import {
  ActiveConnection,
  ConnectionInfo,
  ClientWithDetails
} from '../interfaces/connection-manager.interfaces';
import { ConnectionManagerConfig } from '../config/connection-manager.config';

@Injectable()
export class ClientManagementService {
  private readonly logger = new Logger(ClientManagementService.name);
  private activeConnections = new Map<string, ActiveConnection>();
  private availableMobilePool = new Map<string, Client>(); // Maps mobile number to client info

  constructor(
    private readonly clientService: ClientService,
    private readonly telegramService: TelegramService,
  ) {}

  /**
   * Get active clients (simplified)
   */
  async getActiveClients(){
    this.logger.debug('Fetching active clients from client service');
    const activeConnections = await this.clientService.getActiveClients();
    return activeConnections;
  }

  /**
   * Create or update a Telegram client (simplified)
   */
  async createOrUpdateTelegramClient(
    mobile: string,
    clientInfo: Client
  ): Promise<ActiveConnection | null> {
    this.logger.debug(`Starting client creation/update for mobile: ${mobile?.substring(0, 6)}***`);

    const trimmed = mobile?.trim();
    if (!trimmed) {
      this.logger.error('Invalid mobile number provided - empty or null value');
      return null;
    }

    this.logger.debug(`Attempting to connect Telegram client for mobile: ${trimmed.substring(0, 6)}*** (clientId: ${clientInfo.clientId})`);

    try {
      const telegramClientInfo = await this.telegramService.getClient(trimmed, {
        autoDisconnect: false,
        handler: true,
        timeout: ConnectionManagerConfig.CONNECTION_TIMEOUT,
      });

      if (!telegramClientInfo || !telegramClientInfo.client) {
        this.logger.error(`TelegramService did not return a valid client for ${trimmed.substring(0, 6)}*** (clientId: ${clientInfo.clientId})`);
        return null;
      }

      const active: ActiveConnection = {
        telegramClient: telegramClientInfo.client,
        clientInfo: telegramClientInfo,
        clientId: clientInfo.clientId,
        isActive: true,
        mobile: trimmed,
        lastHealthCheck: new Date(),
        createdAt: new Date(),
      };

      this.activeConnections.set(trimmed, active);
      this.logger.debug(`Added active client to pool. Total active clients: ${this.activeConnections.size}`);

      return active;
    } catch (error: any) {
      this.logger.error(`Failed to connect/create telegram client for ${trimmed.substring(0, 6)}*** (clientId: ${clientInfo.clientId}): ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Remove inactive clients that are no longer in the active clients list
   */
  async removeInactiveConnections(activeConnections: Client[]): Promise<void> {
    this.logger.debug(`Starting inactive client removal process. Active clients count: ${activeConnections?.length || 0}, Managed clients count: ${this.activeConnections.size}`);

    try {
      // Build set of currently active mobiles
      const activeMobiles = new Set<string>();
      let totalPromoteMobiles = 0;

      for (const client of activeConnections) {
        if (client.promoteMobile && Array.isArray(client.promoteMobile)) {
          client.promoteMobile.forEach(mobile => {
            if (mobile && typeof mobile === 'string') {
              activeMobiles.add(mobile.trim());
              totalPromoteMobiles++;
            }
          });
        }
      }

      this.logger.debug(`Built active mobiles set with ${activeMobiles.size} unique mobiles from ${totalPromoteMobiles} total promote mobiles`);

      // Track removal statistics
      let removedCount = 0;
      const mobilesToRemove: string[] = [];

      // Identify clients to remove
      for (const [mobile, activeConnection] of this.activeConnections.entries()) {
        if (!activeMobiles.has(mobile)) {
          mobilesToRemove.push(mobile);
          this.logger.debug(`Marked for removal: ${mobile.substring(0, 6)}*** (clientId: ${activeConnection.clientId}) - not in active list`);
        }
      }

      this.logger.log(`Found ${mobilesToRemove.length} inactive clients to remove`);

      // Remove inactive clients
      for (const mobile of mobilesToRemove) {
        try {
          this.logger.debug(`Removing inactive client: ${mobile.substring(0, 6)}***`);
          await this.removeTelegramClient(mobile);
          removedCount++;
        } catch (error) {
          this.logger.error(`Failed to remove inactive client for mobile ${mobile.substring(0, 6)}***:`, error.message);
        }
      }

      if (removedCount > 0) {
        this.logger.log(`Successfully removed ${removedCount} inactive telegram clients. Remaining active clients: ${this.activeConnections.size}`);
      } else {
        this.logger.debug('No inactive clients were removed');
      }

    } catch (error) {
      this.logger.error('Error during inactive clients removal:', error.stack);
    }
  }

  /**
   * Remove a specific Telegram client with proper cleanup
   */
  async removeTelegramClient(mobile: string): Promise<void> {
    const activeConnection = this.activeConnections.get(mobile);
    if (!activeConnection) {
      this.logger.debug(`No active client found for mobile: ${mobile.substring(0, 6)}*** - skipping removal`);
      return;
    }

    try {
      activeConnection.isActive = false;
      if (activeConnection.telegramClient) {
        try {
          if (activeConnection.telegramClient.connected) {
            // Create cancellable timeout for disconnect
            let timeoutHandle: NodeJS.Timeout;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(new Error(`Disconnect timeout for ${mobile.substring(0, 6)}***`));
              }, ConnectionManagerConfig.DISCONNECT_TIMEOUT);
            });

            try {
              await Promise.race([
                activeConnection.telegramClient.disconnect(),
                timeoutPromise
              ]);
              this.logger.debug(`Successfully disconnected telegram client: ${mobile.substring(0, 6)}***`);
            } finally {
              // Always clear the timeout to prevent leaks
              if (timeoutHandle!) {
                clearTimeout(timeoutHandle);
              }
            }
          } else {
            this.logger.debug(`Client already disconnected: ${mobile.substring(0, 6)}***`);
          }
        } catch (disconnectError) {
          this.logger.warn(`Error disconnecting client for mobile ${mobile.substring(0, 6)}***:`, disconnectError.message);
        }

        // Unregister from telegram service
        try {
          this.telegramService.unregisterClient(mobile);
          this.logger.debug(`Successfully unregistered client: ${mobile.substring(0, 6)}***`);
        } catch (unregisterError) {
          this.logger.warn(`Error unregistering client for mobile ${mobile.substring(0, 6)}***:`, unregisterError.message);
        }
      }

      this.activeConnections.delete(mobile);
      this.logger.log(`Successfully removed telegram client: ${mobile.substring(0, 6)}*** (clientId: ${activeConnection.clientId}). Remaining clients: ${this.activeConnections.size}`);
    } catch (error) {
      this.logger.error(`Error removing telegram client for mobile ${mobile.substring(0, 6)}***:`, error.stack);
      this.activeConnections.delete(mobile);
      this.logger.warn(`Force removed client from active pool due to cleanup error: ${mobile.substring(0, 6)}***`);
    }
  }

  /**
   * Cleanup all active clients and mappings
   */
  async cleanupAllClients(): Promise<void> {
    this.logger.log(`Starting cleanup of all active telegram clients. Current count: ${this.activeConnections.size}`);

    const startTime = Date.now();
    const clientMobiles = Array.from(this.activeConnections.keys());

    const cleanupPromises = clientMobiles.map(mobile =>
      this.removeTelegramClient(mobile).catch(error => {
        this.logger.error(`Error cleaning up client ${mobile.substring(0, 6)}***:`, error.message);
      })
    );

    const results = await Promise.allSettled(cleanupPromises);

    // Log cleanup results
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.filter(r => r.status === 'rejected').length;

    this.logger.debug(`Cleanup results: ${successCount} successful, ${failureCount} failed`);

    // Clear all state
    this.activeConnections.clear();
    this.availableMobilePool.clear();

    const duration = Date.now() - startTime;
    this.logger.log(`All active telegram clients and mappings cleaned up in ${duration}ms. Pool sizes: active=${this.activeConnections.size}, available=${this.availableMobilePool.size}`);
  }

  /**
   * Get Telegram client for a specific mobile number
   */
  getTelegramClient(mobile: string): TelegramClient | null {
    if (!mobile || typeof mobile !== 'string') {
      this.logger.warn('Invalid mobile number provided to getTelegramClient - empty or non-string value');
      return null;
    }

    const trimmedMobile = mobile.trim();
    const activeConnection = this.activeConnections.get(trimmedMobile);

    if (!activeConnection) {
      this.logger.debug(`No active client found for mobile: ${trimmedMobile.substring(0, 6)}***`);
      return null;
    }

    if (!activeConnection.isActive) {
      this.logger.debug(`Client for mobile ${trimmedMobile.substring(0, 6)}*** is not active (clientId: ${activeConnection.clientId})`);
      return null;
    }

    if (!activeConnection.telegramClient || !activeConnection.telegramClient.connected) {
      this.logger.debug(`Client for mobile ${trimmedMobile.substring(0, 6)}*** is not connected (clientId: ${activeConnection.clientId})`);
      return null;
    }

    return activeConnection.telegramClient;
  }

  /**
   * Get connection health status for all mobiles
   */
  getConnectionHealthMap(): Map<string, boolean> {
    this.logger.debug(`Generating connection health map for ${this.activeConnections.size} active clients`);

    const healthMap = new Map<string, boolean>();
    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const [mobile, activeConnection] of this.activeConnections.entries()) {
      const isHealthy = activeConnection.isActive &&
                       activeConnection.telegramClient?.connected === true;
      healthMap.set(mobile, isHealthy);

      if (isHealthy) {
        healthyCount++;
      } else {
        unhealthyCount++;
        this.logger.debug(`Unhealthy client detected: ${mobile.substring(0, 6)}*** (active: ${activeConnection.isActive}, connected: ${activeConnection.telegramClient?.connected})`);
      }
    }

    this.logger.debug(`Health map generated: ${healthyCount} healthy, ${unhealthyCount} unhealthy clients`);
    return healthMap;
  }

  /**
   * Get detailed connection info for a specific mobile
   */
  getConnectionInfo(mobile: string): ConnectionInfo | null {
    if (!mobile || typeof mobile !== 'string') {
      this.logger.warn('Invalid mobile number provided to getConnectionInfo');
      return null;
    }

    const trimmedMobile = mobile.trim();
    const activeConnection = this.activeConnections.get(trimmedMobile);

    if (!activeConnection) {
      this.logger.debug(`No connection info available for mobile: ${trimmedMobile.substring(0, 6)}***`);
      return null;
    }

    const connectionInfo = {
      isHealthy: activeConnection.isActive,
      isConnected: activeConnection.telegramClient?.connected || false,
      clientId: activeConnection.clientId,
      mainAccUsername: activeConnection.clientInfo.username,
      lastHealthCheck: activeConnection.lastHealthCheck,
      createdAt: activeConnection.createdAt,
    };

    return connectionInfo;
  }

  /**
   * Get all active mobile numbers
   */
  getActiveConnections(): string[] {
    const mobiles = Array.from(this.activeConnections.keys());
    return mobiles;
  }

  /**
   * Get all telegram clients (including inactive/disconnected ones)
   */
  getAllActiveConnections(): Map<string, TelegramClient> {
    this.logger.debug(`Retrieving all active telegram clients from ${this.activeConnections.size} active entries`);

    const allClients = new Map<string, TelegramClient>();
    let clientCount = 0;

    for (const [mobile, activeConnection] of this.activeConnections.entries()) {
      if (activeConnection.telegramClient) {
        allClients.set(mobile, activeConnection.telegramClient);
        clientCount++;
      }
    }

    return allClients;
  }

  /**
   * Get client by mobile with detailed error information
   */
  getClientWithDetails(mobile: string): ClientWithDetails {
    if (!mobile || typeof mobile !== 'string') {
      this.logger.warn('Invalid mobile number provided to getClientWithDetails');
      return { client: null, error: 'Invalid mobile number provided' };
    }

    const trimmedMobile = mobile.trim();
    const activeConnection = this.activeConnections.get(trimmedMobile);

    if (!activeConnection) {
      this.logger.debug(`No active client found for mobile: ${trimmedMobile.substring(0, 6)}***`);
      return { client: null, error: 'No active client found for mobile' };
    }

    if (!activeConnection.isActive) {
      this.logger.debug(`Client not active for mobile ${trimmedMobile.substring(0, 6)}*** (clientId: ${activeConnection.clientId})`);
      return {
        client: null,
        error: 'Client is not active',
        activeConnection
      };
    }

    if (!activeConnection.telegramClient) {
      this.logger.warn(`No telegram client instance for mobile ${trimmedMobile.substring(0, 6)}*** (clientId: ${activeConnection.clientId})`);
      return {
        client: null,
        error: 'No telegram client instance',
        activeConnection
      };
    }

    if (!activeConnection.telegramClient.connected) {
      this.logger.debug(`Client not connected for mobile ${trimmedMobile.substring(0, 6)}*** (clientId: ${activeConnection.clientId})`);
      return {
        client: null,
        error: 'Client is not connected',
        activeConnection
      };
    }

    return { client: activeConnection.telegramClient, activeConnection };
  }

  getActiveConnectionsMap(): Map<string, ActiveConnection> {
    this.logger.debug(`Returning active clients map with ${this.activeConnections.size} entries`);
    return this.activeConnections;
  }

  /**
   * Clear all active clients (for cleanup)
   */
  clearActiveConnections(): void {
    const previousCount = this.activeConnections.size;
    this.activeConnections.clear();
    this.logger.log(`Cleared active clients map. Previous count: ${previousCount}, Current count: ${this.activeConnections.size}`);
  }

  /**
   * Store mobile to client mapping for later connection creation
   */
  setAvailableMobile(mobile: string, client: Client): void {
    if (!mobile || !client) {
      this.logger.warn('Invalid parameters provided to setAvailableMobile');
      return;
    }

    const trimmedMobile = mobile.trim();
    this.availableMobilePool.set(trimmedMobile, client);
    this.logger.debug(`Added mobile to available pool: ${trimmedMobile.substring(0, 6)}*** (clientId: ${client.clientId}). Pool size: ${this.availableMobilePool.size}`);
  }

  async createTelegramClientForMobile(mobile: string): Promise<ActiveConnection | null> {
    const clientInfo = this.availableMobilePool.get(mobile);
    if (!clientInfo) {
      this.logger.error(`No client info found in available pool for mobile: ${mobile.substring(0, 6)}***`);
      return null;
    }

    this.logger.debug(`Found client info in pool for mobile: ${mobile.substring(0, 6)}*** (clientId: ${clientInfo.clientId})`);
    return await this.createOrUpdateTelegramClient(mobile, clientInfo);
  }

  /**
   * Get all available mobiles from the pool (not just connected ones)
   */
  getAllAvailableMobiles(): string[] {
    const availableMobiles = Array.from(this.availableMobilePool.keys());
    return availableMobiles;
  }

  /**
   * Clear mobile client mappings
   */
  clearMobileClientMappings(): void {
    const previousCount = this.availableMobilePool.size;
    this.availableMobilePool.clear();
    this.logger.log(`Cleared mobile client mappings. Previous count: ${previousCount}, Current count: ${this.availableMobilePool.size}`);
  }

  /**
   * Remove client for a specific mobile (used during rotation)
   */
  async removeClientForMobile(mobile: string): Promise<void> {
    const activeConnection = this.activeConnections.get(mobile);
    if (activeConnection) {
      await this.removeTelegramClient(mobile);
    } else {
      this.logger.debug(`No active client found for removal: ${mobile.substring(0, 6)}***`);
    }
  }

  /**
   * Create client for mobile (wrapper that returns boolean for rotation)
   */
  async createClientForMobile(mobile: string): Promise<boolean> {
    this.logger.debug(`Creating client for mobile (rotation wrapper): ${mobile.substring(0, 6)}***`);

    const result = await this.createTelegramClientForMobile(mobile);
    const success = result !== null;

    this.logger.log(`Client creation ${success ? 'succeeded' : 'failed'} for mobile: ${mobile.substring(0, 6)}***`);
    return success;
  }
}
