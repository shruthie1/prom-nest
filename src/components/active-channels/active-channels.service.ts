import { PromoteMsgsService } from './../promote-msgs/promote-msgs.service';
// src/activechannels/activechannels.service.ts
import { BadRequestException, Inject, Injectable, InternalServerErrorException, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateActiveChannelDto } from './dto/create-active-channel.dto';
import { UpdateActiveChannelDto } from './dto/update-active-channel.dto';
import { ActiveChannel, ActiveChannelDocument } from './schemas/active-channel.schema';
import { parseError } from '../../utils/parseError';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { notifbot } from '../../utils/logbots';

@Injectable()
export class ActiveChannelsService {
  constructor(
    @InjectModel(ActiveChannel.name) private activeChannelModel: Model<ActiveChannelDocument>,
    @Inject(forwardRef(() => PromoteMsgsService))
    private promoteMsgsService: PromoteMsgsService
  ) {}

  async create(createActiveChannelDto: CreateActiveChannelDto): Promise<ActiveChannel> {
    createActiveChannelDto.availableMsgs = Object.keys(await this.promoteMsgsService.findOne())
    const createdChannel = new this.activeChannelModel(createActiveChannelDto);
    return createdChannel.save();
  }


  async createMultiple(createChannelDtos: CreateActiveChannelDto[]): Promise<string> {
    const bulkOps = createChannelDtos.map((dto) => ({
      updateOne: {
        filter: { channelId: dto.channelId },
        update: { $set: dto },
        upsert: true
      }
    }));

    await this.activeChannelModel.bulkWrite(bulkOps, { ordered: false });
    return 'Channels Saved';
  }

  async findAll(): Promise<ActiveChannel[]> {
    return this.activeChannelModel.find().exec();
  }

  async findOne(channelId: string): Promise<ActiveChannel> {
    const channel = (await this.activeChannelModel.findOne({ channelId }).exec())?.toJSON();
    return channel;
  }

  async update(channelId: string, updateActiveChannelDto: UpdateActiveChannelDto): Promise<ActiveChannel> {
    delete updateActiveChannelDto["_id"]
    const updatedChannel = await this.activeChannelModel.findOneAndUpdate(
      { channelId },
      { $set: updateActiveChannelDto },
      { new: true, upsert: true },
    ).exec();
    return updatedChannel;
  }

  async removeFromAvailableMsgs(channelId: string, msg: string) {
    return await this.activeChannelModel.findOneAndUpdate({ channelId }, { $pull: { availableMsgs: msg } })
  }

  async addToAvailableMsgs(channelId: string, msg: string) {
    return await this.activeChannelModel.findOneAndUpdate({ channelId }, { $addToSet: { availableMsgs: msg } })
  }

  async remove(channelId: string): Promise<void> {
    const result = await this.activeChannelModel.findOneAndDelete({ channelId }).exec();
  }

  async search(filter: any): Promise<ActiveChannel[]> {
    console.log(filter)
    return this.activeChannelModel.find(filter).exec();
  }

  async addReactions(channelId: string, reactions: string[]): Promise<ActiveChannel> {
    const channel = await this.activeChannelModel.findOneAndUpdate({ channelId }, {
      $addToSet: { reactions: reactions }
    })
    return channel;
  }

  async getRandomReaction(channelId: string): Promise<string> {
    const channel = (await this.activeChannelModel.findOne({ channelId }).exec())?.toJSON();
    if (!channel) {
      return undefined;
    }
    if (channel.reactions.length === 0) {
      return undefined;
    }
    const randomIndex = Math.floor(Math.random() * channel.reactions.length);
    return channel.reactions[randomIndex];
  }

  async removeReaction(channelId: string, reaction: string): Promise<ActiveChannel> {
    const channel = await this.activeChannelModel.findOneAndUpdate({ channelId }, {
      $pull: { reactions: reaction },
    })
    return channel;
  }

