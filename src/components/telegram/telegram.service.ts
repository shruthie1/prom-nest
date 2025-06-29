import { parseError } from '../../utils/parseError';
import { BadRequestException, InternalServerErrorException, Logger, Injectable, OnModuleDestroy } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { contains, sleep } from '../../utils';
import { BotConfig, ChannelCategory } from '../../utils/TelegramBots.config';
import { TelegramClient } from 'telegram';
import { ClientInfo, GetClientOptions, RetryConfig } from '../../utils/shared.interfaces';
import { User } from '../users';
import { StringSession } from 'telegram/sessions';

@Injectable()
export class TelegramService implements OnModuleDestroy {
    private clients: Map<string, ClientInfo>;
    private readonly logger = new Logger(TelegramService.name);
    private cleanupInterval: NodeJS.Timeout | null = null;
    private boundShutdownHandler: () => Promise<void>;
    private isShuttingDown: boolean = false;
    private connectionSemaphore: Map<string, Promise<ClientInfo>> = new Map();

    private readonly CONNECTION_TIMEOUT = 60000;
    private readonly MAX_CONCURRENT_CONNECTIONS = 100;
    private readonly COOLDOWN_PERIOD = 600000;
    private readonly VALIDATION_TIMEOUT = 10000;
    private readonly CLEANUP_TIMEOUT = 15000;

    constructor(private readonly usersService: UsersService) {
        this.clients = new Map();
        this.boundShutdownHandler = this.handleShutdown.bind(this);
        process.on('SIGTERM', this.boundShutdownHandler);
        process.on('SIGINT', this.boundShutdownHandler);

        this.logger.log('TelegramService initialized', {
            maxConnections: this.MAX_CONCURRENT_CONNECTIONS,
            connectionTimeout: this.CONNECTION_TIMEOUT,
            cooldownPeriod: this.COOLDOWN_PERIOD,
            validationTimeout: this.VALIDATION_TIMEOUT,
            cleanupTimeout: this.CLEANUP_TIMEOUT
        });

        this.startCleanupInterval();
    }

    async onModuleDestroy() {
        this.logger.log('Module destruction initiated');
        await this.dispose();
    }

    public async dispose(): Promise<void> {
        this.logger.log('Starting service disposal', {
            activeConnections: this.clients.size,
            isShuttingDown: this.isShuttingDown
        });

        this.isShuttingDown = true;
        this.stopCleanupInterval();
        process.off('SIGTERM', this.boundShutdownHandler);
        process.off('SIGINT', this.boundShutdownHandler);
        this.connectionSemaphore.clear();
        await this.disconnectAll();

        this.logger.log('Service disposal completed');
    }

    private async handleShutdown(): Promise<void> {
        this.logger.warn('Graceful shutdown signal received', {
            activeConnections: this.clients.size,
            pendingConnections: this.connectionSemaphore.size
        });

        await this.dispose();
        await this.disconnectAll();

        this.logger.log('Graceful shutdown completed successfully');
        process.exit(0);
    }

    private createTimeoutPromise<T>(timeoutMs: number, signal?: AbortSignal): Promise<T> {
        return new Promise((_, reject) => {
            const timeoutId = setTimeout(() => {
                this.logger.debug('Operation timeout triggered', { timeoutMs });
                reject(new Error('Operation timeout'));
            }, timeoutMs);

            if (signal) {
                signal.addEventListener('abort', () => {
                    clearTimeout(timeoutId);
                    this.logger.debug('Operation aborted by signal', { timeoutMs });
                    reject(new Error('Operation aborted'));
                }, { once: true });
            }
        });
    }

    private isNonRetryableError(error: string): boolean {
        const errorMessage = error.toLowerCase();
        const nonRetryableErrors = [
            'user_deactivated_ban',
            'auth_key_unregistered',
            'session_revoked',
            'phone_number_banned',
            'user_deactivated'
        ];

        const isNonRetryable = nonRetryableErrors.some(errType => errorMessage.includes(errType));

        this.logger.debug('Error retryability check', {
            errorMessage: error,
            isNonRetryable,
            matchedErrors: nonRetryableErrors.filter(errType => errorMessage.includes(errType))
        });

        return isNonRetryable;
    }

