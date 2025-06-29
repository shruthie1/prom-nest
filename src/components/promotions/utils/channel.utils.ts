// Utility functions for channel operations
import { TelegramClient, Api } from 'telegram';
import { IChannel } from '../interfaces/promotion.interfaces';



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
    availableMsgs: Array.from({ length: 22 }, (_, i) => i.toString())
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