  async getActiveChannels(limit = 50, skip = 0, notIds = []) {
    const query = {
      '$and':
        [
          {
            '$or':
              [
                { title: { '$regex': /wife|adult|lanj|lesb|paid|coupl|cpl|randi|bhab|boy|girl|friend|frnd|boob|pussy|dating|swap|gay|sex|bitch|love|video|service|real|call|desi/i } },
                { username: { '$regex': /wife|adult|lanj|lesb|paid|coupl|cpl|randi|bhab|boy|girl|friend|frnd|boob|pussy|dating|swap|gay|sex|bitch|love|video|service|real|call|desi/i } },
              ]
          },
          {
            '$or': [
              { title: { '$not': { '$regex': /online|realestat|propert|board|design|realt|class|PROFIT|wholesale|retail|topper|exam|motivat|medico|shop|follower|insta|traini|cms|cma|subject|currency|color|amity|game|gamin|like|earn|popcorn|TANISHUV|bitcoin|crypto|mall|work|folio|health|civil|win|casino|shop|promot|english|invest|fix|money|book|anim|angime|support|cinema|bet|predic|study|youtube|sub|open|trad|cric|quot|exch|movie|search|film|offer|ott|deal|quiz|academ|insti|talkies|screen|series|webser/i } } },
              { username: { '$not': { '$regex': /online|realestat|propert|board|design|realt|class|PROFIT|wholesale|retail|topper|exam|motivat|medico|shop|follower|insta|traini|cms|cma|subject|currency|color|amity|game|gamin|like|earn|popcorn|TANISHUV|bitcoin|crypto|mall|work|folio|health|civil|win|casino|shop|promot|english|invest|fix|money|book|anim|angime|support|cinema|bet|predic|study|youtube|sub|open|trad|cric|quot|exch|movie|search|film|offer|ott|deal|quiz|academ|insti|talkies|screen|series|webser/i } } },
            ]
          },
          {
            channelId: { '$nin': notIds },
            participantsCount: { $gt: 600 },
            username: {$ne: null},
            canSendMsgs: true,
            restricted: false,
            forbidden: false
          }
        ]
    }

    const sort: Record<string, 1 | -1> = { participantsCount: -1 }
    try {
      const result: ActiveChannel[] = await this.activeChannelModel.aggregate([
        { $match: query },
        { $skip: skip },
        { $limit: limit },
        { $sort: sort }, // Sort by the random field
        { $project: { randomField: 0 } } // Remove the random field from the output
      ]).exec();
      return result;
    } catch (error) {
      console.error('Error:', error);
      return [];
    }
  }
  async executeQuery(query: any, sort?: any, limit?: number, skip?: number): Promise<ActiveChannel[]> {
    try {
      if (!query) {
        throw new BadRequestException('Query is invalid.');
      }
      const queryExec = this.activeChannelModel.find(query);

      if (sort) {
        queryExec.sort(sort);
      }

      if (limit) {
        queryExec.limit(limit);
      }

      if (skip) {
        queryExec.skip(skip);
      }

      return await queryExec.exec();
    } catch (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  async resetWordRestrictions() {
    await fetchWithTimeout(`${notifbot()}&text=Request Received for Reset Available Msgs`);
    try {
      await this.activeChannelModel.updateMany({
        banned: false
      }, {
        $set: {
          "wordRestriction": 0,
          "dMRestriction": 0
        }
      })
    } catch (e) {
      console.log(parseError(e))
    }
  }

  async resetAvailableMsgs() {
    await fetchWithTimeout(`${notifbot()}&text=Request Received for Reset Available Msgs`);
    try {
      const data = await this.promoteMsgsService.findOne();
      const keys = Object.keys(data);
      await this.activeChannelModel.updateMany(
        {
          $expr: {
            $lt: [{ $size: { $ifNull: ["$availableMsgs", []] } }, 5]
          }
        },
        {
          $set: {
            "wordRestriction": 0,
            "dMRestriction": 0,
            "banned": false,
            "availableMsgs": keys
          }
        }
      );
    } catch (e) {
      console.log(parseError(e))
    }
  }

  async updateBannedChannels() {
    await fetchWithTimeout(`${notifbot()}&text=Request Received for update banned Channels`);
    await this.activeChannelModel.updateMany({ $or: [{ banned: true }, { private: true }] }, {
      $set: {
        "wordRestriction": 0,
        "dMRestriction": 0,
        banned: false,
        "private": false
      }
    })
  }

  async updateDefaultReactions() {
    await this.activeChannelModel.updateMany({}, {
      $set: {
        reactions: [
          '❤', '🔥', '👏', '🥰', '😁', '🤔',
          '🤯', '😱', '🤬', '😢', '🎉', '🤩',
          '🤮', '💩', '🙏', '👌', '🕊', '🤡',
          '🥱', '🥴', '😍', '🐳', '❤‍🔥', '💯',
          '🤣', '💔', '🏆', '😭', '😴', '👍',
          '🌚', '⚡', '🍌', '😐', '💋', '👻',
          '👀', '🙈', '🤝', '🤗', '🆒',
          '🗿', '🙉', '🙊', '🤷', '👎'
        ]
      }
    })
  }
}
