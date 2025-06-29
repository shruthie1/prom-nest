// src/activechannels/activechannels.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ActiveChannelsService } from './active-channels.service';
import { ActiveChannel, ActiveChannelSchema } from './schemas/active-channel.schema';
import { PromoteMsgModule } from '../promote-msgs/promote-msgs.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ActiveChannel.name, schema: ActiveChannelSchema }]),
    PromoteMsgModule
  ],
  providers: [ActiveChannelsService],
  exports: [ActiveChannelsService]
})
export class ActiveChannelsModule { }
