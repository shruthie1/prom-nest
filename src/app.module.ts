import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AppController } from './app.controller';
import { ClientModule } from './components/clients/client.module';
import { TelegramModule } from './components/telegram/telegram.module';
import { ConnectionManagerModule } from './components/connection-manager/connection-manager.module';
import { PromotionModule } from './components/promotions/promotion.module';
import { UsersModule } from './components/users/users.module';
import { MemoryCleanerService } from './memory-cleanup.service';

@Module({
  imports: [
    // Configuration module for environment variables
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // MongoDB connection using Mongoose
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('mongouri') || 'mongodb://localhost:27017/promotions-nest',
        maxPoolSize: 10,
      }),
      inject: [ConfigService],
    }),

    // Feature modules
    ClientModule,
    TelegramModule,
    forwardRef(() => ConnectionManagerModule),
    forwardRef(() => PromotionModule),
    UsersModule,
  ],
  controllers: [AppController],
  providers: [MemoryCleanerService],
})
export class AppModule {}