    private async validateConnection(mobile: string, client: TelegramClient): Promise<boolean> {
        this.logger.debug(`Starting connection validation for ${mobile}`, {
            connected: client.connected,
            validationTimeout: this.VALIDATION_TIMEOUT
        });

        try {
            if (!client.connected) {
                this.logger.warn(`Client not connected during validation for ${mobile}`);
                return false;
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.VALIDATION_TIMEOUT);

            try {
                await Promise.race([
                    client.getMe(),
                    this.createTimeoutPromise(this.VALIDATION_TIMEOUT, controller.signal)
                ]);

                this.logger.debug(`Connection validation successful for ${mobile}`);
                return true;
            } finally {
                clearTimeout(timeoutId);
                controller.abort();
            }
        } catch (error) {
            this.logger.error(`Connection validation failed for ${mobile}`, {
                error: error.message,
                connected: client?.connected
            });
            return false;
        }
    }

    public async getClient(mobile: string, options: GetClientOptions = {}): Promise<ClientInfo> {
        if (!mobile) {
            this.logger.error('Mobile number validation failed', { mobile });
            throw new BadRequestException('Mobile number is required');
        }

        if (this.isShuttingDown) {
            this.logger.error(`Service shutting down, rejecting client request for ${mobile}`);
            throw new InternalServerErrorException('ConnectionManager is shutting down');
        }

        if (this.clients.size >= this.MAX_CONCURRENT_CONNECTIONS) {
            this.logger.error('Connection limit exceeded', {
                currentConnections: this.clients.size,
                maxConnections: this.MAX_CONCURRENT_CONNECTIONS,
                requestedMobile: mobile
            });
            throw new InternalServerErrorException('Maximum connection limit reached');
        }

        // Check if there's already a connection in progress for this mobile
        const existingPromise = this.connectionSemaphore.get(mobile);
        if (existingPromise) {
            this.logger.log(`Connection already in progress for ${mobile}, waiting for completion`);
            return existingPromise;
        }

        const {
            autoDisconnect = true,
            handler = true,
            timeout = this.CONNECTION_TIMEOUT,
            forceReconnect = false
        } = options;

        this.logger.log(`Starting client retrieval for ${mobile}`)

        let clientInfo = this.clients.get(mobile);
        if (clientInfo?.client) {
            this.logger.debug(`Existing client found for ${mobile}, validating connection`);
            const isValid = await this.validateConnection(mobile, clientInfo.client);
            if (!forceReconnect && isValid) {
                this.updateLastUsed(mobile);
                this.logger.log(`Reusing validated healthy client for ${mobile}`);
                return clientInfo;
            }
            this.logger.log(`Cleaning up existing client for ${mobile}`, {
                isValid,
                forceReconnect
            });
            await this.unregisterClient(mobile);
            clientInfo = undefined;
        }
        if (clientInfo) {
            this.logger.log(`Client info found but invalid for ${mobile}, cleaning up`);
            await this.unregisterClient(mobile);
            await sleep(1000);
        }

        // Create connection promise and store it in semaphore
        const connectionPromise = this.createNewClient(mobile, { autoDisconnect, handler, timeout });
        this.connectionSemaphore.set(mobile, connectionPromise);

        try {
            this.logger.log(`Creating fresh client connection for ${mobile}`);
            const result = await connectionPromise;
            this.logger.log(`Client successfully created for ${mobile} | name: ${result.name}, username: ${result.username}`);
            return result;
        } finally {
            // Always remove from semaphore when done
            this.connectionSemaphore.delete(mobile);
        }
    }


