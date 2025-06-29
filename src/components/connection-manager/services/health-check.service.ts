import { Injectable, Logger } from '@nestjs/common';
import { ManagedTelegramClient, HealthCheckResult } from '../interfaces/connection-manager.interfaces';
import { ConnectionManagerConfig } from '../config/connection-manager.config';
import { ClientManagementService } from './client-management.service';

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);
  private healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(private readonly clientService: ClientManagementService) {}

  setupHealthCheckInterval(
    isShuttingDown: () => boolean,
    refreshMobiles: () => Promise<void>
  ): void {
    this.logger.log(`Setting up health check interval with ${ConnectionManagerConfig.HEALTH_CHECK_INTERVAL}ms interval`);
    
    if (this.healthCheckInterval) {
      this.logger.warn('Health check interval already exists, clearing previous interval');
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        if (isShuttingDown()) {
          this.logger.debug('Skipping health check - system is shutting down');
          return;
        }
        
        this.logger.debug('Starting scheduled health check');
        await this.performHealthCheck(refreshMobiles);
      } catch (e) {
        this.logger.error('Scheduled health check failed:', e.stack);
      }
    }, ConnectionManagerConfig.HEALTH_CHECK_INTERVAL);
    
    this.logger.debug('Health check interval successfully established');
  }

  async performHealthCheck(refreshMobiles: () => Promise<void>): Promise<void> {
    const start = Date.now();
    this.logger.debug('Starting comprehensive health check for all managed clients');
    
    let healthy = 0, unhealthy = 0, recovered = 0, errors = 0;

    const clients = this.clientService.getManagedClientsMap();
    const totalClients = clients.size;
    
    this.logger.debug(`Performing health check on ${totalClients} managed clients`);

    const checks = Array.from(clients.entries()).map(async ([mobile, client]) => {
      try {
        const wasHealthy = client.isActive && client.telegramClient?.connected;
        const result = await this.checkClientHealth(mobile, client);
        
        if (result.isHealthy) {
          healthy++;
          if (!wasHealthy) {
            recovered++;
            this.logger.debug(`Client recovered: ${mobile.substring(0, 6)}*** (clientId: ${client.clientId})`);
          }
        } else {
          unhealthy++;
          if (result.error) {
            this.logger.debug(`Client unhealthy: ${mobile.substring(0, 6)}*** - ${result.error}`);
          }
        }
      } catch (error) {
        errors++;
        this.logger.error(`Health check error for ${mobile.substring(0, 6)}***:`, error.message);
      }
    });

    await Promise.allSettled(checks);
    
    const duration = Date.now() - start;
    this.logger.log(`Health check completed: ${healthy} healthy, ${unhealthy} unhealthy, ${recovered} recovered, ${errors} errors (${duration}ms)`);
    
    if (recovered > 0) {
      this.logger.log(`${recovered} clients recovered during health check`);
    }
    
    if (errors > 0) {
      this.logger.warn(`${errors} health check errors occurred`);
    }
    
    this.logger.debug('Triggering mobile refresh after health check');
    await refreshMobiles();
    this.logger.debug('Mobile refresh completed after health check');
  }

  private async checkClientHealth(mobile: string, client: ManagedTelegramClient): Promise<HealthCheckResult> {
    this.logger.debug(`Checking health for client: ${mobile.substring(0, 6)}*** (clientId: ${client.clientId})`);
    
    try {
      if (!client?.telegramClient) {
        this.logger.warn(`Missing telegram client instance for ${mobile.substring(0, 6)}*** - removing from managed clients`);
        this.clientService.getManagedClientsMap().delete(mobile);
        return { mobile, isHealthy: false, error: 'Missing client instance' };
      }

      // Update last health check timestamp
      client.lastHealthCheck = new Date();
      this.logger.debug(`Updated health check timestamp for ${mobile.substring(0, 6)}***`);

      if (!client.telegramClient.connected) {
        this.logger.debug(`Client disconnected, attempting reconnection: ${mobile.substring(0, 6)}***`);
        
        try {
          await client.telegramClient.connect();
          this.logger.log(`Successfully reconnected client: ${mobile.substring(0, 6)}*** (clientId: ${client.clientId})`);
        } catch (connectError) {
          this.logger.warn(`Failed to reconnect client ${mobile.substring(0, 6)}***:`, connectError.message);
          throw connectError;
        }
      } else {
        this.logger.debug(`Client already connected and healthy: ${mobile.substring(0, 6)}***`);
      }
      
      return { mobile, isHealthy: true };

    } catch (e) {
      this.logger.error(`Health check failed for ${mobile.substring(0, 6)}*** (clientId: ${client.clientId}):`, e.message);
      return { mobile, isHealthy: false, error: e.message };
    }
  }

  async forceHealthCheck(refreshMobiles: () => Promise<void>): Promise<void> {
    this.logger.log('Manual health check triggered - performing immediate health check');
    const startTime = Date.now();
    
    try {
      await this.performHealthCheck(refreshMobiles);
      const duration = Date.now() - startTime;
      this.logger.log(`Manual health check completed successfully in ${duration}ms`);
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Manual health check failed after ${duration}ms:`, error.stack);
      throw error;
    }
  }

  clearHealthCheckInterval(): void {
    if (this.healthCheckInterval) {
      this.logger.log('Clearing health check interval');
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.logger.debug('Health check interval successfully cleared');
    } else {
      this.logger.debug('No health check interval to clear');
    }
  }

  getHealthStatistics() {
    this.logger.debug('Generating health statistics for all managed clients');
    
    const clients = this.clientService.getManagedClientsMap();
    const totalClients = clients.size;
    let healthy = 0, unhealthy = 0, activeButDisconnected = 0, inactiveClients = 0;

    for (const [mobile, client] of clients.entries()) {
      const isActive = client.isActive;
      const isConnected = client.telegramClient?.connected;
      const isHealthy = isActive && isConnected;
      
      if (isHealthy) {
        healthy++;
      } else {
        unhealthy++;
        
        // More detailed categorization for debugging
        if (!isActive) {
          inactiveClients++;
          this.logger.debug(`Inactive client: ${mobile.substring(0, 6)}***`);
        } else if (!isConnected) {
          activeButDisconnected++;
          this.logger.debug(`Active but disconnected client: ${mobile.substring(0, 6)}***`);
        }
      }
    }

    const statistics = {
      total: totalClients,
      healthy,
      unhealthy,
      healthyPercentage: totalClients > 0 ? Math.round((healthy / totalClients) * 100) : 0,
      details: {
        activeButDisconnected,
        inactiveClients
      }
    };

    this.logger.log(`Health statistics: ${healthy}/${totalClients} healthy (${statistics.healthyPercentage}%), ${unhealthy} unhealthy`);
    
    if (unhealthy > 0) {
      this.logger.debug(`Unhealthy breakdown: ${inactiveClients} inactive, ${activeButDisconnected} disconnected`);
    }

    return statistics;
  }
}
