import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { ClientService } from '../../clients/client.service';
import { TelegramService } from '../../telegram/telegram.service';
import { Client } from '../../clients/schemas/client.schema';
import {
  ManagedTelegramClient,
  ConnectionInfo,
  ClientWithDetails
} from '../interfaces/connection-manager.interfaces';
import { ConnectionManagerConfig } from '../config/connection-manager.config';

@Injectable()
export class ClientManagementService {
  private readonly logger = new Logger(ClientManagementService.name);
  private managedClients = new Map<string, ManagedTelegramClient>();
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
    const activeClients = await this.clientService.getActiveClients();
    this.logger.log(`Retrieved ${activeClients?.length || 0} active clients`);
    return activeClients;
  }

  /**
   * Create or update a Telegram client (simplified)
   */
  async createOrUpdateTelegramClient(
    mobile: string,
    clientInfo: Client
  ): Promise<ManagedTelegramClient | null> {
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

      const managed: ManagedTelegramClient = {
        telegramClient: telegramClientInfo.client,
        clientInfo: telegramClientInfo,
        clientId: clientInfo.clientId,
        isActive: true,
        mobile: trimmed,
        lastHealthCheck: new Date(),
        createdAt: new Date(),
      };

      this.managedClients.set(trimmed, managed);
      this.logger.debug(`Added managed client to pool. Total managed clients: ${this.managedClients.size}`);

      return managed;
    } catch (error: any) {
      this.logger.error(`Failed to connect/create telegram client for ${trimmed.substring(0, 6)}*** (clientId: ${clientInfo.clientId}): ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Remove inactive clients that are no longer in the active clients list
   */
  async removeInactiveClients(activeClients: Client[]): Promise<void> {
    this.logger.debug(`Starting inactive client removal process. Active clients count: ${activeClients?.length || 0}, Managed clients count: ${this.managedClients.size}`);

    try {
      // Build set of currently active mobiles
      const activeMobiles = new Set<string>();
      let totalPromoteMobiles = 0;

      for (const client of activeClients) {
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
      for (const [mobile, managedClient] of this.managedClients.entries()) {
        if (!activeMobiles.has(mobile)) {
          mobilesToRemove.push(mobile);
          this.logger.debug(`Marked for removal: ${mobile.substring(0, 6)}*** (clientId: ${managedClient.clientId}) - not in active list`);
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
        this.logger.log(`Successfully removed ${removedCount} inactive telegram clients. Remaining managed clients: ${this.managedClients.size}`);
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
    const managedClient = this.managedClients.get(mobile);
    if (!managedClient) {
      this.logger.debug(`No managed client found for mobile: ${mobile.substring(0, 6)}*** - skipping removal`);
      return;
    }

    this.logger.log(`Starting removal process for telegram client: ${mobile.substring(0, 6)}*** (clientId: ${managedClient.clientId})`);

    try {
      // Mark as inactive first
      managedClient.isActive = false;
      this.logger.debug(`Marked client as inactive: ${mobile.substring(0, 6)}***`);

      // Properly disconnect and cleanup the client
      if (managedClient.telegramClient) {
        try {
          if (managedClient.telegramClient.connected) {
            this.logger.debug(`Disconnecting telegram client: ${mobile.substring(0, 6)}***`);

            // Create cancellable timeout for disconnect
            let timeoutHandle: NodeJS.Timeout;
            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(new Error(`Disconnect timeout for ${mobile.substring(0, 6)}***`));
              }, ConnectionManagerConfig.DISCONNECT_TIMEOUT);
            });

            try {
              await Promise.race([
                managedClient.telegramClient.disconnect(),
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
          this.logger.debug(`Unregistering client from telegram service: ${mobile.substring(0, 6)}***`);
          this.telegramService.unregisterClient(mobile);
          this.logger.debug(`Successfully unregistered client: ${mobile.substring(0, 6)}***`);
        } catch (unregisterError) {
          this.logger.warn(`Error unregistering client for mobile ${mobile.substring(0, 6)}***:`, unregisterError.message);
        }
      }

      // Remove from managed clients
      this.managedClients.delete(mobile);
      this.logger.log(`Successfully removed telegram client: ${mobile.substring(0, 6)}*** (clientId: ${managedClient.clientId}). Remaining clients: ${this.managedClients.size}`);

    } catch (error) {
      this.logger.error(`Error removing telegram client for mobile ${mobile.substring(0, 6)}***:`, error.stack);
      // Still remove from managed clients even if cleanup failed
      this.managedClients.delete(mobile);
      this.logger.warn(`Force removed client from managed pool due to cleanup error: ${mobile.substring(0, 6)}***`);
    }
  }

  /**
   * Cleanup all managed clients and mappings
   */
  async cleanupAllClients(): Promise<void> {
    this.logger.log(`Starting cleanup of all managed telegram clients. Current count: ${this.managedClients.size}`);

    const startTime = Date.now();
    const clientMobiles = Array.from(this.managedClients.keys());

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
    this.managedClients.clear();
    this.availableMobilePool.clear();

    const duration = Date.now() - startTime;
    this.logger.log(`All managed telegram clients and mappings cleaned up in ${duration}ms. Pool sizes: managed=${this.managedClients.size}, available=${this.availableMobilePool.size}`);
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
    const managedClient = this.managedClients.get(trimmedMobile);

    if (!managedClient) {
      this.logger.debug(`No managed client found for mobile: ${trimmedMobile.substring(0, 6)}***`);
      return null;
    }

    if (!managedClient.isActive) {
      this.logger.debug(`Client for mobile ${trimmedMobile.substring(0, 6)}*** is not active (clientId: ${managedClient.clientId})`);
      return null;
    }

    if (!managedClient.telegramClient || !managedClient.telegramClient.connected) {
      this.logger.debug(`Client for mobile ${trimmedMobile.substring(0, 6)}*** is not connected (clientId: ${managedClient.clientId})`);
      return null;
    }

    this.logger.debug(`Retrieved connected telegram client for mobile: ${trimmedMobile.substring(0, 6)}*** (clientId: ${managedClient.clientId})`);
    return managedClient.telegramClient;
  }

  /**
   * Get connection health status for all mobiles
   */
  getConnectionHealthMap(): Map<string, boolean> {
    this.logger.debug(`Generating connection health map for ${this.managedClients.size} managed clients`);

    const healthMap = new Map<string, boolean>();
    let healthyCount = 0;
    let unhealthyCount = 0;

    for (const [mobile, managedClient] of this.managedClients.entries()) {
      const isHealthy = managedClient.isActive &&
                       managedClient.telegramClient?.connected === true;
      healthMap.set(mobile, isHealthy);

      if (isHealthy) {
        healthyCount++;
      } else {
        unhealthyCount++;
        this.logger.debug(`Unhealthy client detected: ${mobile.substring(0, 6)}*** (active: ${managedClient.isActive}, connected: ${managedClient.telegramClient?.connected})`);
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
    const managedClient = this.managedClients.get(trimmedMobile);

    if (!managedClient) {
      this.logger.debug(`No connection info available for mobile: ${trimmedMobile.substring(0, 6)}***`);
      return null;
    }

    const connectionInfo = {
      isHealthy: managedClient.isActive,
      isConnected: managedClient.telegramClient?.connected || false,
      clientId: managedClient.clientId,
      mainAccUsername: managedClient.clientInfo.username,
      lastHealthCheck: managedClient.lastHealthCheck,
      createdAt: managedClient.createdAt,
    };

    this.logger.debug(`Retrieved connection info for ${trimmedMobile.substring(0, 6)}***: healthy=${connectionInfo.isHealthy}, connected=${connectionInfo.isConnected}, clientId=${connectionInfo.clientId}`);
    return connectionInfo;
  }

  /**
   * Get all managed mobile numbers
   */
  getManagedMobiles(): string[] {
    const mobiles = Array.from(this.managedClients.keys());
    this.logger.debug(`Retrieved ${mobiles.length} managed mobile numbers`);
    return mobiles;
  }

  /**
   * Get all telegram clients (including inactive/disconnected ones)
   */
  getAllManagedTelegramClients(): Map<string, TelegramClient> {
    this.logger.debug(`Retrieving all managed telegram clients from ${this.managedClients.size} managed entries`);

    const allClients = new Map<string, TelegramClient>();
    let clientCount = 0;

    for (const [mobile, managedClient] of this.managedClients.entries()) {
      if (managedClient.telegramClient) {
        allClients.set(mobile, managedClient.telegramClient);
        clientCount++;
      }
    }

    this.logger.debug(`Retrieved ${clientCount} telegram client instances from ${this.managedClients.size} managed clients`);
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
    const managedClient = this.managedClients.get(trimmedMobile);

    if (!managedClient) {
      this.logger.debug(`No managed client found for mobile: ${trimmedMobile.substring(0, 6)}***`);
      return { client: null, error: 'No managed client found for mobile' };
    }

    if (!managedClient.isActive) {
      this.logger.debug(`Client not active for mobile ${trimmedMobile.substring(0, 6)}*** (clientId: ${managedClient.clientId})`);
      return {
        client: null,
        error: 'Client is not active',
        managedClient
      };
    }

    if (!managedClient.telegramClient) {
      this.logger.warn(`No telegram client instance for mobile ${trimmedMobile.substring(0, 6)}*** (clientId: ${managedClient.clientId})`);
      return {
        client: null,
        error: 'No telegram client instance',
        managedClient
      };
    }

    if (!managedClient.telegramClient.connected) {
      this.logger.debug(`Client not connected for mobile ${trimmedMobile.substring(0, 6)}*** (clientId: ${managedClient.clientId})`);
      return {
        client: null,
        error: 'Client is not connected',
        managedClient
      };
    }

    this.logger.debug(`Retrieved client with details for mobile: ${trimmedMobile.substring(0, 6)}*** (clientId: ${managedClient.clientId})`);
    return { client: managedClient.telegramClient, managedClient };
  }

  /**
   * Get all healthy mobiles from managed clients
   */
  getHealthyMobiles(): string[] {
    this.logger.debug(`Filtering healthy mobiles from ${this.managedClients.size} managed clients`);

    const healthyMobiles = Array.from(this.managedClients.entries())
      .filter(([mobile, managedClient]) => {
        const isHealthy = managedClient.isActive &&
               managedClient.telegramClient?.connected === true;

        if (!isHealthy) {
          this.logger.debug(`Mobile ${mobile.substring(0, 6)}*** is not healthy (active: ${managedClient.isActive}, connected: ${managedClient.telegramClient?.connected})`);
        }

        return isHealthy;
      })
      .map(([mobile, _]) => mobile)
      .sort(); // Sort for consistent ordering

    this.logger.log(`Found ${healthyMobiles.length} healthy mobiles out of ${this.managedClients.size} managed clients`);
    return healthyMobiles;
  }

  /**
   * Get managed clients map (for internal use by other services)
   */
  getManagedClientsMap(): Map<string, ManagedTelegramClient> {
    this.logger.debug(`Returning managed clients map with ${this.managedClients.size} entries`);
    return this.managedClients;
  }

  /**
   * Clear all managed clients (for cleanup)
   */
  clearManagedClients(): void {
    const previousCount = this.managedClients.size;
    this.managedClients.clear();
    this.logger.log(`Cleared managed clients map. Previous count: ${previousCount}, Current count: ${this.managedClients.size}`);
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

  /**
   * Create Telegram client for a specific mobile from the available pool
   */
  async createTelegramClientForMobile(mobile: string): Promise<ManagedTelegramClient | null> {
    this.logger.debug(`Attempting to create telegram client for mobile from pool: ${mobile.substring(0, 6)}***`);

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
    this.logger.debug(`Retrieved ${availableMobiles.length} available mobiles from pool`);
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
    this.logger.debug(`Checking for client removal for mobile: ${mobile.substring(0, 6)}***`);

    const managedClient = this.managedClients.get(mobile);
    if (managedClient) {
      this.logger.log(`Removing client for mobile during rotation: ${mobile.substring(0, 6)}*** (clientId: ${managedClient.clientId})`);
      await this.removeTelegramClient(mobile);
    } else {
      this.logger.debug(`No managed client found for removal: ${mobile.substring(0, 6)}***`);
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
