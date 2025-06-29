import { Injectable, Logger } from '@nestjs/common';
import { PromotionState, PromotionConfig, IClientDetails, PromotionResult, MobileStats } from '../interfaces/promotion.interfaces';

@Injectable()
export class PromotionStateService {
  private readonly logger = new Logger(PromotionStateService.name);

  private readonly DEFAULT_CONFIG: PromotionConfig = {
    messageCheckDelay: 10000,
    maxResultsSize: 5000
  };

  // Global state management per mobile
  private readonly mobilePromotionStates: Map<string, PromotionState> = new Map();

  createPromotionState(clientDetails: IClientDetails): PromotionState {
    const mobile = clientDetails.mobile;
    this.logger.log(`[${mobile}] Creating promotion state`);

    const state: PromotionState = {
      promotionResults: new Map(),
      daysLeft: -1,
      sleepTime: 0,
      successCount: 0,
      failedCount: 0,
      releaseTime: 0,
      tempFailCount: 0,
      lastMessageTime: Date.now() - 16 * 60 * 1000,
      lastCheckedTime: 0,
      channels: [],
      messageQueue: [],
      promoteMsgs: {},
      channelIndex: 0,
      failureReason: null,
      isPromoting: false,
      messageCount: 0,
      converted: 0,
      messageQueueInterval: null
    };

    if (!this.mobilePromotionStates.has(mobile)) {
      this.mobilePromotionStates.set(mobile, state);
    }
    this.logger.log(`[${mobile}] Promotion state created and stored`);

    return state;
  }

  getPromotionStateByMobile(mobile: string): PromotionState | undefined {
    return this.mobilePromotionStates.get(mobile);
  }

  getAllMobileStates(): Map<string, PromotionState> {
    return new Map(this.mobilePromotionStates);
  }

  removeMobileState(mobile: string): boolean {
    this.logger.log(`[${mobile}] Removing promotion state`);
    return this.mobilePromotionStates.delete(mobile);
  }

  async initializePromotionState(mobile: string): Promise<void> {
    this.logger.log(`[${mobile}] Initializing promotion state`);
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    try {
      // Note: You would need to inject the database service
      // const db = this.databaseService.getInstance();
      // state.promoteMsgs = await db.getPromoteMsgs();
      state.promoteMsgs = { '0': 'Default promotion message' }; // Fallback
      this.logger.log(`[${mobile}] Promotion messages loaded: ${Object.keys(state.promoteMsgs).length} messages`);
    } catch (error) {
      this.logger.error(`[${mobile}] Failed to initialize promotion state:`, error);
      throw error;
    }
  }

  setDaysLeft(mobile: string, daysLeft: number): void {
    this.logger.log(`[${mobile}] Setting days left: ${daysLeft}`);
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.daysLeft = daysLeft;
    if (daysLeft < 0) {
      this.logger.log(`[${mobile}] Days left is negative, resetting promotion results`);
      this.resetPromotionResults(mobile);
    }
  }

