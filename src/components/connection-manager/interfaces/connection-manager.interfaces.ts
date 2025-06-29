import { TelegramClient } from 'telegram';
import { ClientInfo } from '../../../utils/shared.interfaces';

export interface ActiveConnection {
  mobile: string;
  telegramClient: TelegramClient;
  clientInfo: ClientInfo;
  clientId: string;
  isActive: boolean;
  lastHealthCheck: Date;
  createdAt: Date;
}

export interface ConnectionAttemptResult {
  success: boolean;
  error?: string;
  attempts: number;
}

export interface RotationStatus {
  totalAvailableMobiles: number;
  currentActiveMobiles: string[];
  nextRotationIn: number;
  activeSlotsUsed: number;
  maxActiveSlots: number;
  lastRotationTime: Date;
  totalActiveConnections: number;
  healthyMobiles: number;
  rotationHistory: { timestamp: Date; selectedMobiles: string[] }[];
  isRandomized: boolean;
}

export interface RotationPatterns {
  totalRotations: number;
  averageMobilesPerRotation: number;
  uniqueMobilesUsed: number;
  mostUsedMobiles: { mobile: string; count: number }[];
  averageTimeBetweenRotations: number;
}

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'initializing' | 'shutting_down';
  readyForOperations: boolean;
  issues: string[];
}

export interface ServiceStatistics {
  totalActiveConnections: number;
  activeConnections: number;
  connectedClients: number;
  failedClients: number;
  rotationStats: {
    totalAvailable: number;
    currentActive: number;
    maxSlots: number;
    lastRotation: Date;
    nextRotationIn: number;
    isRandomized: boolean;
    rotationHistory: number;
  };
  healthStats: {
    healthy: number;
    unhealthy: number;
  };
  uptime: {
    serviceSince: Date;
    lastHealthCheck: Date;
  };
}

export interface ConnectionInfo {
  isHealthy: boolean;
  isConnected: boolean;
  clientId: string;
  mainAccUsername: string;
  lastHealthCheck: Date;
  createdAt: Date;
}

export interface ClientWithDetails {
  client: TelegramClient | null;
  error?: string;
  activeConnection?: ActiveConnection;
}

export interface HealthCheckResult {
  mobile: string;
  isHealthy: boolean;
  error?: string;
}
