import { forwardRef, Module } from '@nestjs/common';
import { PromotionService } from './promotion.service'; // Use the simplified service
import { PromotionController } from './promotion.controller';
import { PromotionStateService } from './services/promotion-state.service';
import { MessageQueueService } from './services/message-queue.service';
import { ConnectionManagerModule } from '../connection-manager/connection-manager.module';
import { ActiveChannelsModule } from '../active-channels';
import { PromoteMsgModule } from '../promote-msgs';

@Module({
  imports: [
    forwardRef(() => ConnectionManagerModule),
    ActiveChannelsModule,
    PromoteMsgModule
  ],
  controllers: [PromotionController],
  providers: [
    PromotionStateService, 
    MessageQueueService,      // Singleton message queue management
    PromotionService,         // Main service that orchestrates everything
  ],
  exports: [
    PromotionService,
    PromotionStateService,
    MessageQueueService,
  ],
})
export class PromotionModule {}
