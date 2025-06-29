import { notifbot } from "./logbots";
import axios, { AxiosError, AxiosResponse } from "axios";

/**
 * Error response interface for standardized error format
 */
interface ErrorResponse {
  status: number;
  message: string;
  error: string;
  raw?: any;
}

/**
 * Configuration options for error handling
 */
interface ErrorHandlingConfig {
  maxMessageLength: number;
  notificationTimeout: number;
  ignorePatterns: RegExp[];
  defaultStatus: number;
  defaultMessage: string;
  defaultError: string;
}

// Default configuration for error handling
const DEFAULT_ERROR_CONFIG: ErrorHandlingConfig = {
  maxMessageLength: 200,
  notificationTimeout: 10000,
  ignorePatterns: [
    /INPUT_USER_DEACTIVATED/i,
    /too many req/i,
    /could not find/i,
    /ECONNREFUSED/i
  ],
  defaultStatus: 500,
  defaultMessage: 'An unknown error occurred',
  defaultError: 'UnknownError'
};

/**
 * Safely stringifies objects of any depth
 * @param data - Data to stringify
 * @param depth - Current recursion depth
 * @param maxDepth - Maximum recursion depth
 * @returns String representation of data
 */
function safeStringify(data: any, depth = 0, maxDepth = 3): string {
  if (depth > maxDepth) {
    return '[Max Depth Reached]';
  }

  try {
    if (data === null || data === undefined) {
      return String(data);
    }

    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return String(data);
    }

    if (data instanceof Error) {
      return data.message || data.toString();
    }

    if (Array.isArray(data)) {
      if (data.length === 0) return '[]';
      return `[${data.map(item => safeStringify(item, depth + 1, maxDepth)).join(', ')}]`;
    }

    if (typeof data === 'object') {
      const entries = Object.entries(data)
        .filter(([_, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}: ${safeStringify(v, depth + 1, maxDepth)}`);

      if (entries.length === 0) return '{}';
      return `{${entries.join(', ')}}`;
    }

    return String(data);
  } catch (error) {
    return `[Error Stringifying: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

/**
 * Extracts meaningful message from nested data structure
 * @param data - The data to extract messages from
 * @param path - Current object path for nested values
 * @param maxDepth - Maximum depth to traverse
 * @returns Extracted message as string
 */
export function extractMessage(data: any, path = '', depth = 0, maxDepth = 5): string {
  try {
    // Prevent excessive recursion
    if (depth > maxDepth) {
      return `${path}=[Max Depth Reached]`;
    }

    // Handle simple types directly
    if (data === null || data === undefined) {
      return '';
    }

    if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
      return path ? `${path}=${data}` : String(data);
    }

    // Handle Error objects
    if (data instanceof Error) {
      const errorInfo = [
        data.message ? `message=${data.message}` : '',
        data.name ? `name=${data.name}` : '',
        data.stack ? `stack=${data.stack.split('\n')[0]}` : ''
      ].filter(Boolean).join('\n');

      return path ? `${path}=(${errorInfo})` : errorInfo;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      if (data.length === 0) {
        return '';
      }

      return data
        .map((item, index) => extractMessage(item, path ? `${path}[${index}]` : `[${index}]`, depth + 1, maxDepth))
        .filter(Boolean)
        .join('\n');
    }

    // Handle objects
    if (typeof data === 'object') {
      const messages: string[] = [];

      for (const key of Object.keys(data)) {
        const value = data[key];
        const newPath = path ? `${path}.${key}` : key;

        const extracted = extractMessage(value, newPath, depth + 1, maxDepth);
        if (extracted) {
          messages.push(extracted);
        }
      }

      return messages.join('\n');
    }

    // Fallback
    return '';
  } catch (error) {
    console.error("Error in extractMessage:", error);
    return `Error extracting message: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Sends an HTTP notification
 * @param url - URL to send notification to
 * @param timeout - Request timeout in ms
 * @returns Promise resolving to response or undefined on error
 */
async function sendNotification(url: string, timeout = DEFAULT_ERROR_CONFIG.notificationTimeout): Promise<AxiosResponse | undefined> {
  try {
    // Validate URL before sending
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      console.error("Invalid notification URL:", url);
      return undefined;
    }

    return await axios.get(url, {
      timeout,
      validateStatus: status => status < 500 // Consider 4xx as "successful" notifications
    });
  } catch (error) {
    console.error("Failed to send notification:", error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

/**
 * Checks if an error should be ignored for notification
 * @param message - Error message to check
 * @param status - HTTP status code
 * @param patterns - RegExp patterns to ignore
 * @returns Boolean indicating if error should be ignored
 */
function shouldIgnoreError(message: string, status: number, patterns: RegExp[]): boolean {
  if (status === 429) return true;  // Always ignore rate limiting errors

  return patterns.some(pattern => pattern.test(message));
}

/**
 * Extracts status code from error or response object
 * @param err - Error object to parse
 * @param defaultStatus - Default status code if none found
 * @returns HTTP status code
 */
function extractStatusCode(err: any, defaultStatus: number): number {
  if (!err) return defaultStatus;

  // Try to extract from response
  if (err.response) {
    const response = err.response;
    return response.data?.statusCode ||
           response.data?.status ||
           response.data?.ResponseCode ||
           response.status ||
           err.status ||
           defaultStatus;
  }

  // Try direct properties
  return err.statusCode || err.status || defaultStatus;
}

/**
 * Extracts error message from error or response object
 * @param err - Error object to parse
 * @param defaultMessage - Default message if none found
 * @returns Extracted error message
 */
function extractErrorMessage(err: any, defaultMessage: string): string {
  if (!err) return defaultMessage;

  // Error message from response
  if (err.response?.data) {
    const responseData = err.response.data;
    return responseData.message ||
           responseData.errors ||
           responseData.ErrorMessage ||
           responseData.errorMessage ||
           responseData.UserMessage ||
           (typeof responseData === 'string' ? responseData : null) ||
           err.response.statusText ||
           err.message ||
           defaultMessage;
  }

  // Error message from request
  if (err.request) {
    return err.data?.message ||
           err.data?.errors ||
           err.data?.ErrorMessage ||
           err.data?.errorMessage ||
           err.data?.UserMessage ||
           (typeof err.data === 'string' ? err.data : null) ||
           err.message ||
           err.statusText ||
           'The request was triggered but no response was received';
  }

  // Direct error message
  return err.message || err.errorMessage || defaultMessage;
}

/**
 * Extracts error type from error or response object
 * @param err - Error object to parse
 * @param defaultError - Default error type if none found
 * @returns Error type as string
 */
function extractErrorType(err: any, defaultError: string): string {
  if (!err) return defaultError;

  if (err.response?.data?.error) {
    return err.response.data.error;
  }

  return err.error || err.name || err.code || defaultError;
}

/**
 * Parses and standardizes error objects for consistent handling
 * @param err - Error to parse
 * @param prefix - Prefix to add to error message
 * @param sendErr - Whether to send a notification for this error
 * @param config - Error handling configuration
 * @returns Standardized error response
 */
export function parseError(
  err: any,
  prefix?: string,
  sendErr: boolean = true,
  config: Partial<ErrorHandlingConfig> = {}
): ErrorResponse {
  // Merge with default config
  const fullConfig = { ...DEFAULT_ERROR_CONFIG, ...config };

  try {
    const clientId = process.env.clientId || 'UptimeChecker2';
    const prefixStr = `${clientId}${prefix ? ` - ${prefix}` : ''}`;

    // Extract error components
    const status = extractStatusCode(err, fullConfig.defaultStatus);
    const rawMessage = extractErrorMessage(err, fullConfig.defaultMessage);
    const error = extractErrorType(err, fullConfig.defaultError);

    // Process the raw message to get a clean version
    let extractedMessage;
    try {
      extractedMessage = typeof rawMessage === 'string' ? rawMessage : extractMessage(rawMessage);
    } catch (e) {
      extractedMessage = safeStringify(rawMessage) || 'Error extracting message';
    }

    // Prepare the full message for logging
    const fullMessage = `${prefixStr} :: ${extractedMessage}`;
    console.log("parsedErr: ", fullMessage);

    // Prepare response object
    const response: ErrorResponse = {
      status,
      message: err.errorMessage ? err.errorMessage : String(fullMessage).slice(0, fullConfig.maxMessageLength),
      error,
      raw: err
    };

    // Send notification if requested and applicable
    if (sendErr) {
      try {
        const ignoreError = shouldIgnoreError(fullMessage, status, fullConfig.ignorePatterns);

        if (!ignoreError) {
          const notificationMessage = err.errorMessage ? err.errorMessage : extractedMessage;
          const notifUrl = `${notifbot()}&text=${encodeURIComponent(prefixStr)} :: ${encodeURIComponent(notificationMessage)}`;

          // Use Promise but don't await to avoid delaying the response
          sendNotification(notifUrl, fullConfig.notificationTimeout)
            .catch(e => console.error("Failed to send error notification:", e));
        }
      } catch (notificationError) {
        console.error('Failed to prepare error notification:', notificationError);
      }
    }

    return response;
  } catch (fatalError) {
    console.error("Fatal error in parseError:", fatalError);
    return {
      status: fullConfig.defaultStatus,
      message: "Error in error handling",
      error: "FatalError",
      raw: err
    };
  }
}

/**
 * Type guard for Axios errors
 * @param error - Error to check
 * @returns Boolean indicating if error is an Axios error
 */
export function isAxiosError(error: unknown): error is AxiosError {
  return axios.isAxiosError(error);
}

/**
 * Creates error objects with consistent format
 * @param message - Error message
 * @param status - HTTP status code
 * @param errorType - Error type
 * @returns Standardized error response
 */
export function createError(message: string, status = 500, errorType = 'ApplicationError'): ErrorResponse {
  return {
    status,
    message,
    error: errorType
  };
}

/**
 * Error handling utilities for HTTP requests and responses
 */
export const ErrorUtils = {
  parseError,
  extractMessage,
  sendNotification,
  createError,
  isAxiosError
};