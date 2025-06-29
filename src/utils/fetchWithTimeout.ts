import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { extractMessage, parseError } from "./parseError";
import { ppplbot } from "./logbots";
import { sleep } from "../utils";

// Configuration types
interface RetryConfig {
    maxRetries: number;
    baseDelay: number;
    maxDelay: number;
    jitterFactor: number;
}

interface NotificationConfig {
    enabled: boolean;
    channelEnvVar: string;
    timeout: number;
}

// Default configurations
const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelay: 500, // Start with 500ms
    maxDelay: 30000, // Cap at 30 seconds
    jitterFactor: 0.2, // Add up to 20% jitter
};

const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
    enabled: true,
    channelEnvVar: 'httpFailuresChannel',
    timeout: 5000,
};

/**
 * Sends error notifications to configured channels
 * @param prefix - Notification message prefix
 * @param errorDetails - Error details to include in notification
 * @param config - Notification configuration
 * @returns Promise that resolves when notification is sent
 */
async function notifyInternal(
    prefix: string,
    errorDetails: { message: any; status?: number },
    config: NotificationConfig = DEFAULT_NOTIFICATION_CONFIG
): Promise<void> {
    if (!config.enabled) return;
    prefix = `${prefix} ${process.env.clientId || 'uptimeChecker2'}`;
    try {
        const errorMessage = typeof errorDetails.message === 'string'
            ? errorDetails.message
            : JSON.stringify(errorDetails.message);

        const formattedMessage = errorMessage.includes('ETIMEDOUT') ? 'Connection timed out' :
            errorMessage.includes('ECONNREFUSED') ? 'Connection refused' :
                extractMessage(errorDetails?.message);

        console.error(`${prefix}\n${formattedMessage}`);

        // Skip notification for rate limiting errors
        if (errorDetails.status === 429) return;

        const notificationText = `${prefix}\n\n${formattedMessage}`;

        try {
            const channelUrl = ppplbot(process.env[config.channelEnvVar] || '');
            if (!channelUrl) {
                console.warn(`Notification channel URL not available. Environment variable ${config.channelEnvVar} might not be set.`);
                return;
            }

            const notifUrl = `${channelUrl}&text=${encodeURIComponent(notificationText)}`;
            await axios.get(notifUrl, { timeout: config.timeout });
        } catch (error) {
            parseError(error, "Failed to send notification:", false);
        }
    } catch (error) {
        parseError(error, "Error in notification process:", false);
    }
}

/**
 * Common network errors that should trigger retries
 */
const RETRYABLE_NETWORK_ERRORS = [
    'ETIMEDOUT',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'ERR_NETWORK',
    'ERR_BAD_RESPONSE',
    'EHOSTUNREACH',
    'ENETUNREACH'
];

/**
 * HTTP status codes that should trigger retries
 */
const RETRYABLE_STATUS_CODES = [408, 500, 502, 503, 504];

/**
 * Determines if an error should trigger a retry
 * @param error - The axios error
 * @param parsedError - Parsed error with status code
 * @returns boolean indicating whether to retry the request
 */
function shouldRetry(error: unknown, parsedError: { status: number }): boolean {
    if (axios.isAxiosError(error)) {
        if (error.code && RETRYABLE_NETWORK_ERRORS.includes(error.code)) {
            return true;
        }

        if (error.message?.toLowerCase().includes('timeout')) {
            return true;
        }
    }

    return RETRYABLE_STATUS_CODES.includes(parsedError.status);
}

/**
 * Calculates backoff time for retry attempts
 * @param attempt - Current attempt number (0-based)
 * @param config - Retry configuration
 * @returns Delay in milliseconds before next retry
 */
function calculateBackoff(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
    const base = Math.min(config.baseDelay * Math.pow(2, attempt), config.maxDelay);
    const jitter = Math.random() * (base * config.jitterFactor);
    return Math.floor(base + jitter);
}

/**
 * Makes a request through a bypass service when regular requests fail with certain errors
 * @param url - Target URL
 * @param options - Request options
 * @returns Axios response from bypass service
 */
