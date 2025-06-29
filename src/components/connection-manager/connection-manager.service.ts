import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import {
  RotationStatus,
  RotationPatterns,
  ServiceHealth,
  ServiceStatistics,
  ConnectionInfo,
  ClientWithDetails
} from './interfaces/connection-manager.interfaces';
import { ClientManagementService } from './services/client-management.service';
import { HealthCheckService } from './services/health-check.service';
import { RotationManagementService } from './services/rotation-management.service';
import { Client } from '../clients/schemas';
import { ConnectionManagerConfig } from './config/connection-manager.config';
import { PromotionService } from '../promotions';
@Injectable()
export class ConnectionManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectionManagerService.name);
  private isShuttingDown = false;
  private rotationInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly clienManagementService: ClientManagementService,
    private readonly healthService: HealthCheckService,
    private readonly rotationService: RotationManagementService,
    @Inject(forwardRef(() => PromotionService))
    private readonly promotionService: PromotionService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Initializing ConnectionManagerService...');
    this.logger.debug('Setting up connection manager with initial state');

    try {
      this.logger.log('📋 Starting client initialization process');
      await this.initClients();

      this.logger.log('💓 Setting up health check interval');
      this.healthService.setupHealthCheckInterval(
        () => this.isShuttingDown,
        () => this.rotationService.refreshAvailableMobiles()
      );

      this.logger.log('🔄 Setting up rotation interval');
      this.setupRotationInterval();

      this.logger.log('✅ ConnectionManagerService initialization completed successfully');
    } catch (error) {
      this.logger.error('❌ Initialization failed', error.stack);
      throw error;
    }
  }

  async onModuleDestroy() {
    this.logger.log('🛑 Shutting down ConnectionManagerService...');
    this.isShuttingDown = true;

    this.logger.debug('Clearing all intervals');
    this.clearIntervals();

    this.logger.log('🧹 Cleaning up all clients');
    await this.clienManagementService.cleanupAllClients();

    this.logger.debug('Clearing rotation state');
    this.rotationService.clearRotationState();

    this.logger.log('✅ ConnectionManagerService shutdown completed');
  }

  private async initClients() {
    this.logger.log('🔍 Fetching active clients from database');
    const clients = await this.clienManagementService.getActiveClients();
    this.logger.debug(`Found ${clients.length} active clients in database`);

    const pool: string[] = [];

    this.logger.log('📱 Building mobile phone pool from client data');
    for (const client of clients) {
      const clientMobiles = client.promoteMobile || [];
      this.logger.debug(`Processing client with ${clientMobiles.length} mobile numbers`);

      for (const mobile of clientMobiles) {
        const trimmed = mobile.trim();
        if (trimmed && !pool.includes(trimmed)) {
          pool.push(trimmed);
          this.clienManagementService.setAvailableMobile(trimmed, client as Client);
          this.logger.debug(`Added mobile ${trimmed} to pool`);
        } else if (trimmed && pool.includes(trimmed)) {
          this.logger.warn(`🔄 Duplicate mobile ${trimmed} found, skipping`);
        }
      }
    }

    this.logger.log(`📊 Mobile pool built with ${pool.length} unique numbers`);
    await this.rotationService.initializeWithMobilePool(pool);

    const activeMobiles = this.rotationService.getCurrentActiveMobiles();
    this.logger.log(`🎯 Connecting to ${activeMobiles.length} active mobiles`);

    let successCount = 0;
    let failCount = 0;

    for (const mobile of activeMobiles) {
      if (this.isShuttingDown) {
        this.logger.warn('⚠️ Shutdown signal received, stopping client connections');
        break;
      }
      try {
        this.logger.debug(`🔌 Attempting to connect mobile ${mobile}`);
        await this.clienManagementService.createTelegramClientForMobile(mobile);
        successCount++;
        this.logger.debug(`✅ Successfully connected mobile ${mobile}`);
      } catch (err) {
        failCount++;
        this.logger.warn(`❌ Failed to connect mobile ${mobile}: ${err.message}`);
      }
    }

    this.logger.log(`📈 Client initialization completed: ${successCount} successful, ${failCount} failed`);
  }

  private setupRotationInterval() {
    if (this.rotationInterval) clearTimeout(this.rotationInterval);
    const base = this.getRotationConfig('ROTATION_INTERVAL');
    const range = base * this.getRotationConfig('ROTATION_JITTER_PERCENTAGE');
    const interval = Math.max(
      this.getRotationConfig('MIN_ROTATION_INTERVAL'),
      Math.min(this.getRotationConfig('MAX_ROTATION_INTERVAL'), base + (Math.random() - 0.5) * 2 * range)
    );
    this.rotationInterval = setTimeout(async () => {
      if (!this.isShuttingDown) {
        this.logger.log('Rotation timer triggered - executing rotation');
        await this.rotationService.rotateActiveMobiles();
        await this.handleRotation();
        this.setupRotationInterval();
      } else {
        this.logger.log('Rotation skipped - service is shutting down');
      }
    }, interval);
    this.logger.debug(`Scheduling next rotation in ${Math.round(interval / 1000)}s`);
  }

  private getRotationConfig(key: string) {
    return ConnectionManagerConfig[key];
  }

  private clearIntervals() {
    this.logger.debug('🧹 Clearing health check interval');
    this.healthService.clearHealthCheckInterval();
    this.logger.debug('🧹 Clearing rotation interval');
    if (this.rotationInterval) {
      clearTimeout(this.rotationInterval);
      this.rotationInterval = null;
    }
    this.logger.debug('✅ All intervals cleared');
  }

  public async refreshAllClients() {
    if (this.isShuttingDown) {
      this.logger.warn('⚠️ Cannot refresh clients - service is shutting down');
      return;
    }

    this.logger.log('🔄 Starting full client refresh cycle');
    this.logger.debug('Clearing existing intervals');
    this.clearIntervals();

    this.logger.log('🧹 Cleaning up existing clients');
    await this.clienManagementService.cleanupAllClients();

    this.logger.debug('Clearing rotation state');
    this.rotationService.clearRotationState();

    this.logger.log('🔄 Reinitializing clients');
    await this.initClients();

    this.logger.log('💓 Restarting health check interval');
    this.healthService.setupHealthCheckInterval(
      () => this.isShuttingDown,
      () => this.rotationService.refreshAvailableMobiles()
    );

    this.logger.log('🔄 Restarting rotation interval');
    this.setupRotationInterval();

    this.logger.log('✅ Client refresh cycle completed successfully');
  }

  public async getTelegramClient(mobile: string): Promise<TelegramClient | null> {
    // this.logger.debug(`🔍 Getting Telegram client for mobile: ${mobile}`);
    const client = await this.clienManagementService.getTelegramClient(mobile);
    if (client) {
      // this.logger.debug(`✅ Found Telegram client for mobile: ${mobile}`);
    } else {
      this.logger.debug(`❌ No Telegram client found for mobile: ${mobile}`);
      const activeConnection = await this.clienManagementService.createTelegramClientForMobile(mobile);
      return activeConnection?.telegramClient;
    }
    return client;
  }

  public getConnectionInfo(mobile: string): ConnectionInfo | null {
    // this.logger.debug(`🔍 Getting connection info for mobile: ${mobile}`);
    const info = this.clienManagementService.getConnectionInfo(mobile);
    if (info) {
      this.logger.debug(`✅ Found connection info for mobile: ${mobile}`);
    } else {
      this.logger.debug(`❌ No connection info found for mobile: ${mobile}`);
    }
    return info;
  }

  public getActiveConnections(): string[] {
    const mobiles = this.clienManagementService.getActiveConnections();
    return mobiles;
  }

  public getCurrentActiveMobiles(): string[] {
    const mobiles = this.rotationService.getCurrentActiveMobiles();
    return mobiles;
  }

  public getAvailableMobiles(): string[] {
    const mobiles = this.rotationService.getAvailableMobiles();
    return mobiles;
  }

  public getActiveTelegramClients(): Map<string, TelegramClient> {
    const clients = this.rotationService.getActiveTelegramClients();
    return clients;
  }

  public getAllActiveConnections(): Map<string, TelegramClient> {
    const clients = this.clienManagementService.getAllActiveConnections();
    return clients;
  }

  public getRotationStatus(): RotationStatus {
    this.logger.debug('🔄 Getting current rotation status');
    const status = this.rotationService.getRotationStatus();
    this.logger.debug(`Rotation status: ${JSON.stringify(status)}`);
    return status;
  }

  private async handleRotation() {
    const currentActiveMobiles = this.rotationService.getCurrentActiveMobiles();
    const allActiveConnections = this.clienManagementService.getAllActiveConnections();
    const connectedMobiles = Array.from(allActiveConnections.keys());

    for (const mobile of connectedMobiles) {
      if (!currentActiveMobiles.includes(mobile)) {
        await this.clienManagementService.removeClientForMobile(mobile);
      }
    }
    for (const mobile of currentActiveMobiles) {
      if (!connectedMobiles.includes(mobile)) {
        await this.clienManagementService.createTelegramClientForMobile(mobile);
      }
    }
    await this.promotionService.handleRotation();
  }

  public async forceRotateActiveMobiles(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('⚠️ Cannot force rotation - service is shutting down');
      return;
    }

    this.logger.log('🔄 Forcing rotation of active mobiles');
    await this.rotationService.rotateActiveMobiles();
    await this.handleRotation();
    this.logger.log('✅ Forced rotation completed');
  }

  public getRotationPatterns(): RotationPatterns {
    this.logger.debug('📊 Getting rotation patterns');
    const patterns = this.rotationService.getRotationPatterns();
    this.logger.debug(`Rotation patterns retrieved: ${Object.keys(patterns).length} pattern types`);
    return patterns;
  }

  public getRandomMobile(): string | null {
    this.logger.debug('🎲 Getting random mobile');
    const mobile = this.rotationService.getRandomMobile();
    if (mobile) {
      this.logger.debug(`🎯 Random mobile selected: ${mobile}`);
    } else {
      this.logger.warn('⚠️ No random mobile available');
    }
    return mobile;
  }

  public getServiceStatistics(): ServiceStatistics {
    this.logger.debug('📊 Calculating service statistics');

    const stats = this.rotationService.getRotationStatistics();
    const health = this.healthService.getHealthStatistics();
    const clients = this.clienManagementService.getActiveConnectionsMap();

    const active = [...clients.values()].filter(c => c.isActive);
    const connected = active.filter(c => c.telegramClient?.connected);
    const oldest = [...clients.values()].reduce((a, b) => (!a || a.createdAt > b.createdAt ? b : a), null);
    const recent = [...clients.values()].reduce((a, b) => (!a || a.lastHealthCheck < b.lastHealthCheck ? b : a), null);

    const statistics = {
      totalActiveConnections: clients.size,
      activeConnections: active.length,
      connectedClients: connected.length,
      failedClients: clients.size - active.length,
      rotationStats: stats,
      healthStats: health,
      uptime: {
        serviceSince: oldest?.createdAt || new Date(),
        lastHealthCheck: recent?.lastHealthCheck || new Date(),
      },
    };

    this.logger.debug(`📈 Service statistics calculated:`, {
      totalActiveConnections: statistics.totalActiveConnections,
      activeConnections: statistics.activeConnections,
      connectedClients: statistics.connectedClients,
      failedClients: statistics.failedClients,
      serviceSince: statistics.uptime.serviceSince,
      lastHealthCheck: statistics.uptime.lastHealthCheck
    });

    return statistics;
  }

  public async forceHealthCheck(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('⚠️ Cannot force health check - service is shutting down');
      return;
    }

    this.logger.log('💓 Forcing health check cycle');
    await this.healthService.forceHealthCheck(() => this.rotationService.refreshAvailableMobiles());
    this.logger.log('✅ Forced health check completed');
  }

  public getClientWithDetails(mobile: string): ClientWithDetails {
    this.logger.debug(`🔍 Getting detailed client info for mobile: ${mobile}`);
    const details = this.clienManagementService.getClientWithDetails(mobile);
    if (details) {
      this.logger.debug(`✅ Found detailed client info for mobile: ${mobile}`);
    } else {
      this.logger.debug(`❌ No detailed client info found for mobile: ${mobile}`);
    }
    return details;
  }

  public isServiceReady(): boolean {
    const clientsSize = this.clienManagementService.getActiveConnectionsMap().size;
    const activeMobilesLength = this.rotationService.getCurrentActiveMobiles().length;
    const ready = !this.isShuttingDown && clientsSize > 0 && activeMobilesLength > 0;

    this.logger.debug(`🔍 Service readiness check:`, {
      isShuttingDown: this.isShuttingDown,
      activeConnections: clientsSize,
      activeMobiles: activeMobilesLength,
      ready
    });

    return ready;
  }

  public getServiceHealth(): ServiceHealth {
    this.logger.debug('💓 Calculating service health status');

    const issues: string[] = [];
    if (this.isShuttingDown) {
      this.logger.debug('Service is shutting down');
      return { status: 'shutting_down', readyForOperations: false, issues: ['Service is shutting down'] };
    }

    const clients = this.clienManagementService.getActiveConnectionsMap();
    const activeMobiles = this.rotationService.getCurrentActiveMobiles();

    if (!clients.size) {
      issues.push('No managed clients');
      this.logger.warn('⚠️ Health issue detected: No managed clients');
    }
    if (!activeMobiles.length) {
      issues.push('No active mobiles');
      this.logger.warn('⚠️ Health issue detected: No active mobiles');
    }

    const connected = [...clients.values()].filter(c => c.isActive && c.telegramClient?.connected).length;
    const healthyPercent = clients.size ? (connected / clients.size) * 100 : 0;

    if (healthyPercent === 0) {
      issues.push('No healthy clients');
      this.logger.error('🚨 Critical health issue: No healthy clients');
    } else if (healthyPercent < 50) {
      issues.push(`Low health: ${healthyPercent.toFixed(1)}%`);
      this.logger.warn(`⚠️ Health degraded: ${healthyPercent.toFixed(1)}% healthy clients`);
    }

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (issues.length || healthyPercent < 80) {
      status = healthyPercent >= 30 ? 'degraded' : 'unhealthy';
    }

    const health = { status, readyForOperations: this.isServiceReady(), issues };

    this.logger.debug(`💓 Service health calculated:`, {
      status: health.status,
      readyForOperations: health.readyForOperations,
      healthyPercent: healthyPercent.toFixed(1),
      connectedClients: connected,
      totalClients: clients.size,
      activeMobiles: activeMobiles.length,
      issuesCount: issues.length
    });

    return health;
  }
}
