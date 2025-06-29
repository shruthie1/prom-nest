import axios from 'axios';
import { parseError } from './parseError';
import { fetchWithTimeout } from './fetchWithTimeout';

export enum ChannelCategory {
    CLIENT_UPDATES = 'CLIENT_UPDATES',
    USER_WARNINGS = 'USER_WARNINGS',
    VC_WARNINGS = 'VC_WARNINGS',
    USER_REQUESTS = 'USER_REQUESTS',
    VC_NOTIFICATIONS = 'VC_NOTIFICATIONS',
    CHANNEL_NOTIFICATIONS = 'CHANNEL_NOTIFICATIONS',
    ACCOUNT_NOTIFICATIONS = 'ACCOUNT_NOTIFICATIONS',
    ACCOUNT_LOGIN_FAILURES = 'ACCOUNT_LOGIN_FAILURES',
    PROMOTION_ACCOUNT = 'PROMOTION_ACCOUNT',
    CLIENT_ACCOUNT = 'CLIENT_ACCOUNT',
    PAYMENT_FAIL_QUERIES = 'PAYMENT_FAIL_QUERIES',
    SAVED_MESSAGES = 'SAVED_MESSAGES',
}

type ChannelData = {
    botTokens: string[];
    botUsernames: string[];
    lastUsedIndex: number;
    channelId: string;
};

export class BotConfig {
    private static instance: BotConfig;
    private categoryMap = new Map<ChannelCategory, ChannelData>();
    private initialized = false;
    private initPromise: Promise<void>;

    private constructor() {
        this.initPromise = this.initialize();
    }

    public static getInstance(): BotConfig {
        if (!BotConfig.instance) {
            BotConfig.instance = new BotConfig();
        }
        return BotConfig.instance;
    }

    public async ready(): Promise<void> {
        if (!this.initialized) {
            await this.initPromise;
        }
    }

    private async initialize(): Promise<void> {
        console.debug('Initializing Telegram channel configuration...');

        const envKeys = Object.keys(process.env).filter(key =>
            key.startsWith('TELEGRAM_CHANNEL_CONFIG_')
        );

        for (const key of envKeys) {
            const value = process.env[key];
            if (!value) continue;

            const [channelId, description = '', botTokensStr] = value.split('::');
            const botTokens = botTokensStr?.split(',').map(t => t.trim()).filter(Boolean);
            if (!channelId || !botTokens || botTokens.length === 0) continue;

            const category = this.getCategoryFromDescription(description);
            if (!category) continue;

            const botUsernames: string[] = [];
            for (const token of botTokens) {
                const username = await this.fetchUsername(token);
                if (!username) {
                    console.log(`Invalid bot token for ${category}, token: ${token}`);
                    // throw new Error(`Invalid bot token for ${category}`);
                }
                botUsernames.push(username);
            }

            this.categoryMap.set(category, {
                botTokens,
                botUsernames,
                lastUsedIndex: -1,
                channelId,
            });
        }

        this.initialized = true;
        console.info('BotConfig initialized.');
    }

    private getCategoryFromDescription(desc: string): ChannelCategory | null {
        const normalized = desc.toUpperCase();
        return (Object.values(ChannelCategory) as string[]).find(cat => normalized.includes(cat)) as ChannelCategory ?? null;
    }

    private async fetchUsername(token: string): Promise<string> {
        const res = await fetchWithTimeout(`https://api.telegram.org/bot${token}/getMe`);
        const resData = res.data;
        return resData?.ok ? resData.result.username : '';
    }

    public getBotUsername(category: ChannelCategory): string {
        this.assertInitialized();

        const data = this.categoryMap.get(category);
        if (!data || data.botUsernames.length === 0) {
            throw new Error(`No valid bots for ${category}`);
        }

        data.lastUsedIndex = (data.lastUsedIndex + 1) % data.botUsernames.length;
        return data.botUsernames[data.lastUsedIndex];
    }

    public getChannelId(category: ChannelCategory): string {
        this.assertInitialized();

        const data = this.categoryMap.get(category);
        if (!data) {
            throw new Error(`No config for ${category}`);
        }

        return data.channelId;
    }

    public getBotAndChannel(category: ChannelCategory): { username: string; channelId: string; token: string } {
        this.assertInitialized();

        const data = this.categoryMap.get(category);
        if (!data || data.botUsernames.length === 0) {
            throw new Error(`No valid bots for ${category}`);
        }

        data.lastUsedIndex = (data.lastUsedIndex + 1) % data.botUsernames.length;
        return {
            username: data.botUsernames[data.lastUsedIndex],
            channelId: data.channelId,
            token: data.botTokens[data.lastUsedIndex],
        };
    }

    public async sendMessage(category: ChannelCategory, message: string): Promise<void> {
        this.assertInitialized();

        const data = this.categoryMap.get(category);
        if (!data || data.botTokens.length === 0) {
            throw new Error(`No valid bots for ${category}`);
        }

        data.lastUsedIndex = (data.lastUsedIndex + 1) % data.botTokens.length;
        const token = data.botTokens[data.lastUsedIndex];
        const channelId = data.channelId;
        const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${channelId}&text=${encodeURIComponent(message)}`;

        axios.post(url).catch(error => {
            console.error(`Failed to send message to ${channelId}:`, error);
        });
    }

    public getAllBotUsernames(category: ChannelCategory): string[] {
        this.assertInitialized();

        const data = this.categoryMap.get(category);
        if (!data || data.botUsernames.length === 0) {
            throw new Error(`No valid bots for ${category}`);
        }

        return [...data.botUsernames];
    }

    private assertInitialized() {
        if (!this.initialized) {
            throw new Error('BotConfig not initialized. App module has not finished initializing.');
        }
    }
}
