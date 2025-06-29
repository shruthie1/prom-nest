// Utility functions for dialog operations
import { TelegramClient, Api } from 'telegram';
import { PromotionState } from '../interfaces/promotion.interfaces';
import { sleep } from 'src/utils';
import { shuffleArrayWithMobileSeed } from './shuffle.utils';

export async function fetchDialogs(
  client: TelegramClient,
  state: PromotionState,
  mobile: string
): Promise<string[]> {
  const batchSize = 100;
  const channelDataSet = new Set<string>();
  const channelDetails: { channelId: string; participantsCount: number }[] = [];

  console.log(`[${mobile}] Fetching dialogs from clients...`);

  try {
    let currentBatch = 0;
    let hasmore = true;

    while (hasmore) {
      const dialogs = await client.getDialogs({
        limit: batchSize,
      });
      console.log(`[${mobile}] Fetched ${dialogs.length} dialogs`);
      if (dialogs.length === 0) {
        hasmore = false;
        break;
      }

      for (const dialog of dialogs) {
        const channel = dialog.entity as Api.Channel;
        const channelId = channel.id.toString().replace(/^-100/, "");
        const participantsCount = channel.participantsCount || 0;
        channelDataSet.add(channelId);
        channelDetails.push({ channelId, participantsCount });
      }
      currentBatch++;
      if (currentBatch >= 5 || channelDataSet.size > 300) { // Limit to prevent infinite loops
        break;
      }
      console.log(`[${mobile}] Sleeping for 300 milliseconds to avoid API limits... currentSize: ${channelDataSet.size} | batch: ${currentBatch}`);
      await sleep(300); // Sleep to avoid hitting API limits
    }
    if (channelDataSet.size === 0) {
      console.log(`[${mobile}] No channels found in dialogs.`);
      return [];
    }
    
    // Shuffle the channels using mobile-specific seeding to ensure different but consistent order per mobile
    const channelsArray = Array.from(channelDataSet);
    const shuffledChannels = shuffleArrayWithMobileSeed(channelsArray, mobile);
    
    console.log(`[${mobile}] Found ${channelDataSet.size} channels from dialogs (shuffled with mobile-specific seed)`);
    return shuffledChannels;
  } catch (error) {
    console.error(`[${mobile}] Error fetching dialogs:`, error);
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
