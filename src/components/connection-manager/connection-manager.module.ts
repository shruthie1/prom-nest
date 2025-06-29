import { Module } from '@nestjs/common';
import { ConnectionManagerService } from './connection-manager.service';
import { ClientManagementService } from './services/client-management.service';
import { HealthCheckService } from './services/health-check.service';
import { RotationManagementService } from './services/rotation-management.service';
import { ClientModule } from '../clients/client.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [ClientModule, TelegramModule],
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
