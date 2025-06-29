import { ApiPropertyOptional, } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({ description: 'Session information of the user', required: false, example: 'string' })
  session?: string;

  @ApiPropertyOptional({ description: 'First name of the user', required: false, example: 'Praveen' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'Last name of the user', required: false, example: null })
  lastName?: string | null;

  @ApiPropertyOptional({ description: 'Username of the user', required: false, example: null })
  username?: string | null;

  @ApiPropertyOptional({ description: 'Number of channels', required: false, example: 56 })
  channels?: number;

  @ApiPropertyOptional({ description: 'Number of personal chats', required: false, example: 74 })
  personalChats?: number;

  @ApiPropertyOptional({ description: 'Number of messages', required: false, example: 0 })
  msgs?: number;

  @ApiPropertyOptional({ description: 'Total number of chats', required: false, example: 195 })
  totalChats?: number;

  @ApiPropertyOptional({ description: 'Timestamp of last active', required: false, example: '2024-06-03' })
  lastActive?: string;

  @ApiPropertyOptional({ description: 'Telegram ID of the user', required: false, example: '2022068676' })
  tgId?: string;

  @ApiPropertyOptional({ description: 'TwoFA status', required: false, example: false })
  twoFA?: boolean;

  @ApiPropertyOptional({ description: 'Expiration status', required: false, example: false })
  expired?: boolean;

  @ApiPropertyOptional({ description: 'password', required: false, example: "pass" })
  password?: string;

  @ApiPropertyOptional({ description: 'Number of movies', required: false, example: 0 })
  movieCount?: number;

  @ApiPropertyOptional({ description: 'Number of photos', required: false, example: 0 })
  photoCount?: number;

  @ApiPropertyOptional({ description: 'Number of videos', required: false, example: 0 })
  videoCount?: number;

  @ApiPropertyOptional({ description: 'Gender of the user', required: false, example: null })
  gender?: string | null;

  @ApiPropertyOptional({ description: 'Number of other photos', required: false, example: 0 })
  otherPhotoCount?: number;

  @ApiPropertyOptional({ description: 'Number of other videos', required: false, example: 0 })
  otherVideoCount?: number;

  @ApiPropertyOptional({ description: 'Number of own photos', required: false, example: 0 })
  ownPhotoCount?: number;

  @ApiPropertyOptional({ description: 'Number of own videos', required: false, example: 0 })
  ownVideoCount?: number;

  @ApiPropertyOptional({ description: 'Number of contacts', required: false, example: 105 })
  contacts?: number;

  @ApiPropertyOptional({
    description: 'Call details of the user',
    required: false, example: {
      outgoing: 1,
      incoming: 0,
      video: 1,
      chatCallCounts: [],
      totalCalls: 1,
    },
  })
  calls?: {
    outgoing: number;
    incoming: number;
    video: number;
    chatCallCounts: any[];
    totalCalls: number;
  };

  @ApiPropertyOptional({
    description: 'Call details of the user',
    required: false, example: []
  })
  recentUsers?: any[];
}
