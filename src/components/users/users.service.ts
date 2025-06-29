import { BadRequestException, Inject, Injectable, InternalServerErrorException, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { SearchUserDto } from './dto/search-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
@Injectable()
export class UsersService {
  constructor(@InjectModel('userModule') private userModel: Model<UserDocument>,
  ) {}


  async findAll(): Promise<User[]> {
    return this.userModel.find().exec();
  }

  async findOne(tgId: string): Promise<User> {
    const user = await (await this.userModel.findOne({ tgId }).exec())?.toJSON()
    if (!user) {
      throw new NotFoundException(`User with tgId ${tgId} not found`);
    }
    return user;
  }

  async update(tgId: string, user: UpdateUserDto): Promise<number> {
    delete user['_id']
    const result = await this.userModel.updateMany({ tgId }, { $set: user }, { new: true, upsert: true }).exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException(`Users with tgId ${tgId} not found`);
    }
    return result.modifiedCount;
  }

  async updateByFilter(filter: any, user: Partial<UpdateUserDto>): Promise<number> {
    delete user['_id']
    const result = await this.userModel.updateMany(filter, { $set: user }, { new: true, upsert: true }).exec();
    if (result.matchedCount === 0) {
      throw new NotFoundException(`Users with tgId ${JSON.stringify(filter)} not found`);
    }
    return result.modifiedCount;
  }

  async delete(tgId: string): Promise<void> {
    const result = await this.userModel.deleteOne({ tgId }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`User with tgId ${tgId} not found`);
    }
  }
  async search(filter: SearchUserDto): Promise<User[]> {
    if (filter.firstName) {
      filter.firstName = { $regex: new RegExp(filter.firstName, 'i') } as any
    }
    if (filter.twoFA !== undefined) {
      filter.twoFA = filter.twoFA as any === 'true' || filter.twoFA as any === '1' || filter.twoFA === true;
    }
    console.log(filter)
    return this.userModel.find(filter).sort({ updatedAt: -1 }).exec();
  }

  async executeQuery(query: any, sort?: any, limit?: number, skip?: number): Promise<User[]> {
    try {
      if (!query) {
        throw new BadRequestException('Query is invalid.');
      }
      const queryExec = this.userModel.find(query);

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

}
