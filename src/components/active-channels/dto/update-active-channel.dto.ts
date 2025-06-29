// src/activechannels/dto/update-activechannel.dto.ts
import { PartialType } from '@nestjs/swagger';
import { CreateActiveChannelDto } from './create-active-channel.dto';

export class UpdateActiveChannelDto extends PartialType(CreateActiveChannelDto) {}
