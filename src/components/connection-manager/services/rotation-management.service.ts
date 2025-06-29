import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';
import {
  RotationStatus,
  RotationPatterns
} from '../interfaces/connection-manager.interfaces';
import { ConnectionManagerConfig } from '../config/connection-manager.config';
import { ClientManagementService } from './client-management.service';

@Injectable()
export class RotationManagementService {
  private readonly logger = new Logger(RotationManagementService.name);

  private availableMobiles: string[] = [];
  private currentActiveMobiles: string[] = [];
  private lastRotationTime = new Date();
  private nextRotationTime = new Date();
  private rotationHistory: { timestamp: Date; selectedMobiles: string[] }[] = [];

  constructor(private readonly clientService: ClientManagementService) {}

  async initializeWithMobilePool(pool: string[]): Promise<void> {
    this.logger.log(`Initializing rotation service with mobile pool of ${pool.length} mobiles: [${pool.join(', ')}]`);
    this.availableMobiles = [...pool];
    await this.selectActiveMobiles();
    this.lastRotationTime = new Date();
    this.logger.log(`Rotation service initialized successfully. Active mobiles: [${this.currentActiveMobiles.join(', ')}]`);
  }

  public async rotateActiveMobiles(): Promise<void> {
    await this.handleRotation();
  }

  private async selectActiveMobiles() {
    const count = Math.min(ConnectionManagerConfig.ACTIVE_SLOTS, this.availableMobiles.length);
    const previousActive = [...this.currentActiveMobiles];
    this.currentActiveMobiles = this.shuffle([...this.availableMobiles]).slice(0, count);

    this.logger.log(`Mobile selection: ${count} slots from ${this.availableMobiles.length} available mobiles`);
    this.logger.debug(`Previous active: [${previousActive.join(', ')}]`);
    this.logger.debug(`New active: [${this.currentActiveMobiles.join(', ')}]`);
    this.addToHistory(this.currentActiveMobiles);
  }

  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private addToHistory(mobiles: string[]) {
    this.rotationHistory.push({ timestamp: new Date(), selectedMobiles: [...mobiles] });
    this.logger.debug(`Added rotation to history: [${mobiles.join(', ')}] - Total history entries: ${this.rotationHistory.length}`);

    if (this.rotationHistory.length > ConnectionManagerConfig.MAX_ROTATION_HISTORY) {
      const removed = this.rotationHistory.length - ConnectionManagerConfig.MAX_ROTATION_HISTORY;
      this.rotationHistory.splice(0, this.rotationHistory.length - ConnectionManagerConfig.MAX_ROTATION_HISTORY);
      this.logger.debug(`Trimmed ${removed} old entries from rotation history`);
    }
  }

  async refreshAvailableMobiles(): Promise<void> {
    const previousCount = this.availableMobiles.length;
    const previousActive = [...this.currentActiveMobiles];

    this.availableMobiles = this.clientService.getAllAvailableMobiles();
    this.currentActiveMobiles = this.currentActiveMobiles.filter(m => this.availableMobiles.includes(m));

    const removedFromActive = previousActive.filter(m => !this.currentActiveMobiles.includes(m));

    this.logger.log(`Refreshed mobile pool: ${previousCount} → ${this.availableMobiles.length} available mobiles`);
    if (removedFromActive.length > 0) {
      this.logger.warn(`Removed ${removedFromActive.length} unhealthy mobiles from active list: [${removedFromActive.join(', ')}]`);
    }
    this.logger.debug(`Current active mobiles after refresh: [${this.currentActiveMobiles.join(', ')}]`);
  }

  clearRotationState(): void {
    this.logger.log('Clearing all rotation state and resetting service');
    this.logger.debug(`Clearing state: ${this.availableMobiles.length} available, ${this.currentActiveMobiles.length} active, ${this.rotationHistory.length} history entries`);

    this.availableMobiles = [];
    this.currentActiveMobiles = [];
    this.lastRotationTime = new Date();
    this.nextRotationTime = new Date();
    this.rotationHistory = [];

    this.logger.log('Rotation state cleared successfully');
  }

  private async handleRotation() {
    const startTime = Date.now();
    this.logger.log('Starting mobile rotation process');
    const prev = [...this.currentActiveMobiles];
    await this.selectActiveMobiles();
    const next = [...this.currentActiveMobiles];

    const toConnect = next.filter(m => !prev.includes(m));
    const toRemove = prev.filter(m => !next.includes(m));

    this.logger.log(`Rotation changes: ${toRemove.length} to remove, ${toConnect.length} to connect`);
    if (toRemove.length > 0) {
      this.logger.debug(`Removing mobiles: [${toRemove.join(', ')}]`);
    }
    if (toConnect.length > 0) {
      this.logger.debug(`Connecting mobiles: [${toConnect.join(', ')}]`);
    }

    try {
      // Remove clients first
      for (const m of toRemove) {
        this.logger.debug(`Removing client for mobile: ${m}`);
        await this.clientService.removeClientForMobile(m);
      }

      // Then create new clients
      for (const m of toConnect) {
        this.logger.debug(`Creating client for mobile: ${m}`);
        await this.clientService.createClientForMobile(m);
      }

      this.lastRotationTime = new Date();
      const duration = Date.now() - startTime;
      this.logger.log(`Mobile rotation completed successfully in ${duration}ms`);

    } catch (error) {
      this.logger.error(`Error during mobile rotation: ${error.message}`, error.stack);
      throw error;
    }
  }

