import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ApiProperty } from '@nestjs/swagger';
import { Document } from 'mongoose';

export type ClientDocument = Client & Document;

@Schema({
    collection: 'clients', versionKey: false, autoIndex: true, timestamps: true,
    toJSON: {
        virtuals: true,
        transform: (doc, ret) => {
            delete ret._id;
        },
    },
})
export class Client {
    @ApiProperty({ example: 'paid_giirl_shruthiee', description: 'Channel link of the user' })
    @Prop({ required: true })
    channelLink: string;

    @ApiProperty({ example: 'shruthi', description: 'Database collection name' })
    @Prop({ required: true })
    dbcoll: string;

    @ApiProperty({ example: 'PaidGirl.netlify.app/Shruthi1', description: 'Link of the user' })
    @Prop({ required: true })
    link: string;

    @ApiProperty({ example: 'Shruthi Reddy', description: 'Name of the user' })
    @Prop({ required: true })
    name: string;

    @ApiProperty({ example: '916265240911', description: 'mobile number of the user' })
    @Prop({ required: true })
    mobile: string;

    @ApiProperty({ example: 'Ajtdmwajt1@', description: 'Password of the user' })
    @Prop({ required: true })
    password: string;

    @ApiProperty({ example: 'https://shruthi1.glitch.me', description: 'Repl link of the user' })
    @Prop({ required: true })
    repl: string;

    @ApiProperty({ example: 'https://shruthiprom0101.glitch.me', description: 'Promotion Repl link of the user' })
    @Prop({ required: true })
    promoteRepl: string;

    @ApiProperty({ example: '1BQANOTEuM==', description: 'Session token' })
    @Prop({ required: true })
    session: string;

    @ApiProperty({ example: 'ShruthiRedd2', description: 'Username of the user' })
    @Prop({ required: true })
    username: string;

    @ApiProperty({ example: 'shruthi1', description: 'Client ID of the user' })
    @Prop({ required: true })
    clientId: string;

    @ApiProperty({ example: 'https://shruthi1.glitch.me/exit', description: 'Deployment key URL' })
    @Prop({ required: true })
    deployKey: string;

    @ApiProperty({ example: 'ShruthiRedd2', description: 'Main account of the user' })
    @Prop({ required: true })
    mainAccount: string;

    @ApiProperty({ example: 'booklet_10', description: 'Product associated with the user' })
    @Prop({ required: true })
    product: string;

    @ApiProperty({ example: ['916265240911'], description: 'Promote mobile number of the user' })
    @Prop({ required: true, type: [String] })
    promoteMobile: string[];

    @ApiProperty({ example: 'paytmqr281005050101xv6mfg02t4m9@paytm', description: 'Paytm QR ID of the user' })
    @Prop({ required: true })
    qrId: string;

    @ApiProperty({ example: 'myred1808@postbank', description: 'Google Pay ID of the user' })
    @Prop({ required: true })
    gpayId: string;
}

export const ClientSchema = SchemaFactory.createForClass(Client);
