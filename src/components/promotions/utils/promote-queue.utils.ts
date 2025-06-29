// Simple PromoteQueue implementation to track recent promotions
export class PromoteQueue {
  private static instance: PromoteQueue;
  private sentChannels: Map<string, { count: number; timestamp: number }> = new Map();
  private readonly EXPIRY_TIME = 10 * 60 * 1000; // 10 minutes

  private constructor() {}

  static getInstance(): PromoteQueue {
    if (!PromoteQueue.instance) {
      PromoteQueue.instance = new PromoteQueue();
    }
    return PromoteQueue.instance;
  }

  push(channelId: string): void {
    const existing = this.sentChannels.get(channelId);
    this.sentChannels.set(channelId, {
      count: existing ? existing.count + 1 : 1,
      timestamp: Date.now()
    });
  }

  contains(channelId: string): boolean {
    const entry = this.sentChannels.get(channelId);
    if (!entry) return false;
    
    // Check if entry is still valid (not expired)
    if (Date.now() - entry.timestamp > this.EXPIRY_TIME) {
      this.sentChannels.delete(channelId);
      return false;
    }
    
    return true;
  }

  getSentCount(channelId: string): number {
    const entry = this.sentChannels.get(channelId);
    if (!entry || Date.now() - entry.timestamp > this.EXPIRY_TIME) {
      return 0;
    }
    return entry.count;
  }

  clear(): void {
    this.sentChannels.clear();
  }

  // Clean up expired entries
  cleanup(): void {
    const now = Date.now();
    for (const [channelId, entry] of this.sentChannels.entries()) {
      if (now - entry.timestamp > this.EXPIRY_TIME) {
        this.sentChannels.delete(channelId);
      }
    }
  }

  size(): number {
    this.cleanup(); // Clean before returning size
    return this.sentChannels.size;
  }
}
