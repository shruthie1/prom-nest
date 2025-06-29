import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PromoteMsg } from './promote-msgs.schema';

@Injectable()
export class PromoteMsgsService {
    constructor(@InjectModel('promotemsgModule') private promotemsgModel: Model<PromoteMsg>) {
    }

    async OnModuleInit() {
        console.log("Config Module Inited")
    }

    async findOne(): Promise<any> {
        const user = (await this.promotemsgModel.findOne({}, { _id: 0 }).exec())?.toJSON();
        if (!user) {
            throw new NotFoundException(`promotemsgModel not found`);
        }
        return user;
    }

    async update(updateClientDto: any): Promise<any> {
        delete updateClientDto['_id']
        const updatedUser = await this.promotemsgModel.findOneAndUpdate(
            {}, // Assuming you want to update the first document found in the collection
            { $set: { ...updateClientDto } },
            { new: true, upsert: true }
        ).exec();
        if (!updatedUser) {
            throw new NotFoundException(`promotemsgModel not found`);
        }
        return updatedUser;
    }

}
