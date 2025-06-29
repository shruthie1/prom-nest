import { forwardRef, Module } from '@nestjs/common';
import { ConnectionManagerService } from './connection-manager.service';
import { ClientManagementService } from './services/client-management.service';
import { HealthCheckService } from './services/health-check.service';
import { RotationManagementService } from './services/rotation-management.service';
import { ClientModule } from '../clients/client.module';
import { TelegramModule } from '../telegram/telegram.module';
import { PromotionModule } from '../promotions';

@Module({
  imports: [
    ClientModule,
    TelegramModule,
    forwardRef(() => PromotionModule)
  ],
  providers: [
    ConnectionManagerService,
    ClientManagementService,
    HealthCheckService,
    RotationManagementService,
  ],
  exports: [
    ConnectionManagerService,
    ClientManagementService,
    HealthCheckService,
    RotationManagementService,
  ],
})
export class ConnectionManagerModule {}