  incrementMsgCount(mobile: string): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.messageCount++;
    this.logger.log(`[${mobile}] Message count incremented to: ${state.messageCount}`);
  }

  incrementConvertedCount(mobile: string): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.converted++;
    this.logger.log(`[${mobile}] Converted count incremented to: ${state.converted}`);
  }

  resetPromotionResults(mobile: string): void {
    this.logger.log(`[${mobile}] Resetting promotion results...!!`);
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    const previousSize = state.promotionResults.size;
    state.promotionResults = new Map();
    this.logger.log(`[${mobile}] Promotion results reset. Cleared ${previousSize} entries`);
  }

  getBannedChannels(mobile: string): string[] {
    this.logger.log(`[${mobile}] Getting banned channels`);
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    const bannedUserKeys: string[] = [];
    state.promotionResults.forEach((value, key) => {
      if (!value.success &&
        value.lastCheckTimestamp > Date.now() - (3 * 24 * 60 * 60 * 1000) &&
        value.errorMessage === "USER_BANNED_IN_CHANNEL") {
        bannedUserKeys.push(key);
      }
    });
    this.logger.log(`[${mobile}] Found ${bannedUserKeys.length} banned channels`);
    return bannedUserKeys;
  }

  getHealthyMobiles(): string[] {
    const healthyMobiles: string[] = [];
    this.mobilePromotionStates.forEach((state, mobile) => {
      const isHealthy = state.daysLeft < 7 &&
        ((state.lastMessageTime < Date.now() - 12 * 60 * 1000 && state.daysLeft < 1) ||
          (state.lastMessageTime < Date.now() - 3 * 60 * 1000 && state.daysLeft > 0)) &&
        state.sleepTime < Date.now();
      if (isHealthy) {
        healthyMobiles.push(mobile);
      }
    });
    if (healthyMobiles.length > 0) {
      this.logger.log(`Healthy mobiles: ${healthyMobiles.join(', ')}`);
    }
    return healthyMobiles;
  }

  cleanupOldPromotionResults(mobile: string): void {
    this.logger.log(`[${mobile}] Starting cleanup of old promotion results`);
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    const threeDaysAgo = Date.now() - (3 * 24 * 60 * 60 * 1000);
    const toDelete: string[] = [];

    state.promotionResults.forEach((value, key) => {
      if (!value.lastCheckTimestamp || value.lastCheckTimestamp < threeDaysAgo) {
        toDelete.push(key);
      }
    });

    toDelete.forEach(key => {
      state.promotionResults.delete(key);
    });

    if (toDelete.length > 0) {
      this.logger.log(`[${mobile}] Cleaned up ${toDelete.length} old promotion results (older than 3 days)`);
    } else {
      this.logger.log(`[${mobile}] No old promotion results to clean up`);
    }
  }

  cleanupPromotionResults(mobile: string): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    if (state.promotionResults.size > this.DEFAULT_CONFIG.maxResultsSize) {
      this.logger.warn(`[${mobile}] Promotion results exceeded ${this.DEFAULT_CONFIG.maxResultsSize} items, cleaning up old entries`);
      const originalSize = state.promotionResults.size;
      const entries = Array.from(state.promotionResults.entries());
      const sortedEntries = entries.sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
      state.promotionResults = new Map(sortedEntries.slice(0, this.DEFAULT_CONFIG.maxResultsSize));
      this.logger.log(`[${mobile}] Cleaned up promotion results from ${originalSize} to ${state.promotionResults.size} entries`);
    }
  }

  // Centralized state update functions
  updateLastMessageTime(mobile: string, timestamp?: number): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    const previousTime = state.lastMessageTime;
    state.lastMessageTime = timestamp || Date.now();
    const timeDiff = ((state.lastMessageTime - previousTime) / 60000).toFixed(2);
    this.logger.log(`[${mobile}] Last message time updated (${timeDiff} mins since last update)`);
  }

  updateLastCheckedTime(mobile: string, timestamp?: number): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.lastCheckedTime = timestamp || Date.now();
    this.logger.log(`[${mobile}] Last checked time updated to: ${new Date(state.lastCheckedTime).toISOString()}`);
  }

  incrementSuccessCount(mobile: string): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.successCount++;
    state.tempFailCount = 0; // Reset temp fail count on success
    this.logger.log(`[${mobile}] Success count incremented to: ${state.successCount} (tempFailCount reset)`);
  }

  incrementFailedCount(mobile: string): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.failedCount++;
    state.tempFailCount++;
    this.logger.log(`[${mobile}] Failed count incremented to: ${state.failedCount} (tempFailCount: ${state.tempFailCount})`);
  }

  incrementTempFailCount(mobile: string): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.tempFailCount++;
    this.logger.log(`[${mobile}] Temp fail count incremented to: ${state.tempFailCount}`);
  }

  resetTempFailCount(mobile: string): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.tempFailCount = 0;
    this.logger.log(`[${mobile}] Temp fail count reset to 0`);
  }

  setSleepTime(mobile: string, sleepTime: number): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.sleepTime = sleepTime;
    this.logger.log(`[${mobile}] Sleep time set to: ${sleepTime} (${new Date(sleepTime).toISOString()})`);
  }

  setFailureReason(mobile: string, reason: string | null): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.failureReason = reason;
    this.logger.log(`[${mobile}] Failure reason set to: ${reason}`);
  }

  setPromotingStatus(mobile: string, isPromoting: boolean): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.isPromoting = isPromoting;
    this.logger.log(`[${mobile}] Promoting status set to: ${isPromoting}`);
  }

  setChannelIndex(mobile: string, index: number): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.channelIndex = index;
    this.logger.log(`[${mobile}] Channel index set to: ${index}`);
  }

  updateSleepTime(mobile: string, sleepUntil: number): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.sleepTime = sleepUntil;
    const sleepMinutes = ((sleepUntil - Date.now()) / 60000).toFixed(2);
    this.logger.log(`[${mobile}] Sleep time set to sleep for ${sleepMinutes} minutes`);
  }

  updateChannelIndex(mobile: string, newIndex: number): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.channelIndex = newIndex;
  }

  setChannels(mobile: string, channels: string[]): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    state.channels = channels;
    state.channelIndex = 0; // Reset index when setting new channels
    this.logger.log(`[${mobile}] Channels set: ${channels.length} channels loaded, index reset to 0`);
  }

  updatePromotionResult(
    mobile: string,
    channelId: string,
    result: { success: boolean; errorMessage?: string; count?: number; lastCheckTimestamp?: number }
  ): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }
    const updatedResult: PromotionResult = {
      success: result.success,
      count: result.count || 0,
      errorMessage: result.errorMessage,
      lastCheckTimestamp: result.lastCheckTimestamp || Date.now()
    };

    state.promotionResults.set(channelId, updatedResult);
    this.logger.log(`[${mobile}] Promotion result updated for channel ${channelId}: ${result.success ? 'SUCCESS' : 'FAILED'} ${result.errorMessage ? `(${result.errorMessage})` : ''}`);
  }

  // JSON persistence methods
  async saveResultsToJson(mobile: string): Promise<void> {
    this.logger.log(`[${mobile}] Saving results to JSON`);
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }

    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const dir = path.dirname(`./mobileStats-${mobile}.json`);
      await fs.mkdir(dir, { recursive: true });
      
      const data = {
        mobileStats: this.getMobileStats(mobile),
        promotionResults: this.getPromotionResults(mobile),
      };
      
      await fs.writeFile(`./mobileStats-${mobile}.json`, JSON.stringify(data, null, 2), 'utf-8');
      this.logger.log(`[${mobile}] Results saved to mobileStats-${mobile}.json`);
    } catch (error) {
      this.logger.error(`[${mobile}] Failed to save results to ./mobileStats-${mobile}.json:`, error);
    }
  }

  async importResultsFromJson(mobile: string): Promise<void> {
    this.logger.log(`[${mobile}] Importing results from JSON`);
    try {
      const fs = await import('fs/promises');
      const rawData = await fs.readFile(`./mobileStats-${mobile}.json`, 'utf-8');
      const data = JSON.parse(rawData);

      if (!data.mobileStats || !data.promotionResults) {
        this.logger.error(`[${mobile}] Invalid JSON format: Required keys are missing.`);
        return;
      }

      this.setMobileStats(mobile, data.mobileStats);
      this.setPromotionResults(mobile, data.promotionResults);
      this.logger.log(`[${mobile}] Results imported from ./mobileStats-${mobile}.json`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.log(`[${mobile}] File not found: ./mobileStats-${mobile}.json (this is normal for first run)`);
      } else if (error instanceof SyntaxError) {
        this.logger.error(`[${mobile}] Failed to parse JSON from ./mobileStats-${mobile}.json:`, error);
      } else {
        this.logger.error(`[${mobile}] Failed to import results from ./mobileStats-${mobile}.json:`, error);
      }
    }
  }

  // Stats getter/setter methods
  getMobileStats(mobile: string): MobileStats {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }

    return {
      messageCount: state.messageCount,
      successCount: state.successCount,
      failedCount: state.failedCount,
      daysLeft: state.daysLeft,
      lastCheckedTime: state.lastCheckedTime,
      sleepTime: state.sleepTime,
      releaseTime: state.releaseTime,
      lastMessageTime: state.lastMessageTime,
      converted: state.converted
    };
  }

  setMobileStats(mobile: string, mobileStats: MobileStats): void {
    this.logger.log(`[${mobile}] Setting mobile stats`);
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }

    state.messageCount = mobileStats.messageCount || 0;
    state.successCount = mobileStats.successCount || 0;
    state.failedCount = mobileStats.failedCount || 0;
    state.sleepTime = mobileStats.sleepTime || 0;
    state.releaseTime = mobileStats.releaseTime || 0;
    state.lastMessageTime = mobileStats.lastMessageTime || Date.now() - 16 * 60 * 1000;
    state.daysLeft = mobileStats.daysLeft || -1;
    state.lastCheckedTime = mobileStats.lastCheckedTime || Date.now();
    state.converted = mobileStats.converted || 0;
    
    this.logger.log(`[${mobile}] Mobile stats updated - Messages: ${state.messageCount}, Success: ${state.successCount}, Failed: ${state.failedCount}`);
  }

  resetMobileStats(mobile: string): void {
    this.logger.log(`[${mobile}] Resetting Mobile Stats...!!`);
    this.setMobileStats(mobile, {
      successCount: 0,
      failedCount: 0,
      sleepTime: 0,
      releaseTime: 0,
      lastMessageTime: Date.now() - 16 * 60 * 1000,
      daysLeft: -1,
      lastCheckedTime: Date.now() - 16 * 60 * 1000,
      messageCount: 0,
      converted: 0
    });
  }

  getPromotionResults(mobile: string): Record<string, PromotionResult> {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }

    this.logger.log(`[${mobile}] Getting promotion results: ${state.promotionResults.size} entries`);
    const result: Record<string, PromotionResult> = {};
    for (const [key, value] of state.promotionResults) {
      result[key] = value;
    }
    return result;
  }

  setPromotionResults(mobile: string, promotionResults: Record<string, PromotionResult>): void {
    const state = this.mobilePromotionStates.get(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }

    this.logger.log(`[${mobile}] Setting promotion results: ${Object.keys(promotionResults).length} entries`);
    const entries = Object.entries(promotionResults).map(([key, value]) => {
      const updatedValue = {
        ...value,
        lastCheckTimestamp: value.lastCheckTimestamp || Date.now()
      };
      return [key, updatedValue] as [string, PromotionResult];
    });

    state.promotionResults = new Map(entries);
    this.logger.log(`[${mobile}] Promotion results set successfully`);
  }

  // Automatic save methods
  async saveAllResults(): Promise<void> {
    this.logger.log('Saving all mobile results to JSON files');
    const savePromises = Array.from(this.mobilePromotionStates.keys()).map(mobile => 
      this.saveResultsToJson(mobile).catch(error => 
        this.logger.error(`Failed to save results for ${mobile}:`, error)
      )
    );
    await Promise.allSettled(savePromises);
  }

  async loadAllResults(): Promise<void> {
    this.logger.log('Loading all mobile results from JSON files');
    const loadPromises = Array.from(this.mobilePromotionStates.keys()).map(mobile => 
      this.importResultsFromJson(mobile).catch(error => 
        this.logger.error(`Failed to load results for ${mobile}:`, error)
      )
    );
    await Promise.allSettled(loadPromises);
  }

  // Utility functions
  getMobilePromotionStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    this.mobilePromotionStates.forEach((state, mobile) => {
      stats[mobile] = {
        messageCount: state.messageCount,
        successCount: state.successCount,
        failedCount: state.failedCount,
        daysLeft: state.daysLeft,
        isPromoting: state.isPromoting,
        tempFailCount: state.tempFailCount,
        lastMessageTime: state.lastMessageTime,
        channelsAvailable: state.channels.length,
        queuedMessages: state.messageQueue.length
      };
    });
    return stats;
  }

  logAllMobileStates(): void {
    this.logger.log("=== ALL MOBILE PROMOTION STATES ===");
    this.mobilePromotionStates.forEach((state, mobile) => {
      const lastMsgMinutes = ((Date.now() - state.lastMessageTime) / 60000).toFixed(2);
      this.logger.log(`[${mobile}] Messages: ${state.messageCount}, Success: ${state.successCount}, Failed: ${state.failedCount}, Days Left: ${state.daysLeft}, Last Msg: ${lastMsgMinutes}mins ago, Promoting: ${state.isPromoting}`);
    });
    this.logger.log("=== END MOBILE STATES ===");
  }
}