async function makeBypassRequest(
    url: string,
    options: AxiosRequestConfig & { bypassUrl?: string }
): Promise<AxiosResponse> {
    const bypassUrl = options.bypassUrl || process.env.bypassURL || '';

    if (!bypassUrl) {
        throw new Error('Bypass URL is not provided');
    }

    const finalBypassUrl = bypassUrl.startsWith('http') ?
        bypassUrl :
        'https://ravishing-perception-production.up.railway.app/execute-request';

    const bypassAxios = axios.create({
        responseType: options.responseType || 'json',
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: options.timeout || 30000
    });

    const response = await bypassAxios.post(finalBypassUrl, {
        url,
        method: options.method,
        headers: options.headers,
        data: options.data,
        params: options.params,
        responseType: options.responseType,
        timeout: options.timeout,
        followRedirects: options.maxRedirects !== 0,
        maxRedirects: options.maxRedirects
    }, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers
        }
    });

    // Handle binary responses
    if (response && (
        options.responseType === 'arraybuffer' ||
        response.headers['content-type']?.includes('application/octet-stream') ||
        response.headers['content-type']?.includes('image/') ||
        response.headers['content-type']?.includes('audio/') ||
        response.headers['content-type']?.includes('video/') ||
        response.headers['content-type']?.includes('application/pdf'))) {

        response.data = Buffer.from(response.data);
    }

    return response;
}

/**
 * Parses a URL and extracts host and endpoint information
 * @param url - URL to parse
 * @returns Object containing host and endpoint
 */
function parseUrl(url: string): { host: string; endpoint: string } | null {
    if (!url || typeof url !== 'string') {
        return null;
    }

    try {
        const parsedUrl = new URL(url);
        return {
            host: parsedUrl.host,
            endpoint: parsedUrl.pathname + parsedUrl.search
        };
    } catch (error) {
        return null;
    }
}

/**
 * Extended options for fetch requests
 */
interface FetchWithTimeoutOptions extends AxiosRequestConfig {
    bypassUrl?: string;
    retryConfig?: RetryConfig;
    notificationConfig?: NotificationConfig;
}

/**
 * Makes HTTP requests with timeout handling and retry logic
 * @param url - Target URL
 * @param options - Request options with custom extensions
 * @returns Promise resolving to Axios response or undefined if all retries fail
 */
