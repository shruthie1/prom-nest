import { Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { IClientDetails, PromotionState, IChannel } from './interfaces/promotion.interfaces';
import { PromotionStateService } from './services/promotion-state.service';
import { MessageQueueService } from './services/message-queue.service';
import { ConnectionManagerService } from '../connection-manager/connection-manager.service';

// Import utility functions
import { sendPromotionalMessage } from './utils/messaging.utils';
import { getIChannelFromTg } from './utils/channel.utils';
import { fetchDialogs } from './utils/dialogs.utils';
import { checkTelegramHealth } from './utils/health.utils';
import { ActiveChannelsService } from '../active-channels';

@Injectable()
export class PromotionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromotionService.name);
  private isPromotionRunning = false;
  private promotionLoop: NodeJS.Timeout | null = null;
  private readonly PROMOTION_INTERVAL = 5000;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private readonly AUTO_SAVE_INTERVAL = 5 * 60 * 1000;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly promotionStateService: PromotionStateService,
    private readonly messageQueueService: MessageQueueService,
    @Inject(forwardRef(() => ConnectionManagerService))
    private readonly connectionManagerService: ConnectionManagerService,
    private readonly activeChannelsService: ActiveChannelsService,
  ) {}

  async onModuleInit() {
    this.logger.log('PromotionService initialized - Starting global promotion system');
    await this.initializeClientsAndStartPromotion();
  }

  async onModuleDestroy() {
    this.logger.log('PromotionService shutting down - Saving all results');
    this.stopPromotion();
    try {
      await this.promotionStateService.saveAllResults();
      this.logger.log('All results saved successfully during shutdown');
    } catch (error) {
      this.logger.error('Error saving results during shutdown:', error);
    }
  }

  private async initializeClientsAndStartPromotion(): Promise<void> {
    try {
      // Get all managed mobiles from connection manager
      const activeConnections = this.connectionManagerService.getActiveConnections();
      this.logger.log(`Found ${activeConnections.length} managed mobiles: ${activeConnections.join(', ')}`);

      // Initialize states for each client
      for (const mobile of activeConnections) {
        await this.initializeClientState(mobile);
      }

      // Start the global promotion loop
      await this.startPromotion();
    } catch (error) {
      this.logger.error('Error initializing clients and starting promotion:', error);
    }
  }

  private async initializeClientState(mobile: string): Promise<void> {
    try {
      const connectionInfo = this.connectionManagerService.getConnectionInfo(mobile);
      if (!connectionInfo || !connectionInfo.isHealthy) {
        this.logger.warn(`Skipping initialization for unhealthy mobile: ${mobile}`);
        return;
      }

      const clientDetails: IClientDetails = {
        mobile,
        username: connectionInfo.mainAccUsername,
        name: connectionInfo.clientId,
      };

      // Create promotion state
      const state = this.promotionStateService.createPromotionState(clientDetails);

      // Initialize promotion state with default values
      await this.promotionStateService.initializePromotionState(mobile);

      // Try to load existing data for this mobile
      try {
        await this.promotionStateService.importResultsFromJson(mobile);
      } catch (error) {
        this.logger.debug(`No existing data found for ${mobile}, starting fresh`);
      }

      this.logger.log(`Successfully initialized state for mobile: ${mobile}`);
    } catch (error) {
      this.logger.error(`Error initializing state for mobile ${mobile}:`, error);
    }
  }

  async startPromotion(): Promise<void> {
    if (this.isPromotionRunning) {
      this.logger.log('Promotion is already running');
      return;
    }

    this.logger.log('Starting global promotion system...');
    this.isPromotionRunning = true;

    // Start the continuous promotion loop
    this.promotionLoop = setInterval(async () => {
      try {
        await this.promoteInBatches();
        await this.messageQueueService.checkQueuedMessages();
      } catch (error) {
        this.logger.error('Error in global promotion loop:', error);
      }
    }, this.PROMOTION_INTERVAL);

    // Start auto-save for persistence
    this.autoSaveInterval = setInterval(async () => {
      try {
        await this.promotionStateService.saveAllResults();
        this.logger.debug('Auto-saved all results');
      } catch (error) {
        this.logger.error('Error in auto-save:', error);
      }
    }, this.AUTO_SAVE_INTERVAL);
  }

  stopPromotion(): void {
    if (this.promotionLoop) {
      clearInterval(this.promotionLoop);
      this.promotionLoop = null;
    }

    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.isPromotionRunning = false;
    this.logger.log('Global promotion system stopped');
  }

  private async promoteInBatches(): Promise<void> {
    const healthyMobiles = this.promotionStateService.getHealthyMobiles();

    if (healthyMobiles.length === 0) {
      return;
    }
    // Process up to 3 mobiles concurrently to avoid overwhelming the system
    const batches = this.chunkArray(healthyMobiles, 3);

    for (const batch of batches) {
      await Promise.allSettled(
        batch.map((mobile, index) =>
          // Add staggered delay (0-2 seconds) to prevent simultaneous channel access
          this.promoteForMobileWithDelay(mobile, index * 500)
        )
      );
    }
  }

  private async promoteForMobileWithDelay(mobile: string, delay: number): Promise<void> {
    // Add small random delay to stagger mobile promotion timing
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    return this.promoteForMobile(mobile);
  }

  private async promoteForMobile(mobile: string): Promise<void> {
    try {
      const client = await this.connectionManagerService.getTelegramClient(mobile);
      const state = this.promotionStateService.getPromotionStateByMobile(mobile);

      if (!client || !state) {
        this.logger.warn(`Missing client or state for mobile: ${mobile}`);
        return;
      }
      // // Check if client is healthy for promotion
      // if (!isClientHealthyForPromotion(state, mobile)) {
      //   return;
      // }

      // Check Telegram health periodically
      const isHealthy = await checkTelegramHealth(client, state, mobile);
      if (!isHealthy) {
        this.logger.warn(`Telegram health check failed for mobile: ${mobile}`);
        return;
      }

      // Update last checked time
      this.promotionStateService.updateLastCheckedTime(mobile);

      // Ensure we have channels
      if (state.channels.length === 0) {
        this.logger.log(`[${mobile}] No channels available, fetching dialogs...`);
        const channels = await fetchDialogs(client, state, mobile);
        this.promotionStateService.setChannels(mobile, channels);
        if (channels.length === 0) {
          this.logger.warn(`[${mobile}] No channels found in dialogs`);
          return;
        }
      }
      await this.sendPromotionMessage(client, mobile, state);

    } catch (error) {
      this.logger.error(`Error promoting for mobile ${mobile}:`, error);
    }
  }

  private async sendPromotionMessage(
    client: TelegramClient,
    mobile: string,
    state: PromotionState
  ): Promise<void> {
    if (state.channels.length === 0) {
      return;
    }

    // Get current channel
    const currentChannelId = state.channels[state.channelIndex];
    const channelInfo = await this.getChannelInfo(client, currentChannelId);

    if (!channelInfo) {
      this.logger.warn(`[${mobile}] Could not get channel info for ${currentChannelId}`);
      this.moveToNextChannel(mobile, state);
      return;
    }

    // Check if channel is banned
    const isBanned = this.promotionStateService.isChannelBanned(mobile, currentChannelId);
    if (isBanned) {
      this.logger.log(`[${mobile}] Skipping banned channel: ${currentChannelId}`);
      this.moveToNextChannel(mobile, state);
      return;
    }

    // Send the promotional message
    this.promotionStateService.setPromotingStatus(mobile, true);

    try {
      const result = await sendPromotionalMessage(client, mobile, channelInfo, state);

      if (result.sentMessage) {
        // Update state on success
        this.promotionStateService.updateLastMessageTime(mobile);
        this.promotionStateService.incrementSuccessCount(mobile);
        this.promotionStateService.incrementMsgCount(mobile);

        // Add to message queue for checking
        this.messageQueueService.addToQueue(mobile, {
          channelId: currentChannelId,
          messageId: result.sentMessage.id,
          timestamp: Date.now(),
          messageIndex: result.randomIndex,
        });
      } else {
        // Update state on failure
        this.promotionStateService.incrementFailedCount(mobile);
      }
    } finally {
      this.promotionStateService.setPromotingStatus(mobile, false);
      this.moveToNextChannel(mobile, state);
    }
  }

  private moveToNextChannel(mobile: string, state: PromotionState): void {
    const nextIndex = (state.channelIndex + 1) % state.channels.length;

    // If we've completed a full cycle through all channels, reshuffle them
    if (nextIndex === 0 && state.channels.length > 1) {
      this.logger.log(`[${mobile}] Completed full channel cycle, reshuffling channels...`);
      this.promotionStateService.reshuffleChannels(mobile);
    } else {
      this.promotionStateService.setChannelIndex(mobile, nextIndex);
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  // Public API methods
  async getPromotionStatus(): Promise<Record<string, any>> {
    return {
      isRunning: this.isPromotionRunning,
      stats: this.promotionStateService.getMobilePromotionStats(),
      healthyMobiles: this.promotionStateService.getHealthyMobiles(),
    };
  }

  async getMobileStats(mobile: string): Promise<any> {
    try {
      return {
        stats: this.promotionStateService.getMobileStats(mobile),
        promotionResults: this.promotionStateService.getPromotionResults(mobile),
        queueSize: this.messageQueueService.getQueueSize(mobile),
      };
    } catch (error) {
      this.logger.error(`Error getting stats for mobile ${mobile}:`, error);
      throw error;
    }
  }

  async getSystemHealth(): Promise<Record<string, any>> {
    try {
      const activeConnections = this.connectionManagerService.getActiveConnections();
      const activeMobiles = this.connectionManagerService.getCurrentActiveMobiles();
      const promotionStates = this.promotionStateService.getAllMobileStates();
      const availableMobiles = this.connectionManagerService.getAvailableMobiles();

      const healthStatus = {
        promotionService: {
          isRunning: this.isPromotionRunning,
          activeConnections: activeConnections.length,
          availableMobiles: availableMobiles.length,
          activeMobiles: activeMobiles.length,
          promotionStates: promotionStates.size,
          healthyMobiles: this.promotionStateService.getHealthyMobiles().length,
        },
        connectionManager: {
          totalClients: this.connectionManagerService.getAllActiveConnections().size,
          activeTelegramClients: this.connectionManagerService.getActiveTelegramClients().size,
          activeConnections: activeConnections.length,
        },
        rotationManager: {
          totalMobiles: this.promotionStateService.getAllMobileStates().size,
          healthyMobiles: this.promotionStateService.getHealthyMobiles().length,
        },
        sync: {
          inSync: activeConnections.length === promotionStates.size,
          mobilesMissingStates: activeConnections.filter(mobile =>
            !promotionStates.has(mobile)
          ),
          statesWithoutMobiles: Array.from(promotionStates.keys()).filter(mobile =>
            !activeConnections.includes(mobile)
          ),
        }
      };

      return healthStatus;
    } catch (error) {
      this.logger.error('Error getting system health:', error);
      throw error;
    }
  }

  async resetMobilePromotion(mobile: string): Promise<void> {
    this.logger.log(`Resetting promotion for mobile: ${mobile}`);
    this.promotionStateService.resetPromotionResults(mobile);
    this.promotionStateService.resetMobileStats(mobile);
    this.promotionStateService.setChannelIndex(mobile, 0);
    this.messageQueueService.clearQueue(mobile);

    // Save the reset state
    await this.promotionStateService.saveResultsToJson(mobile);
  }

  async saveResults(mobile?: string): Promise<void> {
    if (mobile) {
      await this.promotionStateService.saveResultsToJson(mobile);
    } else {
      await this.promotionStateService.saveAllResults();
    }
  }

  async loadResults(mobile?: string): Promise<void> {
    if (mobile) {
      await this.promotionStateService.importResultsFromJson(mobile);
    } else {
      await this.promotionStateService.loadAllResults();
    }
  }

  async restartPromotion(): Promise<void> {
    this.logger.log('Restarting global promotion system...');
    this.stopPromotion();

    await this.promotionStateService.saveAllResults();
    await this.sleep(3000);
    await this.initializeClientsAndStartPromotion();
  }

  // Helper method for delays
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Dynamic client management methods for connection manager integration
  async addNewClient(mobile: string): Promise<void> {
    this.logger.log(`Adding new client for mobile: ${mobile}`);
    try {
      const connectionInfo = this.connectionManagerService.getConnectionInfo(mobile);
      if (!connectionInfo || !connectionInfo.isHealthy) {
        this.logger.warn(`Cannot add unhealthy client for mobile: ${mobile}`);
        return;
      }

      // Initialize state for the new client
      await this.initializeClientState(mobile);
      this.logger.log(`Successfully added new client: ${mobile}`);
    } catch (error) {
      this.logger.error(`Error adding new client ${mobile}:`, error);
    }
  }

  async removeClient(mobile: string): Promise<void> {
    this.logger.log(`Removing client for mobile: ${mobile}`);
    try {
      // Save current state before removing
      await this.promotionStateService.saveResultsToJson(mobile);

      // Clear message queue and remove state
      this.messageQueueService.clearQueue(mobile);
      this.promotionStateService.removeMobileState(mobile);

      this.logger.log(`Successfully removed client: ${mobile}`);
    } catch (error) {
      this.logger.error(`Error removing client ${mobile}:`, error);
    }
  }

  async handleRotation(): Promise<void> {
    this.logger.log('Syncing promotion service with connection manager');
    try {
      const activeConnections = this.connectionManagerService.getActiveConnections();
      const currentMobiles = Array.from(this.promotionStateService.getAllMobileStates().keys());

      // Add new mobiles
      for (const mobile of activeConnections) {
        if (!currentMobiles.includes(mobile)) {
          await this.addNewClient(mobile);
        }
      }

      // Remove mobiles that are no longer managed
      for (const mobile of currentMobiles) {
        if (!activeConnections.includes(mobile)) {
          await this.removeClient(mobile);
        }
      }

      this.logger.log('Sync with connection manager completed');
    } catch (error) {
      this.logger.error('Error syncing with connection manager:', error);
    }
  }

  async getChannelInfo(client: TelegramClient, channelId: string): Promise<IChannel | null> {
    try {
      let channelInfo: IChannel = await this.activeChannelsService.findOne(channelId);
      if (!channelInfo) {
        console.log(`Channel ${channelId} not found in DB. Fetching from Telegram...`);
        channelInfo = await getIChannelFromTg(client, channelId);
        await this.activeChannelsService.update(channelId, channelInfo);
      }
      return channelInfo;
    } catch (error) {
      console.error(`Error getting channel info for ${channelId}:`, error);
      return null;
    }
  }
}
