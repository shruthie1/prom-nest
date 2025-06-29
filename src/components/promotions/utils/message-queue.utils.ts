import { TelegramClient } from "telegram";
import { MessageQueueItem } from "../interfaces/promotion.interfaces";
import { fetchWithTimeout } from "../../../utils/fetchWithTimeout";
import { ppplbot } from "../../../utils/logbots";

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
