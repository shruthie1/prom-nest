import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { MessageQueueItem, PromotionState } from '../interfaces/promotion.interfaces';
import { PromotionStateService } from './promotion-state.service';
import { checkMessageExist } from '../utils/message-queue.utils';
import { ConnectionManagerService } from 'src/components/connection-manager';

@Injectable()
export class MessageQueueService {
  private readonly logger = new Logger(MessageQueueService.name);

  constructor(
    private readonly promotionStateService: PromotionStateService,
    @Inject(forwardRef(() => ConnectionManagerService))
    private readonly connectionManagerService: ConnectionManagerService,
  ) {}
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly MESSAGE_CHECK_DELAY = 10000; // 10 seconds
  private readonly messageQueues: Map<string, MessageQueueItem[]> = new Map();
  /**
   * Placeholder: Replace with your actual client retrieval logic
   */
  private async getClientForMobile(mobile: string): Promise<TelegramClient | undefined> {
    return await this.connectionManagerService.getTelegramClient(mobile)
  }

  async checkQueuedMessages(): Promise<void> {
    for (const [mobile, queue] of this.messageQueues.entries()) {
      if (!queue || queue.length === 0) continue;
      const now = Date.now();
      const readyMessages: { item: MessageQueueItem; index: number }[] = [];
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if ((now - item.timestamp) >= this.MESSAGE_CHECK_DELAY) {
          readyMessages.push({ item, index: i });
        }
      }
      if (readyMessages.length === 0) continue;
      this.logger.log(`[${mobile}] Checking ${readyMessages.length} messages in queue`);
      const processedIndices = new Set<number>();
      for (const { item, index } of readyMessages) {
        const client = await this.getClientForMobile(mobile);
        if (!client) {
          this.logger.warn(`[${mobile}] No client found for message ${item.messageId}`);
          continue;
        }
        try {
          await checkMessageExist(client, item, mobile);
          processedIndices.add(index);
        } catch (error) {
          this.logger.error(`[${mobile}] Error checking message ${item.messageId}:`, error);
          processedIndices.add(index);
        }
      }
      const sortedIndices = Array.from(processedIndices).sort((a, b) => b - a);
      for (const index of sortedIndices) {
        queue.splice(index, 1);
      }
      this.logger.log(`[${mobile}] Processed ${processedIndices.size} messages, ${queue.length} remaining in queue`);
    }
  }

  addToQueue(mobile: string, item: MessageQueueItem): void {
    if (!this.messageQueues.has(mobile)) {
      this.messageQueues.set(mobile, []);
    }

    const queue = this.messageQueues.get(mobile)!;

    if (queue.length >= this.MAX_QUEUE_SIZE) {
      const removeCount = Math.floor(this.MAX_QUEUE_SIZE * 0.1); // Remove 10% when full
      queue.splice(0, removeCount);
      this.logger.warn(`[${mobile}] Queue size limit reached, removed ${removeCount} oldest items`);
    }

    queue.push(item);
    this.logger.log(`[${mobile}] Added message ${item.messageId} to queue for channel ${item.channelId} (queue size: ${queue.length})`);
  }

  clearQueue(mobile: string): void {
    const queue = this.messageQueues.get(mobile);
    if (!queue) {
      this.logger.warn(`[${mobile}] No queue found to clear`);
      return;
    }

    const clearedCount = queue.length;
    this.messageQueues.set(mobile, []);
    this.logger.log(`[${mobile}] Cleared message queue: ${clearedCount} items removed`);
  }

  getQueueSize(mobile: string): number {
    const queue = this.messageQueues.get(mobile);
    return queue ? queue.length : 0;
  }
  getActiveMobiles(): string[] {
    return Array.from(this.messageQueues.keys()).filter(mobile =>
      this.messageQueues.get(mobile)!.length > 0
    );
  }

  getQueueStats(): { mobile: string; queueSize: number }[] {
    return Array.from(this.messageQueues.keys()).map(mobile => ({
      mobile,
      queueSize: this.getQueueSize(mobile)
    }));
  }
}