export async function fetchWithTimeout(
    url: string,
    options: FetchWithTimeoutOptions = {},
    maxRetries?: number // Kept for backward compatibility
): Promise<AxiosResponse | undefined> {
    // Input validation
    if (!url) {
        console.error('URL is empty');
        return undefined;
    }

    // Merge default and custom configurations
    const retryConfig: RetryConfig = {
        ...DEFAULT_RETRY_CONFIG,
        ...options.retryConfig,
        maxRetries: maxRetries !== undefined ? maxRetries : (options.retryConfig?.maxRetries || DEFAULT_RETRY_CONFIG.maxRetries)
    };

    const notificationConfig: NotificationConfig = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        ...options.notificationConfig
    };

    // Initialize request options with defaults
    options.timeout = options.timeout || 30000;
    options.method = options.method || "GET";

    // Parse URL for error reporting
    const urlInfo = parseUrl(url);
    if (!urlInfo) {
        console.error(`Invalid URL: ${url}`);
        return undefined;
    }

    const { host, endpoint } = urlInfo;
    const clientId = process.env.clientId || 'UnknownClient';

    // Main retry loop
    let lastError: Error | null = null;
    console.log(`Fetching URL: `, url);
    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
        // Create controller for this attempt
        const controller = new AbortController();
        const currentTimeout = options.timeout + (attempt * 5000);

        // Set up timeout to abort the request if it takes too long
        const timeoutId = setTimeout(() => {
            try {
                controller.abort();
            } catch (abortError) {
                console.error("Error during abort:", abortError);
            }
        }, currentTimeout);

        try {
            // Make the request
            const response = await axios({
                ...options,
                url,
                signal: controller.signal,
                maxRedirects: options.maxRedirects ?? 5,
                timeout: currentTimeout,
            });

            // Success! Clean up and return response
            clearTimeout(timeoutId);
            return response;

        } catch (error) {
            // Clean up timeout
            clearTimeout(timeoutId);

            // Process error and determine if retry is needed
            lastError = error instanceof Error ? error : new Error(String(error));

            // Try to parse the error for better handling
            let parsedError;
            try {
                parsedError = parseError(error, `host: ${host}\nendpoint:${endpoint}`, false);
            } catch (parseErrorError) {
                console.error("Error in parseError:", parseErrorError);
                parsedError = { status: 500, message: String(error), error: "ParseError" };
            }

            // Extract message for notifications
            const message = parsedError.message;

            // Check if it's a timeout
            const isTimeout = axios.isAxiosError(error) && (
                error.code === "ECONNABORTED" ||
                (message && message.includes("timeout")) ||
                parsedError.status === 408
            );

            // Handle 403/495 with bypass
            if (parsedError.status === 403 || parsedError.status === 495) {
                try {
                    const bypassResponse = await makeBypassRequest(url, options);
                    if (bypassResponse) {
                        await notifyInternal(
                            `Successfully Bypassed the request`,
                            { message: `${clientId} host=${host}\nendpoint=${endpoint}` },
                            notificationConfig
                        );
                        return bypassResponse;
                    }
                } catch (bypassError) {
                    let errorDetails;
                    try {
                        const bypassParsedError = parseError(bypassError, `host: ${host}\nendpoint:${endpoint}`, false);
                        errorDetails = extractMessage(bypassParsedError);
                    } catch (extractBypassError) {
                        console.error("Error extracting bypass error message:", extractBypassError);
                        errorDetails = String(bypassError);
                    }

                    await notifyInternal(
                        `Bypass attempt failed`,
                        { message: `host=${host}\nendpoint=${endpoint}\n${`msg: ${errorDetails.slice(0, 150)}`}` },
                        notificationConfig
                    );
                }
            } else {
                // Notify about the error
                if (isTimeout) {
                    await notifyInternal(
                        `Request timeout on attempt ${attempt}`,
                        {
                            message: `${clientId} host=${host}\nendpoint=${endpoint}\ntimeout=${options.timeout}ms`,
                            status: 408
                        },
                        notificationConfig
                    );
                } else {
                    await notifyInternal(
                        `Attempt ${attempt} failed`,
                        {
                            message: `${clientId} host=${host}\nendpoint=${endpoint}\n${`mgs: ${message.slice(0, 150)}`}`,
                            status: parsedError.status
                        },
                        notificationConfig
                    );
                }
            }

            // Check if we should retry
            if (attempt < retryConfig.maxRetries && shouldRetry(error, parsedError)) {
                const delay = calculateBackoff(attempt, retryConfig);
                console.log(`Retrying request (${attempt + 1}/${retryConfig.maxRetries}) after ${delay}ms`);
                await sleep(delay);
                continue;
            }

            // If this is the last attempt, break out of the loop
            if (attempt >= retryConfig.maxRetries) {
                break;
            }
        }
    }

    // If we get here, all retries failed
    try {
        let errorData;
        try {
            if (lastError) {
                const parsedLastError = parseError(lastError, `${clientId} host: ${host}\nendpoint:${endpoint}`, false);
                errorData = extractMessage(parsedLastError);
            } else {
                errorData = 'Unknown error';
            }
        } catch (extractLastError) {
            console.error("Error extracting last error:", extractLastError);
            errorData = String(lastError) || 'Unknown error';
        }

        await notifyInternal(
            `All ${retryConfig.maxRetries} retries exhausted`,
            { message: `${errorData.slice(0, 150)}` },
            notificationConfig
        );
    } catch (finalError) {
        console.error('Failed to send final error notification:', finalError);
    }

    // Return undefined to indicate failure
    return undefined;
}