// Utility functions for stats operations and formatting
import { MobileStats, PromotionResult } from '../interfaces/promotion.interfaces';
import { promises as fs } from 'fs';
import * as path from 'path';

export function formatMobileStats(mobile: string, stats: MobileStats): string {
  const lastMsgMinutes = ((Date.now() - stats.lastMessageTime) / 60000).toFixed(2);
  const sleepMinutes = stats.sleepTime > Date.now() ? ((stats.sleepTime - Date.now()) / 60000).toFixed(2) : '0';
  
  return `[${mobile}] Stats:
    Messages: ${stats.messageCount}
    Success: ${stats.successCount}
    Failed: ${stats.failedCount}
    Converted: ${stats.converted}
    Days Left: ${stats.daysLeft}
    Last Message: ${lastMsgMinutes}m ago
    Sleep Time: ${sleepMinutes}m remaining`;
}

export function formatPromotionResults(results: Record<string, PromotionResult>): string {
  const total = Object.keys(results).length;
  const successful = Object.values(results).filter(r => r.success).length;
  const failed = total - successful;
  
  let output = `Promotion Results Summary:
    Total Channels: ${total}
    Successful: ${successful}
    Failed: ${failed}
    Success Rate: ${total > 0 ? ((successful / total) * 100).toFixed(1) : 0}%\n`;
  
  if (failed > 0) {
    output += '\nFailed Channels:\n';
    Object.entries(results)
      .filter(([_, result]) => !result.success)
      .slice(0, 10) // Show only first 10 failed channels
      .forEach(([channelId, result]) => {
        output += `  ${channelId}: ${result.errorMessage || 'Unknown error'}\n`;
      });
  }
  
  return output;
}

export function calculateHealthScore(stats: MobileStats): number {
  const now = Date.now();
  const timeSinceLastMessage = now - stats.lastMessageTime;
  const timeSinceLastCheck = now - stats.lastCheckedTime;
  
  let score = 100;
  
  // Reduce score based on time since last message
  if (timeSinceLastMessage > 60 * 60 * 1000) { // 1 hour
    score -= 20;
  }
  
  // Reduce score based on failed count
  if (stats.failedCount > stats.successCount) {
    score -= 30;
  }
  
  // Reduce score if sleeping due to rate limits
  if (stats.sleepTime > now) {
    score -= 25;
  }
  
  // Reduce score based on time since last health check
  if (timeSinceLastCheck > 2 * 60 * 60 * 1000) { // 2 hours
    score -= 15;
  }
  
  return Math.max(0, score);
}

export function getTopPerformingChannels(
  results: Record<string, PromotionResult>, 
  limit: number = 10
): Array<{ channelId: string; count: number; success: boolean }> {
  return Object.entries(results)
    .filter(([_, result]) => result.success && result.count > 0)
    .sort(([_, a], [__, b]) => (b.count || 0) - (a.count || 0))
    .slice(0, limit)
    .map(([channelId, result]) => ({
      channelId,
      count: result.count || 0,
      success: result.success
    }));
}

export function getProblematicChannels(
  results: Record<string, PromotionResult>
): Array<{ channelId: string; errorMessage: string; lastCheckTimestamp: number }> {
  return Object.entries(results)
    .filter(([_, result]) => !result.success && result.errorMessage)
    .map(([channelId, result]) => ({
      channelId,
      errorMessage: result.errorMessage!,
      lastCheckTimestamp: result.lastCheckTimestamp
    }))
    .sort((a, b) => b.lastCheckTimestamp - a.lastCheckTimestamp);
}

// Enhanced JSON persistence methods with full mobile stats support
export async function saveResultsToJson(
  mobileStats: MobileStats,
  promotionResults: Map<string, PromotionResult>,
  mobile: string
): Promise<void> {
  console.log(`[${mobile}] Saving results to JSON`);
  try {
    const dir = path.dirname(`./mobileStats-${mobile}.json`);
    await fs.mkdir(dir, { recursive: true });
    
    // Convert Map to plain object for JSON serialization
    const promotionResultsObj: Record<string, PromotionResult> = {};
    for (const [key, value] of promotionResults) {
      promotionResultsObj[key] = value;
    }
    
    const data = {
      mobileStats,
      promotionResults: promotionResultsObj,
      savedAt: new Date().toISOString(),
      version: '1.0'
    };
    
    await fs.writeFile(`./mobileStats-${mobile}.json`, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[${mobile}] Results saved to mobileStats-${mobile}.json`);
  } catch (error) {
    console.error(`[${mobile}] Failed to save results to JSON:`, error.message);
  }
}

export async function loadResultsFromJson(mobile: string): Promise<{
  mobileStats: MobileStats | null;
  promotionResults: Map<string, PromotionResult>;
}> {
  console.log(`[${mobile}] Loading results from JSON`);
  
  const defaultResult = {
    mobileStats: null,
    promotionResults: new Map<string, PromotionResult>()
  };
  
  try {
    const rawData = await fs.readFile(`./mobileStats-${mobile}.json`, 'utf-8');
    const data = JSON.parse(rawData);

    if (!data.mobileStats && !data.promotionResults) {
      console.warn(`[${mobile}] Invalid JSON format: No valid data found.`);
      return defaultResult;
    }

    // Convert plain object back to Map
    const promotionResults = new Map<string, PromotionResult>();
    if (data.promotionResults && typeof data.promotionResults === 'object') {
      for (const [key, value] of Object.entries(data.promotionResults)) {
        if (value && typeof value === 'object') {
          promotionResults.set(key, value as PromotionResult);
        }
      }
    }

    console.log(`[${mobile}] Results loaded from mobileStats-${mobile}.json - Stats: ${data.mobileStats ? 'found' : 'missing'}, Promotion Results: ${promotionResults.size} entries`);
    
    return {
      mobileStats: data.mobileStats || null,
      promotionResults
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`[${mobile}] File not found: mobileStats-${mobile}.json (this is normal for first run)`);
    } else if (error instanceof SyntaxError) {
      console.error(`[${mobile}] Failed to parse JSON from mobileStats-${mobile}.json:`, error.message);
    } else {
      console.error(`[${mobile}] Failed to load results from JSON:`, error.message);
    }
    return defaultResult;
  }
}

export async function saveAllMobilesResults(
  mobileStatesData: Array<{
    mobile: string;
    mobileStats: MobileStats;
    promotionResults: Map<string, PromotionResult>;
  }>
): Promise<void> {
  console.log(`Saving results for ${mobileStatesData.length} mobiles`);
  
  const savePromises = mobileStatesData.map(({ mobile, mobileStats, promotionResults }) =>
    saveResultsToJson(mobileStats, promotionResults, mobile)
  );
  
  await Promise.allSettled(savePromises);
  console.log(`Completed saving results for all mobiles`);
}

export async function loadAllMobilesResults(mobiles: string[]): Promise<Map<string, {
  mobileStats: MobileStats | null;
  promotionResults: Map<string, PromotionResult>;
}>> {
  console.log(`Loading results for ${mobiles.length} mobiles`);
  
  const results = new Map<string, {
    mobileStats: MobileStats | null;
    promotionResults: Map<string, PromotionResult>;
  }>();
  
  const loadPromises = mobiles.map(async (mobile) => {
    const data = await loadResultsFromJson(mobile);
    results.set(mobile, data);
  });
  
  await Promise.allSettled(loadPromises);
  console.log(`Completed loading results for all mobiles`);
  
  return results;
}
