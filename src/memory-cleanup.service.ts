// src/common/memory-cleaner.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';

@Injectable()
export class MemoryCleanerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MemoryCleanerService.name);
  private intervalId: NodeJS.Timeout | null = null;
  private readonly memoryLimitMB = 400; // Threshold in MB
  private readonly cleanupIntervalMs = 5 * 60 * 1000; // 5 minutes

  onModuleInit() {
    this.logger.log('MemoryCleanerService initialized.');
    this.intervalId = setInterval(() => this.monitorAndCleanup(), this.cleanupIntervalMs);
  }

  onModuleDestroy() {
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private getMemoryUsageInMB(): Record<string, string> {
    const mem = process.memoryUsage();
    return {
      rss: (mem.rss / 1024 / 1024).toFixed(2),
      heapUsed: (mem.heapUsed / 1024 / 1024).toFixed(2),
      heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(2),
      external: (mem.external / 1024 / 1024).toFixed(2),
    };
  }

  private monitorAndCleanup() {
    const mem = process.memoryUsage();
    const heapUsedMB = mem.heapUsed / 1024 / 1024;

    this.logger.log(`🧠 Heap Used: ${heapUsedMB.toFixed(2)} MB`);

    if (heapUsedMB > this.memoryLimitMB) {
      this.logger.warn(`🚨 Heap exceeded ${this.memoryLimitMB} MB. Cleaning up...`);
      this.cleanupMemory();
    }
  }

  cleanupMemory() {
    if (typeof global.gc === 'function') {
      global.gc();
      this.logger.log('✅ Manual GC triggered via global.gc()');
    } else {
      this.logger.warn('⚠️ GC not available. Start Node with --expose-gc');
    }

    const mem = this.getMemoryUsageInMB();
    this.logger.log(`🧹 Memory After Cleanup: ${JSON.stringify(mem)}`);
  }
}
