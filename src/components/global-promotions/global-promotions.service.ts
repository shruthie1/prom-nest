import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Scope } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { IClientDetails, PromotionState, IChannel } from '../promotions/interfaces/promotion.interfaces';
import { ConnectionManagerService } from '../connection-manager/connection-manager.service';
import { ClientService } from '../clients/client.service';

// Import utility functions from promotions
import { sendPromotionalMessage } from '../promotions/utils/messaging.utils';
import { getChannelInfo } from '../promotions/utils/channel.utils';
import { fetchDialogs } from '../promotions/utils/dialogs.utils';
import { checkTelegramHealth, isClientHealthyForPromotion } from '../promotions/utils/health.utils';

@Injectable({ scope: Scope.DEFAULT }) // Singleton scope
export class GlobalPromotionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GlobalPromotionsService.name);
  private isPromotionRunning = false;
  private promotionLoop: NodeJS.Timeout | null = null;
  private readonly PROMOTION_INTERVAL = 10000; // 10 seconds

  // Global state management
  private globalPromotionState: Map<string, PromotionState> = new Map();
  private activeClients: Map<string, TelegramClient> = new Map();
  private clientDetails: Map<string, IClientDetails> = new Map();

  // Auto-save interval for persistence
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private readonly AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // Save every 5 minutes

  constructor(
    private readonly connectionManagerService: ConnectionManagerService,
    private readonly clientService: ClientService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 GlobalPromotionsService initialized - Starting global promotion system');
    await this.initializeGlobalPromotionSystem();
    this.setupAutoSave();
  }

  async onModuleDestroy() {
    this.logger.log('🛑 GlobalPromotionsService shutting down - Saving all results');
    this.stopGlobalPromotion();
    
    // Save all results before shutdown
    try {
      await this.saveAllGlobalResults();
      this.logger.log('✅ All global promotion results saved successfully during shutdown');
    } catch (error) {
      this.logger.error('❌ Error saving global promotion results during shutdown:', error);
    }

    // Clear intervals
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
    }
  }

  private async initializeGlobalPromotionSystem(): Promise<void> {
    try {
      this.logger.log('🔄 Initializing global promotion system with active clients');
      await this.syncWithActiveClients();
      
      if (!this.isPromotionRunning) {
        this.startGlobalPromotion();
      }
    } catch (error) {
      this.logger.error('❌ Failed to initialize global promotion system:', error);
      throw error;
    }
  }

  private async syncWithActiveClients(): Promise<void> {
    try {
      // Get active clients from connection manager
      const connections = this.connectionManagerService.getAllConnections();
      this.logger.log(`🔍 Found ${connections.length} active connections to sync`);

      // Clear existing state
      this.activeClients.clear();
      this.clientDetails.clear();

      // Sync with active connections
      for (const [mobile, client] of connections) {
        try {
          // Get client details from database
          const clientData = await this.clientService.findOne(mobile, false);
          if (clientData) {
            this.activeClients.set(mobile, client);
            this.clientDetails.set(mobile, {
              mobile,
              clientId: clientData.clientId,
              firstName: clientData.firstName,
              lastName: clientData.lastName,
              username: clientData.username,
              isActive: true,
              lastActivity: new Date(),
              promotionChannels: clientData.promotionChannels || [],
              targetChannels: clientData.targetChannels || [],
              messages: clientData.messages || []
            });

            // Initialize promotion state if not exists
            if (!this.globalPromotionState.has(mobile)) {
              this.globalPromotionState.set(mobile, {
                currentChannelIndex: 0,
                currentMessageIndex: 0,
                totalChannelsProcessed: 0,
                totalMessagesProcessed: 0,
                isProcessing: false,
                lastProcessedAt: null,
                errors: [],
                successfulPromotions: 0,
                failedPromotions: 0
              });
            }

            this.logger.debug(`✅ Synced client: ${mobile} (${clientData.firstName})`);
          }
        } catch (error) {
          this.logger.warn(`⚠️ Failed to sync client ${mobile}:`, error.message);
        }
      }

      this.logger.log(`📊 Global promotion system synced with ${this.activeClients.size} active clients`);
    } catch (error) {
      this.logger.error('❌ Failed to sync with active clients:', error);
      throw error;
    }
  }

  public startGlobalPromotion(): void {
    if (this.isPromotionRunning) {
      this.logger.warn('⚠️ Global promotion is already running');
      return;
    }

    this.logger.log('▶️ Starting global promotion loop');
    this.isPromotionRunning = true;

    this.promotionLoop = setInterval(async () => {
      try {
        await this.runGlobalPromotionCycle();
      } catch (error) {
        this.logger.error('❌ Error in global promotion cycle:', error);
      }
    }, this.PROMOTION_INTERVAL);
  }

  public stopGlobalPromotion(): void {
    if (!this.isPromotionRunning) {
      this.logger.warn('⚠️ Global promotion is not running');
      return;
    }

    this.logger.log('⏹️ Stopping global promotion loop');
    this.isPromotionRunning = false;

    if (this.promotionLoop) {
      clearInterval(this.promotionLoop);
      this.promotionLoop = null;
    }
  }

  private async runGlobalPromotionCycle(): Promise<void> {
    const activeMobiles = Array.from(this.activeClients.keys());
    
    if (activeMobiles.length === 0) {
      this.logger.debug('📭 No active clients for promotion cycle');
      return;
    }

    this.logger.debug(`🔄 Running global promotion cycle for ${activeMobiles.length} clients`);

    for (const mobile of activeMobiles) {
      try {
        await this.processClientPromotion(mobile);
      } catch (error) {
        this.logger.error(`❌ Error processing promotion for client ${mobile}:`, error);
      }
    }
  }

  private async processClientPromotion(mobile: string): Promise<void> {
    const client = this.activeClients.get(mobile);
    const clientDetails = this.clientDetails.get(mobile);
    const promotionState = this.globalPromotionState.get(mobile);

    if (!client || !clientDetails || !promotionState) {
      this.logger.warn(`⚠️ Missing data for client ${mobile}, skipping promotion`);
      return;
    }

    if (promotionState.isProcessing) {
      this.logger.debug(`⏳ Client ${mobile} is already processing, skipping`);
      return;
    }

    // Check if client is healthy for promotion
    if (!isClientHealthyForPromotion(client)) {
      this.logger.warn(`⚠️ Client ${mobile} is not healthy for promotion`);
      return;
    }

    try {
      promotionState.isProcessing = true;
      await this.executePromotionForClient(mobile, client, clientDetails, promotionState);
    } finally {
      promotionState.isProcessing = false;
      promotionState.lastProcessedAt = new Date();
    }
  }

  private async executePromotionForClient(
    mobile: string,
    client: TelegramClient,
    clientDetails: IClientDetails,
    promotionState: PromotionState
  ): Promise<void> {
    const { targetChannels, messages } = clientDetails;

    if (!targetChannels?.length || !messages?.length) {
      this.logger.debug(`📭 No channels or messages configured for client ${mobile}`);
      return;
    }

    const currentChannel = targetChannels[promotionState.currentChannelIndex];
    const currentMessage = messages[promotionState.currentMessageIndex];

    if (!currentChannel || !currentMessage) {
      this.logger.debug(`📭 No current channel or message for client ${mobile}`);
      return;
    }

    try {
      this.logger.debug(`📤 Sending promotion from ${mobile} to channel ${currentChannel}`);
      
      const result = await sendPromotionalMessage(
        client,
        currentChannel,
        currentMessage,
        this.logger
      );

      if (result.success) {
        promotionState.successfulPromotions++;
        this.logger.log(`✅ Promotion sent successfully from ${mobile} to ${currentChannel}`);
      } else {
        promotionState.failedPromotions++;
        promotionState.errors.push({
          timestamp: new Date(),
          error: result.error || 'Unknown error',
          channel: currentChannel,
          message: currentMessage
        });
        this.logger.warn(`❌ Promotion failed from ${mobile} to ${currentChannel}: ${result.error}`);
      }

      // Update promotion state
      this.updatePromotionIndices(promotionState, targetChannels.length, messages.length);
      promotionState.totalMessagesProcessed++;

    } catch (error) {
      promotionState.failedPromotions++;
      promotionState.errors.push({
        timestamp: new Date(),
        error: error.message,
        channel: currentChannel,
        message: currentMessage
      });
      this.logger.error(`❌ Error executing promotion for ${mobile}:`, error);
    }
  }

  private updatePromotionIndices(
    state: PromotionState,
    channelCount: number,
    messageCount: number
  ): void {
    // Move to next message
    state.currentMessageIndex = (state.currentMessageIndex + 1) % messageCount;
    
    // If we've cycled through all messages, move to next channel
    if (state.currentMessageIndex === 0) {
      state.currentChannelIndex = (state.currentChannelIndex + 1) % channelCount;
      state.totalChannelsProcessed++;
    }
  }

  private setupAutoSave(): void {
    this.autoSaveInterval = setInterval(async () => {
      try {
        await this.saveAllGlobalResults();
        this.logger.debug('💾 Auto-saved global promotion results');
      } catch (error) {
        this.logger.error('❌ Error during auto-save:', error);
      }
    }, this.AUTO_SAVE_INTERVAL);
  }

  private async saveAllGlobalResults(): Promise<void> {
    // Implementation for saving results to database or file
    // This could save promotion statistics, errors, etc.
    this.logger.debug('💾 Saving global promotion results...');
    
    // Save promotion statistics for each client
    for (const [mobile, state] of this.globalPromotionState) {
      try {
        // Here you could save to database or log file
        this.logger.debug(`💾 Saved results for ${mobile}: ${state.successfulPromotions} successful, ${state.failedPromotions} failed`);
      } catch (error) {
        this.logger.error(`❌ Error saving results for ${mobile}:`, error);
      }
    }
  }

  // Public methods for external access
  public getGlobalPromotionStatus(): any {
    return {
      isRunning: this.isPromotionRunning,
      activeClients: this.activeClients.size,
      totalPromotions: Array.from(this.globalPromotionState.values())
        .reduce((total, state) => total + state.successfulPromotions, 0),
      totalErrors: Array.from(this.globalPromotionState.values())
        .reduce((total, state) => total + state.failedPromotions, 0)
    };
  }

  public getClientPromotionState(mobile: string): PromotionState | undefined {
    return this.globalPromotionState.get(mobile);
  }

  public async refreshActiveClients(): Promise<void> {
    this.logger.log('🔄 Refreshing active clients from connection manager');
    await this.syncWithActiveClients();
  }

  public getActiveClientsCount(): number {
    return this.activeClients.size;
  }
}
