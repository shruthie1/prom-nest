export interface MessageQueueItem {
  channelId: string;
  messageId: number;
  timestamp: number;
  messageIndex: string;
}

export interface PromotionResult {
  success: boolean;
  count: number;
  errorMessage?: string;
  lastCheckTimestamp: number;
}

export interface MobileStats {
  messageCount: number;
  successCount: number;
  failedCount: number;
  daysLeft: number;
  lastCheckedTime: number;
  sleepTime: number;
  releaseTime: number;
  lastMessageTime: number;
  converted: number;
}

export interface PromotionConfig {
  messageCheckDelay: number;
  maxResultsSize: number;
}

export interface PromotionState {
  promotionResults: Map<string, PromotionResult>;
  daysLeft: number;
  sleepTime: number;
  successCount: number;
  failedCount: number;
  releaseTime: number;
  tempFailCount: number;
  lastMessageTime: number;
  lastCheckedTime: number;
  channels: string[];
  promoteMsgs: Record<string, string>;
  channelIndex: number;
  failureReason: string | null;
  isPromoting: boolean;
  messageCount: number;
  converted: number;
}

export interface IChannel {
  channelId: string;
  title?: string;
  participantsCount?: number;
  username?: string;
  restricted?: boolean;
  broadcast?: boolean;
  private?: boolean;
  forbidden?: boolean;
  sendMessages?: boolean;
  canSendMsgs?: boolean;
  availableMsgs?: string[];
  dMRestriction?: number;
  banned?: boolean;
  reactions?: string[];
  reactRestricted?: boolean;
  wordRestriction?: number;
  messageIndex?: number;
  lastMessageTime?: number;
}

export interface IClientDetails {
  mobile: string;
  client?: any;
  username?: string;
  name?: string;
}
