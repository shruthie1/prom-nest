import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { IClientDetails, PromotionState, IChannel } from './interfaces/promotion.interfaces';
import { PromotionStateService } from './services/promotion-state.service';
import { MessageQueueService } from './services/message-queue.service';
import { ConnectionManagerService } from '../connection-manager/connection-manager.service';

// Import utility functions
import { sendPromotionalMessage } from './utils/messaging.utils';
import { getChannelInfo } from './utils/channel.utils';
import { fetchDialogs } from './utils/dialogs.utils';
import { checkTelegramHealth, isClientHealthyForPromotion } from './utils/health.utils';

@Injectable()
export class PromotionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PromotionService.name);
  private isPromotionRunning = false;
  private promotionLoop: NodeJS.Timeout | null = null;
  private readonly PROMOTION_INTERVAL = 10000; // 10 seconds

  // Auto-save interval for persistence
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private readonly AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // Save every 5 minutes

  constructor(
    private readonly promotionStateService: PromotionStateService,
    private readonly messageQueueService: MessageQueueService,
    private readonly connectionManagerService: ConnectionManagerService,
  ) {}

  async onModuleInit() {
    this.logger.log('PromotionService initialized - Starting global promotion system');
    await this.initializeClientsAndStartPromotion();
  }

  async onModuleDestroy() {
    this.logger.log('PromotionService shutting down - Saving all results');
    this.stopPromotion();
    
    // Save all results before shutdown
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
      const managedMobiles = this.connectionManagerService.getManagedMobiles();
      this.logger.log(`Found ${managedMobiles.length} managed mobiles: ${managedMobiles.join(', ')}`);

      // Initialize states for each client
      for (const mobile of managedMobiles) {
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
    
    this.isPromotionRunning = false;
    this.logger.log('Global promotion system stopped');
  }

  private async promoteInBatches(): Promise<void> {
    const healthyMobiles = this.promotionStateService.getHealthyMobiles();
    
    if (healthyMobiles.length === 0) {
      return;
    }

    this.logger.log(`Processing ${healthyMobiles.length} healthy mobiles`);

    // Process up to 3 mobiles concurrently to avoid overwhelming the system
    const batches = this.chunkArray(healthyMobiles, 3);
    
    for (const batch of batches) {
      await Promise.allSettled(
        batch.map(mobile => this.promoteForMobile(mobile))
      );
    }
  }

  private async promoteForMobile(mobile: string): Promise<void> {
    try {
      const client = this.connectionManagerService.getTelegramClient(mobile);
      const state = this.promotionStateService.getPromotionStateByMobile(mobile);

      if (!client || !state) {
        this.logger.warn(`Missing client or state for mobile: ${mobile}`);
        return;
      }

      // Check if client is healthy for promotion
      if (!isClientHealthyForPromotion(state, mobile)) {
        return;
      }

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

      // Process message queue
      await this.messageQueueService.checkQueuedMessages(client, state, mobile);

      // Send promotional message
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
    const channelInfo = await getChannelInfo(client, currentChannelId);

    if (!channelInfo) {
      this.logger.warn(`[${mobile}] Could not get channel info for ${currentChannelId}`);
      this.moveToNextChannel(mobile, state);
      return;
    }

    // Check if channel is banned
    const bannedChannels = this.promotionStateService.getBannedChannels(mobile);
    if (bannedChannels.includes(currentChannelId)) {
      this.logger.log(`[${mobile}] Skipping banned channel: ${currentChannelId}`);
      this.moveToNextChannel(mobile, state);
      return;
    }

    // Send the promotional message
    this.promotionStateService.setPromotingStatus(mobile, true);
    
    try {
      const result = await sendPromotionalMessage(client, mobile, channelInfo, state);
      
      if (result) {
        // Update state on success
        this.promotionStateService.updateLastMessageTime(mobile);
        this.promotionStateService.incrementSuccessCount(mobile);
        this.promotionStateService.incrementMsgCount(mobile);
        
        // Add to message queue for checking
        this.messageQueueService.addToQueue(mobile, {
          channelId: currentChannelId,
          messageId: result.id,
          timestamp: Date.now(),
          messageIndex: state.channelIndex.toString()
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
    this.promotionStateService.setChannelIndex(mobile, nextIndex);
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
    
    // Save current state before restart
    await this.promotionStateService.saveAllResults();
    
    // Wait a moment
    await this.sleep(3000);

    // Reinitialize all clients
    await this.initializeClientsAndStartPromotion();
  }

  // Helper method for delays
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
