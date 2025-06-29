
import { Client, ClientSchema } from './schemas/client.schema';
import { ClientService } from './client.service';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Client.name, schema: ClientSchema }]),
  ],
  providers: [ClientService],
  exports: [ClientService]
})
export class ClientModule {}
