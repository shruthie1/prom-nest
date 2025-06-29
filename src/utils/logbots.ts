const getBotTokens = () => {
    const botTokens = (process.env.BOT_TOKENS || '').split(',').filter(Boolean);
    if (botTokens.length === 0) {
        throw new Error('No bot tokens configured. Please set BOT_TOKENS environment variable');
    }
    return botTokens;
};

let botTokens: string[] | null = null;
let currentTokenIndex = 0;

const initializeBotTokens = () => {
    if (botTokens === null) {
        botTokens = getBotTokens();
    }
    return botTokens;
};

export function getBotToken() {
    return initializeBotTokens()[currentTokenIndex];
}

export function notifbot(chatId: string = process.env.accountsChannel || "-1001801844217", botToken?: string): string {
    const tokens = initializeBotTokens();
    const token = botToken || tokens[currentTokenIndex];
    const apiUrl = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}`;

    if (!botToken) {
        currentTokenIndex = (currentTokenIndex + 1) % tokens.length;
    }

    return apiUrl;
}

export function ppplbot(chatId: string = process.env.updatesChannel || '-1001972065816', botToken?: string): string {
    const tokens = initializeBotTokens();
    const token = botToken || tokens[currentTokenIndex];
    const apiUrl = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}`;

    if (!botToken) {
        currentTokenIndex = (currentTokenIndex + 1) % tokens.length;
    }

    return apiUrl;
}
