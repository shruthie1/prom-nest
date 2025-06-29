import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PromoteMsgsService } from './promote-msgs.service';
import { PromoteMsgsController } from './promote-msgs.controller';
import { PromoteMsgSchema } from './promote-msgs.schema';

@Global()
@Module({
  imports: [
    PromoteMsgModule,
    MongooseModule.forFeature([{ name: 'promotemsgModule', collection: 'promoteMsgs', schema: PromoteMsgSchema }]),
  ],
  providers: [PromoteMsgsService],
  controllers: [PromoteMsgsController],
  exports: [PromoteMsgsService],
})
export class PromoteMsgModule { }