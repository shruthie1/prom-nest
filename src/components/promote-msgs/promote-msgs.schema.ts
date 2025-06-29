import { Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document } from 'mongoose';

export type PromoteMsgDocument = PromoteMsg & Document;

@Schema({versionKey: false, autoIndex: true,strict: false ,  timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (doc, ret) => {
        delete ret._id;
      },
    },})
export class PromoteMsg {}

export const PromoteMsgSchema = SchemaFactory.createForClass(PromoteMsg);
PromoteMsgSchema.add({ type: mongoose.Schema.Types.Mixed });

