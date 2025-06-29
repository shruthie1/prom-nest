// Utility functions for messaging operations
import { TelegramClient, Api, errors } from 'telegram';
import { IChannel, PromotionState } from '../interfaces/promotion.interfaces';
import { SendMessageParams } from 'telegram/client/messages';

export function selectRandomElements(array: string[], count: number): string[] {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

export function getRandomBoolean(): boolean {
  return Math.random() < 0.5;
}

export function generateEmojis(): string {
  const emojis = ['😊', '💦', '👀', '😍', '💋', '🔥', '❤️'];
  return selectRandomElements(emojis, 2).join('');
}

export function getRandomEmoji(): string {
  const emojis = ['😊', '💦', '👀', '😍', '💋', '🔥', '❤️'];
  return emojis[Math.floor(Math.random() * emojis.length)];
}

export function getCurrentHourIST(): number {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const ist = new Date(utc + (5.5 * 3600000));
  return ist.getHours();
}

export function pickOneMsg(messages: string[]): string {
  return messages[Math.floor(Math.random() * messages.length)];
}

export async function sendMessageToChannel(
  client: TelegramClient,
  mobile: string,
  channelInfo: IChannel,
  state: PromotionState,
  message: SendMessageParams
): Promise<Api.Message | undefined> {
  try {
    if (state.sleepTime < Date.now()) {
      const result = await client.sendMessage(
        channelInfo.username ? `@${channelInfo.username}` : channelInfo.channelId,
        message
      );

      if (result) {
        console.log(`[${mobile}]:\n@${channelInfo.username} ✅\ntempFailCount: ${state.tempFailCount}\nLastMsg: ${((Date.now() - state.lastMessageTime) / 60000).toFixed(2)}mins\nDaysLeft: ${state.daysLeft}\nChannelIndex: ${state.channelIndex}`);
        
        const stats = state.promotionResults.get(channelInfo.channelId) || { success: true, count: 0, lastCheckTimestamp: Date.now() };
        state.promotionResults.set(channelInfo.channelId, {
          success: true,
          count: (stats.count ? stats.count : 0) + 1,
          lastCheckTimestamp: Date.now()
        });

        return result;
      } else {
        console.error(`[${mobile}] Failed to send message to ${channelInfo.channelId} || @${channelInfo.username}`);
        return undefined;
      }
    } else {
      console.log(`[${mobile}]:\n@${channelInfo.username} ❌\ntempFailCount: ${state.tempFailCount}\nLastMsg: ${((Date.now() - state.lastMessageTime) / 60000).toFixed(2)}mins\nSleeping: ${(state.sleepTime - Date.now()) / 60000}mins\nDaysLeft: ${state.daysLeft}\nReason: ${state.failureReason}\nchannelIndex: ${state.channelIndex}`);
      console.log(`[${mobile}] Sleeping for ${state.sleepTime / 1000} seconds due to rate limit.`);
      return undefined;
    }
  } catch (error) {
    const stats = state.promotionResults.get(channelInfo.channelId) || { success: true, count: 0, lastCheckTimestamp: Date.now() };
    
    state.promotionResults.set(channelInfo.channelId, {
      count: stats.count,
      success: false,
      errorMessage: error.errorMessage || "UNKNOWN",
      lastCheckTimestamp: Date.now()
    });

    state.failureReason = error.errorMessage;

    if (error.errorMessage !== 'USER_BANNED_IN_CHANNEL') {
      console.log(`[${mobile}] Some Error Occurred, ${error.errorMessage}`);
      if (!error.errorMessage) {
        console.error(`[${mobile}] Error sending message to channel`, error);
      }
    }

    if (error instanceof errors.FloodWaitError) {
      console.log(error);
      console.warn(`[${mobile}] Rate limited. Sleeping for ${error.seconds} seconds.`);
      state.sleepTime = Date.now() + (error.seconds * 1000);
      return undefined;
    } else {
      console.error(`[${mobile}] Error sending message to ${channelInfo.username}: ${error.errorMessage}`);
      if (error.errorMessage === "CHANNEL_PRIVATE") {
        return await handlePrivateChannel(client, channelInfo, message, error);
      } else {
        return await handleOtherErrors(mobile, channelInfo, message, error);
      }
    }
  }
}

async function handlePrivateChannel(
  client: TelegramClient,
  channelInfo: IChannel,
  message: SendMessageParams,
  error: any
): Promise<Api.Message | undefined> {
  if (channelInfo && channelInfo.username) {
    try {
      return await client.sendMessage(channelInfo.username, message);
    } catch (err) {
      console.error(`Error retrying message for private channel ${channelInfo.username}:`, err);
      return undefined;
    }
  }
  return undefined;
}

async function handleOtherErrors(
  mobile: string,
  channelInfo: IChannel,
  message: SendMessageParams,
  error: any
): Promise<undefined> {
  if (error.errorMessage === 'USER_BANNED_IN_CHANNEL') {
    console.error(`[${mobile}] ${error.errorMessage}`);
  } else if (error.errorMessage === 'CHAT_WRITE_FORBIDDEN') {
    console.error(`[${mobile}] ${error.errorMessage}`);
  } else {
    console.error(`[${mobile}] ${error.errorMessage}`);
  }
  return undefined;
}

export async function sendPromotionalMessage(
  client: TelegramClient,
  mobile: string,
  channelInfo: IChannel,
  state: PromotionState,
  forceEven: boolean = false
): Promise<{ sentMessage: Api.Message | undefined; randomIndex: string }> {
  let sentMessage: Api.Message | undefined;
  const randomIndex = selectRandomElements(channelInfo.availableMsgs || ['0'], 1)[0] || '0';
  let endMsg = state.promoteMsgs[randomIndex] || state.promoteMsgs['0'];
  const randomFlag = forceEven || getRandomBoolean();

  if (channelInfo.wordRestriction === 0 && randomFlag) {
    const greetings = ['Hellloooo', 'Hiiiiii', 'Oyyyyyy', 'Oiiiii', 'Haaiiii', 'Hlloooo', 'Hiiii', 'Hyyyyy', 'Oyyyyye', 'Oyeeee', 'Heyyy'];
    const emojis = generateEmojis();
    const randomEmoji = getRandomEmoji();
    const hour = getCurrentHourIST();
    const isMorning = (hour > 9 && hour < 22);
    const offset = Math.floor(Math.random() * 3);
    endMsg = pickOneMsg(['**U bussy👀?\n           U bussy👀?**', '**Trry Once!!😊💦\n           Trry Once!!😊💦**', '**Waiiting fr ur mssg.....Dr!!💦\nWaiiting fr ur mssg.....Dr!!💦**', '**U Onliine?👀\n           U Onliine?👀**', "**I'm Avilble!!😊\n           I'm Avilble!!😊**", '**U Intrstd??👀💦\n           U Intrstd??👀💦**', '**U Awakke?👀💦\n           U Awakke?👀💦**', '**U therre???💦💦\n           U therre???💦💦**']);

    const addon = (offset !== 1) ? `${(offset === 2) ? `**\n\n\n             TODAAY's OFFFER:\n-------------------------------------------\n𝗩𝗲𝗱𝗶𝗼 𝗖𝗮𝗹𝗹 𝗗𝗲𝗺𝗼 𝗔𝘃𝗶𝗹𝗯𝗹𝗲${randomEmoji}${randomEmoji}\n𝗩𝗲𝗱𝗶𝗼 𝗖𝗮𝗹𝗹 𝗗𝗲𝗺𝗼 𝗔𝘃𝗶𝗹𝗯𝗹𝗲${randomEmoji}${randomEmoji}\n-------------------------------------------**` : `**\n\nI'm Freee Now!!${generateEmojis()}\nJUST Trry Once!!😚😚`}**` : endMsg;
    const msg = `**${pickOneMsg(greetings)}_._._._._._._!!**${emojis}\n\n\n${addon}`;
    sentMessage = await sendMessageToChannel(client, mobile, channelInfo, state, { message: `${msg}` });
  } else {
    sentMessage = await sendMessageToChannel(client, mobile, channelInfo, state, { message: endMsg });
  }

  return { sentMessage, randomIndex};
}
