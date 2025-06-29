import { TelegramClient } from "telegram";

export interface User {
    mobile: string;
    session: string;
    tgId?: string;
}

export interface RetryConfig {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    backoffMultiplier: number;
    jitter: boolean;
}

export interface ClientInfo {
    client: TelegramClient;
    mobile: string;
    lastUsed: number;
    username: string,
    name: string,
    autoDisconnect: boolean;
}

export interface GetClientOptions {
    autoDisconnect?: boolean;
    handler?: boolean;
    timeout?: number;
    retryConfig?: Partial<RetryConfig>;
    forceReconnect?: boolean;
}
