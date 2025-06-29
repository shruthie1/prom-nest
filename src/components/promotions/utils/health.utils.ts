// Utility functions for health checks
import { TelegramClient, Api } from 'telegram';
import { PromotionState } from '../interfaces/promotion.interfaces';

export async function checkTelegramHealth(
  client: TelegramClient,
  state: PromotionState,
  mobile: string,
  force: boolean = false
): Promise<boolean> {
  if ((state.lastCheckedTime < (Date.now() - 120 * 60 * 1000)) || force) {
    console.log(`[${mobile}] Checking health of Telegram client...`);
    
    try {
      if (client) {
        const me = await client.getMe();
        if (me) {
          console.log(`[${mobile}] Client health check passed - User: ${me.username || me.firstName}`);
          return true;
        } else {
          console.error(`[${mobile}] Client health check failed - Unable to get user info`);
          return false;
        }
      } else {
        console.error(`[${mobile}] Client health check failed - Client is null/undefined`);
        return false;
      }
    } catch (error) {
      console.error(`[${mobile}] Client health check failed:`, error);
      return false;
    }
  }
  
  // If not time to check, assume healthy (last check was recent)
  return true;
}

export function isClientHealthyForPromotion(
  state: PromotionState,
  mobile: string
): boolean {
  const now = Date.now();
  const timeSinceLastMessage = now - state.lastMessageTime;
  const minTimeBetweenMessages = state.daysLeft < 1 ? 12 * 60 * 1000 : 3 * 60 * 1000; // 12 mins if daysLeft < 1, else 3 mins
  
  const isHealthy = state.daysLeft < 7 &&
    timeSinceLastMessage >= minTimeBetweenMessages &&
    state.sleepTime < now;
    
  if (!isHealthy) {
    const reason = state.sleepTime >= now ? 'sleeping due to rate limit' :
                   timeSinceLastMessage < minTimeBetweenMessages ? 'too soon since last message' :
                   'days left >= 7';
    console.log(`[${mobile}] Client not healthy for promotion: ${reason}`);
  }
  
  return isHealthy;
}
