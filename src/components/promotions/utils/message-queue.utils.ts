import { TelegramClient } from "telegram";
import { MessageQueueItem, PromotionState } from "../interfaces/promotion.interfaces";
import { fetchWithTimeout } from "../../../utils/fetchWithTimeout";
import { ppplbot } from "../../../utils/logbots";

// Memory and performance optimization constants
const MAX_QUEUE_SIZE = 1000;
const MAX_CONCURRENT_CHECKS = 5;
const MESSAGE_CHECK_DELAY = 10000;

/**
 * Check queued messages for existence and handle accordingly
 */
export async function checkQueuedMessages(
    client: TelegramClient,
    state: PromotionState,
    mobile: string
): Promise<void> {
    if (state.messageQueue.length === 0) return;

    const batchSize = Math.min(50, state.messageQueue.length);
    const now = Date.now();

    // Pre-allocate array with known size to avoid reallocation
    const readyMessages: MessageQueueItem[] = [];
    const readyIndices = new Set<number>();

    // Process in-place without creating slice copy
    for (let i = 0; i < Math.min(batchSize, state.messageQueue.length); i++) {
        const item = state.messageQueue[i];
        if ((now - item.timestamp) >= MESSAGE_CHECK_DELAY) {
            readyMessages.push(item);
            readyIndices.add(i);
        }
    }

    if (readyMessages.length === 0) return;

    console.log(`[${mobile}] Checking ${readyMessages.length} messages in queue`);

    // Process messages in parallel with controlled concurrency
    const processedIndices = new Set<number>();

    for (let i = 0; i < readyMessages.length; i += MAX_CONCURRENT_CHECKS) {
        const batch = readyMessages.slice(i, i + MAX_CONCURRENT_CHECKS);
        const batchIndices = Array.from(readyIndices).slice(i, i + MAX_CONCURRENT_CHECKS);

        const promises = batch.map(async (messageItem, batchIndex) => {
            try {
                await checkMessageExist(client, messageItem, mobile);
                processedIndices.add(batchIndices[batchIndex]);
            } catch (error) {
                console.error(`[${mobile}] Error checking message ${messageItem.messageId}:`, error);
                processedIndices.add(batchIndices[batchIndex]);
            }
        });

        await Promise.all(promises);
    }

    // Remove processed items efficiently (reverse order to maintain indices)
    const sortedIndices = Array.from(processedIndices).sort((a, b) => b - a);
    for (const index of sortedIndices) {
        state.messageQueue.splice(index, 1);
    }
}

/**
 * Check if a specific message exists in a channel
 */
export async function checkMessageExist(
    client: TelegramClient,
    messageItem: MessageQueueItem,
    mobile: string
): Promise<void> {
    try {
        const result = await client.getMessages(messageItem.channelId, { minId: messageItem.messageId - 2 });
        if (result.length > 0 && result[0] && result[0].id === messageItem.messageId) {
            await handleExistingMessage(messageItem.channelId, messageItem.messageIndex, result[0].id, mobile);
        } else {
            await handleDeletedMessage(messageItem.channelId, messageItem.messageIndex, messageItem.messageId, mobile);
        }
    } catch (error) {
        console.error(`[${mobile}] Error checking message ${messageItem.messageId} in ${messageItem.channelId}: ${error.message}`);
    }
}

/**
 * Handle when a message has been deleted
 */
async function handleDeletedMessage(channelId: string, messageIndex: string, messageId: number, mobile: string): Promise<void> {
    console.log(`[${mobile}] Message ${messageId} deleted in channel ${channelId}, messageIndex: ${messageIndex}`);
    
    if (messageIndex === '0') {
        console.log(`[${mobile}] Warning: Channel ${channelId} may need to be banned because messageIndex is '0'`);
        
        // Send notification about potential ban
        try {
            await fetchWithTimeout(`${ppplbot()}&text=@${(process.env.clientId).toUpperCase()}-PROM: [${mobile}] Channel ${channelId} may need to be banned.`);
        } catch (error) {
            console.error(`[${mobile}] Failed to send ban notification:`, error);
        }
        
        console.log(`[${mobile}] Channel ${channelId} requires manual review for potential ban.`);
    } else {
        // Log removal notification
        try {
            await fetchWithTimeout(`${ppplbot()}&text=@${(process.env.clientId).toUpperCase()}-PROM: [${mobile}] Message ${messageIndex} removed from channel ${channelId} as messageId : ${messageId}`);
        } catch (error) {
            console.error(`[${mobile}] Failed to send removal notification:`, error);
        }
        
        console.log(`[${mobile}] Message ${messageIndex} removed from channel ${channelId} messagesId: ${messageId}`);
    }
}

/**
 * Handle when a message still exists
 */
async function handleExistingMessage(channelId: string, messageIndex: string, messageId: number, mobile: string): Promise<void> {
    console.log(`[${mobile}] Message EXISTS for channelId: ${channelId}, messageIndex: ${messageIndex}, messageId: ${messageId}`);
    if (messageIndex) {
        console.log(`[${mobile}] Message confirmed to exist - channelId: ${channelId}, messageIndex: ${messageIndex}, messageId: ${messageId}`);
        // In a full implementation, this would update the database with lastMessageTime and messageIndex
        // For now, we just log the successful verification
    } else {
        console.log(`[${mobile}] No message index provided for channel ${channelId}`);
    }
}

/**
 * Add a message to the queue for later checking
 */
export function addToMessageQueue(state: PromotionState, item: MessageQueueItem, mobile: string): void {
    // Implement queue size limit to prevent memory issues
    if (state.messageQueue.length >= MAX_QUEUE_SIZE) {
        // Remove oldest items (FIFO) when queue is full
        const removeCount = Math.floor(MAX_QUEUE_SIZE * 0.1); // Remove 10% when full
        state.messageQueue.splice(0, removeCount);
        console.warn(`[${mobile}] Queue size limit reached, removed ${removeCount} oldest items`);
    }

    state.messageQueue.push(item);
    console.log(`[${mobile}] Added message ${item.messageId} to queue for channel ${item.channelId} (queue size: ${state.messageQueue.length})`);
}
