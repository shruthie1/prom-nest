/**
 * @module common-tg-service
 * Common Telegram Service - A comprehensive NestJS service for Telegram functionality
 */

// Core exports
export { AppModule } from './app.module';
export { AppController } from './app.controller';
export { MemoryCleanerService } from './memory-cleanup.service';


// Utility exports
export * from './utils';
export * from './middlewares';

// Type definitions
export * from './IMap/IMap';