    private async createNewClient(
        mobile: string,
        options: { autoDisconnect: boolean; handler: boolean; timeout: number }
    ): Promise<ClientInfo> {

        this.logger.log(`Initiating new client creation for ${mobile}`);

        const users = await this.usersService.search({ mobile });
        const user = users[0] as User;
        if (!user) {
            this.logger.error(`User not found for mobile ${mobile}`);
            throw new BadRequestException('User not found');
        }

        const clientInfo: ClientInfo = {
            client: null,
            username: '',
            name: '',
            mobile: mobile,
            lastUsed: Date.now(),
            autoDisconnect: options.autoDisconnect,
        };

        try {
            this.logger.debug(`Creating TelegramClient instance for ${mobile}`);
            const telegramClient = new TelegramClient(new StringSession(user.session), parseInt(process.env.API_ID), process.env.API_HASH, {
                autoReconnect: true,
                requestRetries: 3,
                connectionRetries: 10,
                retryDelay: 500
            });

            await telegramClient.connect();
            if (telegramClient) {
                const me = await telegramClient.getMe();

                this.clients.set(mobile, clientInfo);
                clientInfo.client = telegramClient;
                clientInfo.lastUsed = Date.now();
                clientInfo.username = me.username;
                clientInfo.name = me.firstName;
                this.clients.set(mobile, clientInfo);
                return clientInfo;
            } else {
                this.logger.error(`Client creation returned null for ${mobile}`);
                throw new Error('Client creation returned null');
            }
        } catch (error) {
            this.logger.error(`New client creation failed for ${mobile}`, {
                error: error.message,
                stack: error.stack
            });

            const errorDetails = parseError(error, mobile, false);

            // Send notification for failures
            try {
                await BotConfig.getInstance().sendMessage(
                    ChannelCategory.ACCOUNT_LOGIN_FAILURES,
                    `${process.env.clientId}::${mobile}\nError: ${errorDetails.message}`
                );
                this.logger.debug(`Error notification sent for ${mobile}`);
            } catch (notificationError) {
                this.logger.error(`Failed to send error notification for ${mobile}`, {
                    error: notificationError.message
                });
            }

            // Handle permanent failures
            if (contains(errorDetails.message.toLowerCase(),
                ['expired', 'unregistered', 'deactivated', 'revoked', 'user_deactivated_ban'])) {
                this.logger.warn(`Marking user as expired due to permanent error for ${mobile}`, {
                    errorMessage: errorDetails.message
                });
                try {
                    await this.usersService.updateByFilter(
                        { $or: [{ tgId: user.tgId }, { mobile: mobile }] },
                        { expired: true }
                    );
                    this.logger.log(`User marked as expired for ${mobile}`);
                } catch (updateError) {
                    this.logger.error(`Failed to mark user as expired for ${mobile}`, {
                        error: updateError.message
                    });
                }
            }

            const connectionErrorDetails = parseError(error, mobile, false);
            throw new BadRequestException(connectionErrorDetails.message);
        }
    }

