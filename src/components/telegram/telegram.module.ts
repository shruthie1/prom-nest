import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TelegramService } from './telegram.service';

@Module({
    imports: [UsersModule],
    providers: [TelegramService],
    exports: [TelegramService]
})
export class TelegramModule {}