  getCurrentActiveMobiles(): string[] {
    this.logger.debug(`Requested current active mobiles: [${this.currentActiveMobiles.join(', ')}]`);
    return [...this.currentActiveMobiles];
  }


  getAvailableMobiles(): string[] {
    this.logger.debug(`Requested available mobiles: [${this.availableMobiles.join(', ')}]`);
    return [...this.availableMobiles];
  }

  getActiveTelegramClients(): Map<string, TelegramClient> {
    const map = new Map<string, TelegramClient>();
    let connectedCount = 0;

    for (const m of this.currentActiveMobiles) {
      const client = this.clientService.getTelegramClient(m);
      if (client) {
        map.set(m, client);
        connectedCount++;
      }
    }
    return map;
  }

  getRotationStatus(): RotationStatus {
    const healthy = Array.from(this.clientService.getActiveConnectionsMap().values())
      .filter(c => c.isActive && c.telegramClient?.connected).length;

    const status = {
      totalAvailableMobiles: this.availableMobiles.length,
      currentActiveMobiles: [...this.currentActiveMobiles],
      nextRotationIn: Math.max(0, this.nextRotationTime.getTime() - Date.now()),
      activeSlotsUsed: this.currentActiveMobiles.length,
      maxActiveSlots: ConnectionManagerConfig.ACTIVE_SLOTS,
      lastRotationTime: this.lastRotationTime,
      totalActiveConnections: this.clientService.getActiveConnectionsMap().size,
      healthyMobiles: healthy,
      rotationHistory: [...this.rotationHistory.slice(-10)],
      isRandomized: true,
    };

    this.logger.debug(`Rotation status: ${healthy}/${status.totalActiveConnections} healthy, ${status.activeSlotsUsed}/${status.maxActiveSlots} slots used, next in ${Math.round(status.nextRotationIn / 1000)}s`);
    return status;
  }

  getRotationPatterns(): RotationPatterns {
    const history = this.rotationHistory;
    if (history.length < 2) {
      this.logger.debug(`Insufficient rotation history for patterns analysis: ${history.length} entries`);
      return { totalRotations: history.length, averageMobilesPerRotation: 0, uniqueMobilesUsed: 0, mostUsedMobiles: [], averageTimeBetweenRotations: 0 };
    }

    const usage = new Map<string, number>();
    let totalMobiles = 0;
    let totalDiff = 0;

    history.forEach((r, i) => {
      totalMobiles += r.selectedMobiles.length;
      r.selectedMobiles.forEach(m => usage.set(m, (usage.get(m) || 0) + 1));
      if (i > 0) {
        totalDiff += r.timestamp.getTime() - history[i - 1].timestamp.getTime();
      }
    });

    const patterns = {
      totalRotations: history.length,
      averageMobilesPerRotation: totalMobiles / history.length,
      uniqueMobilesUsed: usage.size,
      mostUsedMobiles: Array.from(usage.entries()).map(([mobile, count]) => ({ mobile, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      averageTimeBetweenRotations: totalDiff / (history.length - 1)
    };

    this.logger.debug(`Rotation patterns: ${patterns.totalRotations} rotations, ${patterns.uniqueMobilesUsed} unique mobiles, avg ${Math.round(patterns.averageTimeBetweenRotations / 1000)}s between rotations`);
    return patterns;
  }

  getRandomMobile(): string | null {
    if (!this.availableMobiles.length) {
      this.logger.warn('No available mobiles for random selection');
      return null;
    }

    const selected = this.availableMobiles[Math.floor(Math.random() * this.availableMobiles.length)];
    this.logger.debug(`Random mobile selected: ${selected} from ${this.availableMobiles.length} available`);
    return selected;
  }

  getRotationStatistics() {
    const stats = {
      totalAvailable: this.availableMobiles.length,
      currentActive: this.currentActiveMobiles.length,
      maxSlots: ConnectionManagerConfig.ACTIVE_SLOTS,
      lastRotation: this.lastRotationTime,
      nextRotationIn: Math.max(0, this.nextRotationTime.getTime() - Date.now()),
      isRandomized: true,
      rotationHistory: this.rotationHistory.length,
    };

    this.logger.debug(`Rotation statistics: ${stats.currentActive}/${stats.maxSlots} active slots, ${stats.totalAvailable} available, ${stats.rotationHistory} history entries`);
    return stats;
  }

  removeFromActiveLists(mobile: string): void {
    const wasAvailable = this.availableMobiles.includes(mobile);
    const wasActive = this.currentActiveMobiles.includes(mobile);

    this.availableMobiles = this.availableMobiles.filter(m => m !== mobile);
    this.currentActiveMobiles = this.currentActiveMobiles.filter(m => m !== mobile);

    if (wasAvailable || wasActive) {
      this.logger.log(`Removed mobile ${mobile} from lists - was available: ${wasAvailable}, was active: ${wasActive}`);
      this.logger.debug(`Updated lists - available: ${this.availableMobiles.length}, active: ${this.currentActiveMobiles.length}`);
    } else {
      this.logger.debug(`Mobile ${mobile} was not in any active lists`);
    }
  }
}