    // Enhanced cleanup with proper resource management
    private async cleanupInactiveConnections(maxIdleTime: number = 180000): Promise<void> {
        if (this.isShuttingDown) {
            this.logger.debug('Skipping cleanup - service is shutting down');
            return;
        }

        this.logger.log('Starting regular cleanup of inactive connections', {
            totalConnections: this.clients.size,
            maxIdleTime,
            timestamp: new Date().toISOString()
        });

        const now = Date.now();
        const cleanupResults = new Map<string, boolean>();
        const cleanupPromises: Array<Promise<void>> = [];
        const candidatesForCleanup: Array<{ mobile: string; idleTime: number; reason: string }> = [];

        for (const [mobile, connection] of this.clients.entries()) {
            const idleTime = now - connection.lastUsed;
            const shouldCleanup =
                (connection.autoDisconnect && idleTime > 100000) ||
                idleTime > Math.max(maxIdleTime, this.COOLDOWN_PERIOD);

            if (shouldCleanup) {
                const reason = connection.autoDisconnect && idleTime > 100000
                    ? 'auto-disconnect timeout'
                    : 'max idle time exceeded';

                candidatesForCleanup.push({ mobile, idleTime, reason });

                const cleanupPromise = this.unregisterClient(mobile)
                    .then(() => {
                        cleanupResults.set(mobile, true);
                        this.logger.debug(`Cleanup successful for ${mobile}`, { idleTime, reason });
                    })
                    .catch((error) => {
                        this.logger.error(`Cleanup failed for ${mobile}`, {
                            error: error.message,
                            idleTime,
                            reason
                        });
                        cleanupResults.set(mobile, false);

                        // Increment cleanup attempts
                        const clientInfo = this.clients.get(mobile);
                        if (clientInfo) {
                            this.clients.set(mobile, clientInfo);
                        }
                    });

                cleanupPromises.push(cleanupPromise);
            }
        }

        this.logger.log('Cleanup candidates identified', {
            candidateCount: candidatesForCleanup.length,
            candidates: candidatesForCleanup.map(c => ({ mobile: c.mobile, reason: c.reason }))
        });

        if (cleanupPromises.length > 0) {
            try {
                await Promise.race([
                    Promise.allSettled(cleanupPromises),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Cleanup timeout')), 30000)
                    )
                ]);
            } catch (error) {
                this.logger.error('Cleanup operation timed out', {
                    error: error.message,
                    cleanupCount: cleanupPromises.length
                });
            }

            // Log cleanup summary
            const failed = Array.from(cleanupResults.entries())
                .filter(([_, success]) => !success)
                .map(([mobile]) => mobile);

            const successful = Array.from(cleanupResults.entries())
                .filter(([_, success]) => success)
                .map(([mobile]) => mobile);

            this.logger.log('Cleanup operation completed', {
                totalProcessed: cleanupResults.size,
                successful: successful.length,
                failed: failed.length,
                failedClients: failed,
                remainingConnections: this.clients.size
            });

            if (failed.length > 0) {
                this.logger.warn('Some cleanup operations failed', {
                    failedClients: failed
                });
            }
        } else {
            this.logger.debug('No connections require cleanup at this time');
        }
    }

    private updateLastUsed(mobile: string): void {
        const connection = this.clients.get(mobile);
        if (connection) {
            const previousLastUsed = connection.lastUsed;
            connection.lastUsed = Date.now();
            this.clients.set(mobile, connection);

            this.logger.debug(`Updated last used timestamp for ${mobile}`, {
                previousLastUsed: new Date(previousLastUsed).toISOString(),
                newLastUsed: new Date(connection.lastUsed).toISOString()
            });
        } else {
            this.logger.warn(`Attempted to update last used for non-existent client ${mobile}`);
        }
    }

    public hasClient(number: string): boolean {
        const client = this.clients.get(number);
        const hasClient = client !== undefined;

        this.logger.debug(`Client existence check for ${number}`, {
            hasClient,
            isConnected: client?.client?.connected || false
        });

        return hasClient;
    }

    public async disconnectAll(): Promise<void> {
        this.logger.log('Starting disconnection of all clients', {
            totalClients: this.clients.size,
            timestamp: new Date().toISOString()
        });

        const disconnectionPromises: Promise<void>[] = [];
        const clientList = Array.from(this.clients.keys());

        for (const [mobile, connection] of this.clients.entries()) {
            this.logger.debug(`Scheduling disconnection for ${mobile}`, {
                username: connection.username,
                lastUsed: new Date(connection.lastUsed).toISOString()
            });
            disconnectionPromises.push(this.unregisterClient(mobile));
        }

        try {
            await Promise.race([
                Promise.allSettled(disconnectionPromises),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Disconnect all timeout')), 60000)
                )
            ]);

            this.logger.log('All disconnection operations completed', {
                processedCount: disconnectionPromises.length
            });
        } catch (error) {
            this.logger.error('Disconnect all operation timed out', {
                error: error.message,
                clientCount: disconnectionPromises.length,
                timeout: 60000
            });
        }

        this.clients.clear();
        this.logger.log('All clients disconnected and cleared', {
            finalClientCount: this.clients.size,
            originalClientList: clientList
        });
    }


    // Unified unregister method with timeout protection and proper cleanup sequence
    public async unregisterClient(mobile: string, timeoutMs: number = this.CLEANUP_TIMEOUT): Promise<void> {
        const clientInfo = this.clients.get(mobile);
        if (!clientInfo || !clientInfo.client) {
            this.logger.debug(`No client to unregister for ${mobile}`);
            return;
        }

        this.logger.log(`Starting client unregistration for ${mobile}`, {
            username: clientInfo.username,
            lastUsed: new Date(clientInfo.lastUsed).toISOString(),
            autoDisconnect: clientInfo.autoDisconnect,
            timeoutMs
        });

        try {
            // Destroy the client connection
            if (typeof clientInfo.client.destroy === 'function') {
                this.logger.debug(`Destroying client connection for ${mobile}`);
                await Promise.race([
                    clientInfo.client.destroy(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Destroy timeout')), timeoutMs)
                    )
                ]);
            }

            this.logger.log(`Client destroyed successfully for ${mobile}`);
        } catch (error) {
            this.logger.error(`Error during client destruction for ${mobile}`, {
                error: error.message,
                timeoutMs
            });
        } finally {
            // Clean up references
            try {
                clientInfo.client = null;
                this.clients.delete(mobile);
                this.logger.log(`Client removed from registry for ${mobile}`, {
                    remainingClients: this.clients.size
                });
            } catch (refError) {
                this.logger.error(`Error cleaning up client references for ${mobile}`, {
                    error: refError.message
                });
            }
        }
    }

    public getActiveConnectionCount(): number {
        const count = Array.from(this.clients.values()).length;
        this.logger.debug('Active connection count requested', { count });
        return count;
    }


    private async performHealthCheck(): Promise<void> {
        if (this.isShuttingDown) {
            this.logger.debug('Skipping health check - service is shutting down');
            return;
        }

        this.logger.log('Starting health check on active connections', {
            totalConnections: this.clients.size,
            timestamp: new Date().toISOString()
        });

        const healthResults = new Map<string, boolean>();
        const unhealthyClients: string[] = [];
        const healthCheckPromises: Promise<void>[] = [];

        for (const [mobile, clientInfo] of this.clients.entries()) {
            const healthCheckPromise = (async () => {
                try {
                    if (clientInfo.client && clientInfo.client.connected) {
                        this.logger.debug(`Checking health for ${mobile}`, {
                            username: clientInfo.username,
                            connected: clientInfo.client.connected
                        });

                        const isHealthy = await this.validateConnection(mobile, clientInfo.client);
                        healthResults.set(mobile, isHealthy);

                        if (!isHealthy) {
                            this.logger.warn(`Health check failed for ${mobile}, marking for cleanup`, {
                                username: clientInfo.username,
                                lastUsed: new Date(clientInfo.lastUsed).toISOString()
                            });
                            unhealthyClients.push(mobile);
                        } else {
                            this.logger.debug(`Health check passed for ${mobile}`);
                        }
                    } else {
                        this.logger.warn(`Client not connected during health check for ${mobile}`, {
                            hasClient: !!clientInfo.client,
                            connected: clientInfo.client?.connected || false
                        });
                        healthResults.set(mobile, false);
                        unhealthyClients.push(mobile);
                    }
                } catch (error) {
                    this.logger.error(`Health check error for ${mobile}`, {
                        error: error.message,
                        username: clientInfo.username
                    });
                    healthResults.set(mobile, false);
                    unhealthyClients.push(mobile);
                }
            })();

            healthCheckPromises.push(healthCheckPromise);
        }

        // Wait for all health checks to complete
        await Promise.allSettled(healthCheckPromises);

        // Clean up unhealthy clients
        const cleanupPromises = unhealthyClients.map(async (mobile) => {
            try {
                await this.unregisterClient(mobile);
                this.logger.log(`Cleaned up unhealthy client ${mobile}`);
            } catch (error) {
                this.logger.error(`Failed to cleanup unhealthy client ${mobile}`, {
                    error: error.message
                });
            }
        });

        await Promise.allSettled(cleanupPromises);

        const totalChecked = healthResults.size;
        const healthyCount = Array.from(healthResults.values()).filter(healthy => healthy).length;
        const cleanedUpCount = unhealthyClients.length;

        this.logger.log('Health check completed', {
            totalChecked,
            healthyCount,
            unhealthyCount: totalChecked - healthyCount,
            cleanedUpCount,
            remainingConnections: this.clients.size,
            healthyClients: Array.from(healthResults.entries())
                .filter(([_, healthy]) => healthy)
                .map(([mobile]) => mobile)
        });
    }

    public startCleanupInterval(intervalMs: number = 120000): NodeJS.Timeout | null {
        if (this.cleanupInterval) {
            this.logger.debug('Cleanup interval already running', { intervalMs });
            return this.cleanupInterval;
        }

        this.stopCleanupInterval();

        this.logger.log('Starting cleanup interval', {
            intervalMs,
            intervalMinutes: intervalMs / 60000
        });

        this.cleanupInterval = setInterval(() => {
            if (!this.isShuttingDown) {
                this.logger.debug('Executing scheduled cleanup and health check');

                // this.cleanupInactiveConnections().catch(err => {
                //     this.logger.error('Error in cleanup interval', {
                //         error: err.message,
                //         stack: err.stack
                //     });
                // });

                this.performHealthCheck().catch(err => {
                    this.logger.error('Error in health check', {
                        error: err.message,
                        stack: err.stack
                    });
                });

                // Log service health every 10 minutes (5 cleanup cycles)
                if (Math.random() < 0.2) { // ~20% chance each cycle = every ~10 minutes on average
                    this.logServiceHealth();
                }
            } else {
                this.logger.debug('Skipping scheduled tasks - service is shutting down');
            }
        }, intervalMs);

        this.logger.log('Cleanup interval started successfully', { intervalMs });

        // Run initial cleanup
        this.logger.log('Running initial cleanup and health check');
        // this.cleanupInactiveConnections().catch(err => {
        //     this.logger.error('Error in initial cleanup', {
        //         error: err.message
        //     });
        // });

        return this.cleanupInterval;
    }

    public stopCleanupInterval(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.logger.log('Cleanup interval stopped successfully');
            this.cleanupInterval = null;
        } else {
            this.logger.debug('No cleanup interval to stop');
        }
    }

    public getConnectionStats(): {
        total: number;
        connected: number;
        connecting: number;
        disconnecting: number;
        disconnected: number;
        error: number;
        retrying: number;
    } {
        this.logger.debug('Generating connection statistics');

        const stats = {
            total: this.clients.size,
            connected: 0,
            connecting: 0,
            disconnecting: 0,
            disconnected: 0,
            error: 0,
            retrying: 0
        };

        const clientDetails: Array<{mobile: string; status: string; username?: string}> = [];

        for (const [mobile, clientInfo] of this.clients.entries()) {
            if (!clientInfo.client) {
                stats.disconnected++;
                clientDetails.push({ mobile, status: 'disconnected' });
                continue;
            }

            try {
                if (clientInfo.client.connected) {
                    stats.connected++;
                    clientDetails.push({
                        mobile,
                        status: 'connected',
                        username: clientInfo.username
                    });
                } else if (clientInfo.client.disconnected) {
                    stats.disconnected++;
                    clientDetails.push({ mobile, status: 'disconnected' });
                } else {
                    // Assume connecting if not connected and not disconnected
                    stats.connecting++;
                    clientDetails.push({ mobile, status: 'connecting' });
                }
            } catch (error) {
                stats.error++;
                clientDetails.push({ mobile, status: 'error' });
                this.logger.warn(`Error checking status for ${mobile}`, {
                    error: error.message
                });
            }
        }

        this.logger.log('Connection statistics generated', {
            stats,
            clientDetails: clientDetails.slice(0, 10) // Log first 10 for brevity
        });

        return stats;
    }

    // Enhanced utility methods
    public getClientInfo(mobile: string): ClientInfo | undefined {
        const clientInfo = this.clients.get(mobile);
        this.logger.debug(`Client info requested for ${mobile}`, {
            found: !!clientInfo,
            username: clientInfo?.username,
            connected: clientInfo?.client?.connected || false,
            lastUsed: clientInfo ? new Date(clientInfo.lastUsed).toISOString() : undefined
        });
        return clientInfo;
    }

    public async forceReconnect(mobile: string): Promise<ClientInfo> {
        this.logger.log(`Force reconnection requested for ${mobile}`);

        const existingClient = this.clients.get(mobile);
        if (existingClient) {
            this.logger.log(`Cleaning up existing client before force reconnect for ${mobile}`, {
                username: existingClient.username,
                lastUsed: new Date(existingClient.lastUsed).toISOString()
            });
        }

        await this.unregisterClient(mobile);

        this.logger.log(`Starting force reconnection for ${mobile}`);
        const result = await this.getClient(mobile, { forceReconnect: true });

        this.logger.log(`Force reconnection completed for ${mobile}`, {
            username: result.username,
            name: result.name
        });

        return result;
    }

    /**
     * Logs comprehensive service health information
     */
    public logServiceHealth(): void {
        const stats = this.getConnectionStats();
        const now = Date.now();
        const connectionDetails: Array<{
            mobile: string;
            username: string;
            idleTimeMinutes: number;
            connected: boolean;
            autoDisconnect: boolean;
        }> = [];

        for (const [mobile, clientInfo] of this.clients.entries()) {
            connectionDetails.push({
                mobile,
                username: clientInfo.username || 'unknown',
                idleTimeMinutes: Math.round((now - clientInfo.lastUsed) / 60000),
                connected: clientInfo.client?.connected || false,
                autoDisconnect: clientInfo.autoDisconnect
            });
        }

        this.logger.log('Service health report', {
            timestamp: new Date().toISOString(),
            serviceStatus: {
                isShuttingDown: this.isShuttingDown,
                hasCleanupInterval: !!this.cleanupInterval,
                pendingConnections: this.connectionSemaphore.size
            },
            connectionStats: stats,
            connectionDetails: connectionDetails.slice(0, 20), // Limit to prevent log overflow
            configuration: {
                maxConcurrentConnections: this.MAX_CONCURRENT_CONNECTIONS,
                connectionTimeout: this.CONNECTION_TIMEOUT,
                cooldownPeriod: this.COOLDOWN_PERIOD,
                validationTimeout: this.VALIDATION_TIMEOUT,
                cleanupTimeout: this.CLEANUP_TIMEOUT
            }
        });
    }

    /**
     * Logs detailed error information with context
     */
    private logError(context: string, mobile: string, error: any, additionalContext?: any): void {
        const errorInfo = {
            context,
            mobile,
            error: {
                message: error?.message || 'Unknown error',
                name: error?.name,
                stack: error?.stack
            },
            timestamp: new Date().toISOString(),
            serviceState: {
                totalConnections: this.clients.size,
                isShuttingDown: this.isShuttingDown
            },
            ...additionalContext
        };

        this.logger.error(`${context} - ${mobile}`, errorInfo);
    }

    /**
     * Checks if an error is related to network/connectivity issues
     */
    private isNetworkError(error: any): boolean {
        const errorMessage = error?.message?.toLowerCase() || '';
        const networkErrorKeywords = [
            'timeout',
            'network',
            'connection',
            'disconnected',
            'ENOTFOUND',
            'ECONNRESET',
            'ETIMEDOUT'
        ];

        return networkErrorKeywords.some(keyword =>
            errorMessage.includes(keyword.toLowerCase())
        );
    }
}