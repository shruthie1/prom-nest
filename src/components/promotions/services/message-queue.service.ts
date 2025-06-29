import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import { MessageQueueItem, PromotionState } from '../interfaces/promotion.interfaces';
import { PromotionStateService } from './promotion-state.service';
import { ConnectionManagerService } from 'src/components/connection-manager';
import { ActiveChannelsService } from 'src/components/active-channels';
import { fetchWithTimeout, ppplbot } from 'src/utils';

@Injectable()
export class MessageQueueService {
  private readonly logger = new Logger(MessageQueueService.name);

  constructor(
    private readonly promotionStateService: PromotionStateService,
    @Inject(forwardRef(() => ConnectionManagerService))
    private readonly connectionManagerService: ConnectionManagerService,
    private readonly activeChannelsService: ActiveChannelsService
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
          await this.checkMessageExist(client, item, mobile);
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

  async checkMessageExist(
    client: TelegramClient,
    messageItem: MessageQueueItem,
    mobile: string
  ): Promise<void> {
    try {
      const result = await client.getMessages(messageItem.channelId, { minId: messageItem.messageId - 2 });
      if (result.length > 0 && result[0] && result[0].id === messageItem.messageId) {
        await this.handleExistingMessage(messageItem.channelId, messageItem.messageIndex, result[0].id, mobile);
      } else {
        await this.handleDeletedMessage(messageItem.channelId, messageItem.messageIndex, messageItem.messageId, mobile);
      }
    } catch (error) {
      console.error(`[${mobile}] Error checking message ${messageItem.messageId} in ${messageItem.channelId}: ${error.message}`);
    }
  }

  async handleDeletedMessage(channelId: string, messageIndex: string, messageId: number, mobile: string) {
    if (messageIndex == '0') {
      const channelInfo = await this.activeChannelsService.findOne(channelId);
      if (channelInfo.availableMsgs.length < 1) {
        console.log(`[${mobile}]  Setting channel ${channelId} as banned because messageIndex is '0'`);
        await this.activeChannelsService.update(channelId, { banned: true });
        console.log(`[${mobile}] Channel ${channelId} is now banned.`);
        await fetchWithTimeout(`${ppplbot()}&text=@${(process.env.clientId).toUpperCase()}-PROM: Channel ${channelId} is now banned.`);
      }
    } else {
      const result = await this.activeChannelsService.removeFromAvailableMsgs(channelId, messageIndex);
      console.log(`[${mobile}] Message Deleted ${messageIndex} from channel ${channelId} messagesId: ${messageId}`);
      await fetchWithTimeout(`${ppplbot()}&text=@${(process.env.clientId).toUpperCase()}-PROM: [${mobile}] message Deleted ${messageIndex} from channel ${channelId} as messageId : ${messageId}`);
    }
  }

  async handleExistingMessage(channelId: string, messageIndex: string, messageId: number, mobile: string) {
    console.log(`[${mobile}]  Message EXISTS for channelId: ${channelId}, messageIndex: ${messageIndex}, messageId: ${messageId}`);
    if (messageIndex) {
      const result = await this.activeChannelsService.update(channelId, { lastMessageTime: Date.now() });
    } else {
      console.log(`No message index provided for channel ${channelId}`);
    }
  }
}
