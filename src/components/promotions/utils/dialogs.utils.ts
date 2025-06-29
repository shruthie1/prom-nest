// Utility functions for dialog operations
import { TelegramClient, Api } from 'telegram';
import { PromotionState } from '../interfaces/promotion.interfaces';

export async function fetchDialogs(
  client: TelegramClient,
  state: PromotionState,
  mobile: string
): Promise<string[]> {
  const batchSize = 500;
  const channelDataSet = new Set<string>();
  const channelDetails: { channelId: string; participantsCount: number }[] = [];

  console.log(`[${mobile}] Fetching dialogs from clients...`);

  try {
    let offsetDate = 0;
    let currentBatch = 0;

    while (true) {
      const dialogs = await client.getDialogs({
        limit: batchSize,
        offsetDate: offsetDate,
      });

      if (dialogs.length === 0) {
        break;
      }

      for (const dialog of dialogs) {
        if (dialog.entity instanceof Api.Channel) {
          const channel = dialog.entity as Api.Channel;
          if (channel.broadcast && !channel.megagroup) {
            const channelId = channel.id.toString().replace(/^-100/, "");
            const participantsCount = channel.participantsCount || 0;

            if (participantsCount > 100) {
              channelDataSet.add(channelId);
              channelDetails.push({ channelId, participantsCount });
            }
          }
        }
      }

      const lastDialog = dialogs[dialogs.length - 1];
      offsetDate = lastDialog.date || 0;
      currentBatch++;

      if (currentBatch >= 10) { // Limit to prevent infinite loops
        break;
      }
    }

    console.log(`[${mobile}] Found ${channelDataSet.size} channels from dialogs`);
    return Array.from(channelDataSet);
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
