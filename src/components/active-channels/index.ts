/**
 * Active Channels Module
 * @module active-channels
 */

export { ActiveChannelsModule } from './active-channels.module';
export { ActiveChannelsService } from './active-channels.service';

// Types & Models
export * from './dto';
export * from './schemas';

// Re-export types for convenience
export type { ActiveChannel } from './schemas/active-channel.schema';
