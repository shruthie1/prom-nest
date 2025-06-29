import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { MessageQueueItem, PromotionState } from '../interfaces/promotion.interfaces';
import { PromotionStateService } from './promotion-state.service';
import { checkQueuedMessages, addToMessageQueue, checkMessageExist } from '../utils/message-queue.utils';

@Injectable()
export class MessageQueueService {
  private readonly logger = new Logger(MessageQueueService.name);
  
  constructor(private readonly promotionStateService: PromotionStateService) {}
  
  // Memory and performance optimization constants
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly MAX_CONCURRENT_CHECKS = 5;
  private readonly MESSAGE_CHECK_DELAY = 10000;

  async checkQueuedMessages(
    client: TelegramClient,
    state: PromotionState,
    mobile: string
  ): Promise<void> {
    // Delegate to utility function for core functionality
    await checkQueuedMessages(client, state, mobile);
  }

  addToQueue(mobile: string, item: MessageQueueItem): void {
    const state = this.promotionStateService.getPromotionStateByMobile(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }

    // Use the utility function for consistent behavior
    addToMessageQueue(state, item, mobile);
  }

  clearQueue(mobile: string): void {
    const state = this.promotionStateService.getPromotionStateByMobile(mobile);
    if (!state) {
      throw new Error(`No promotion state found for mobile: ${mobile}`);
    }

    const clearedCount = state.messageQueue.length;
    state.messageQueue = [];
    this.logger.log(`[${mobile}] Cleared message queue: ${clearedCount} items removed`);
  }

  getQueueSize(mobile: string): number {
    const state = this.promotionStateService.getPromotionStateByMobile(mobile);
    if (!state) {
      return 0;
    }
    return state.messageQueue.length;
  }
}
