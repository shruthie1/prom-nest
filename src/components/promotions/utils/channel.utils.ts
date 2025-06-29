// Utility functions for channel operations
import { TelegramClient, Api } from 'telegram';
import { IChannel } from '../interfaces/promotion.interfaces';

export async function getChannelInfo(
  client: TelegramClient,
  channelId: string
): Promise<IChannel | null> {
  console.log(`Getting channel info for ${channelId}`);
  try {
    // Note: In actual implementation, you'd need to inject the database service
    // const db = this.userDataService.getInstance();
    // let channelInfo = await db.getActiveChannel({ channelId: channelId });

    // if (!channelInfo) {
    //   console.log(`Channel ${channelId} not found in DB. Fetching from Telegram...`);
    //   channelInfo = await getIChannelFromTg(client, channelId);
    //   await db.updateActiveChannel({ channelId: channelId }, channelInfo);
    // }

    // For now, fetch directly from Telegram
    const channelInfo = await getIChannelFromTg(client, channelId);
    return channelInfo;
  } catch (error) {
    console.error(`Error getting channel info for ${channelId}:`, error);
    return null;
  }
}

export async function getIChannelFromTg(
  client: TelegramClient,
  channelId: string
): Promise<IChannel> {
  console.log(`Fetching channel info for ${channelId} from Telegram...`);
  
  const channelEnt = channelId.startsWith('-') ? channelId : `-100${channelId}`;
  const entity = await client.getEntity(channelEnt) as Api.Channel;
  
  const { id, defaultBannedRights, title, broadcast, username, participantsCount, restricted } = entity;

  const channel: IChannel = {
    channelId: id.toString()?.replace(/^-100/, ""),
    title,
    participantsCount,
    username,
    broadcast,
    restricted,
    canSendMsgs: defaultBannedRights ? !defaultBannedRights.sendMessages : true,
    wordRestriction: 0,
    availableMsgs: ['0']
  };

  console.log(`Channel info fetched for ${channelId}:`, channel);
  return channel;
}

export function filterChannelsByParticipants(
  channelDetails: { channelId: string; participantsCount: number }[],
  minParticipants: number = 100
): string[] {
  return channelDetails
    .filter(channel => channel.participantsCount >= minParticipants)
    .map(channel => channel.channelId);
}
