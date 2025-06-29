// Utility functions for dialog operations
import { TelegramClient, Api } from 'telegram';
import { PromotionState } from '../interfaces/promotion.interfaces';
import { sleep } from 'src/utils';
import { shuffleArrayWithMobileSeed } from './shuffle.utils';
import { fetchWithTimeout } from 'src/utils/fetchWithTimeout';
import { parseError } from 'src/utils/parseError';

export async function fetchDialogs(
  client: TelegramClient,
  state: PromotionState,
  mobile: string
): Promise<string[]> {
  const batchSize = 500;
  const channelDataSet = new Set<string>();
  let channelDetails: { channelId: string; participantsCount: number }[] = [];
  console.log(`[${mobile}] Fetching dialogs from clients...`);
  try {
    const dialogs = await client.getDialogs({ limit: batchSize });

    for (const dialog of dialogs) {
      if (channelDetails.length > 0 && channelDetails.length % 100 === 0) {
        await sleep(2000); // Allow event loop to process other tasks
      }
      if ((dialog as any).isChannel || (dialog as any).isGroup) {
        const chatEntity = dialog.entity as Api.Channel;
        if (
          !chatEntity.broadcast &&
          chatEntity.participantsCount > 500 &&
          !chatEntity.defaultBannedRights?.sendMessages &&
          !chatEntity.restricted &&
          chatEntity.id
        ) {
          const channelId = chatEntity.id.toString().replace(/^-100/, "");
          if (!channelDataSet.has(channelId)) {
            channelDataSet.add(channelId);
            channelDetails.push({
              channelId,
              participantsCount: chatEntity.participantsCount,
            });
          }
        }
      }
    }

    // Simulate daysLeft logic (since we don't have this in parameters)
    // You may want to adapt this to your actual state logic
    const daysLeft =  3 //(state as any)?.daysLeft ?? 1;
    console.log(`[${mobile}] Days Left: ${daysLeft}`);
    if (daysLeft < 0) {
      try {
        const response = await fetchWithTimeout(`${process.env.promoteRepl}/getbannedchannels`, {}, 5);
        if (Array.isArray(response.data) && response.data.length > 150) {
          const bannedChannels = new Set(response.data);
          channelDetails = channelDetails.filter(channel => !bannedChannels.has(channel.channelId));
          console.log(`[${mobile}] Filtered channels, remaining: ${channelDetails.length}`);
        }
      } catch (fetchError) {
        console.log("ERROR", "Error fetching banned channels:", { error: fetchError });
      }
    } else {
      console.log(`[${mobile}] Filtering channels based on previous results...`);
      // Batch processing to avoid memory issues
      const filterBatchSize = 100;
      const filteredChannels = [];
      for (let i = 0; i < channelDetails.length; i += filterBatchSize) {
        const batch = channelDetails.slice(i, i + filterBatchSize);
        const filtered = batch.filter(channel => {
          const stats = state.promotionResults.get(channel.channelId) || { success: true, count: 0, lastCheckTimestamp: 0 };
          return stats.success;
        });
        filteredChannels.push(...filtered);
        // Allow event loop breathing room
        if (i % (filterBatchSize * 3) === 0) {
          await sleep(100);
        }
      }
      channelDetails = filteredChannels;
    }

    // Sort and limit results to manage memory
    channelDetails.sort((a, b) => b.participantsCount - a.participantsCount);
    const maxChannels = Math.min(250, channelDetails.length); // Reduced from 350
    const topChannels = channelDetails.slice(0, maxChannels);

    // Fisher-Yates Shuffle
    for (let i = topChannels.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [topChannels[i], topChannels[j]] = [topChannels[j], topChannels[i]];
    }

    // Clear temporary data structures
    channelDataSet.clear();
    channelDetails = null as any; // Help GC

    return topChannels.map(channel => channel.channelId);
  } catch (error) {
    parseError(error, `Error occurred while fetching dialogs`, true);
    await client.connect();
    return [];
  }
}

export function filterChannelsByMinParticipants(
  channelDetails: { channelId: string; participantsCount: number }[],
  minParticipants: number = 100
): string[] {
  return channelDetails
    .filter(channel => channel.participantsCount >= minParticipants)
    .sort((a, b) => b.participantsCount - a.participantsCount) // Sort by participants descending
    .map(channel => channel.channelId);
}
