import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client, ClientDocument } from './schemas/client.schema';
import { CreateClientDto } from './dto/create-client.dto';
import { parseError } from '../../utils/parseError';

@Injectable()
export class ClientService {
    private readonly logger = new Logger(ClientService.name);
    constructor(@InjectModel(Client.name) private clientModel: Model<ClientDocument>) {
    }

    async findAll(): Promise<Client[]> {
        this.logger.debug('Retrieving all client documents');
        try {
            return await this.clientModel.find({}, { _id: 0, updatedAt: 0 }).lean().exec();
        } catch (error) {
            parseError(error, 'Failed to retrieve all clients: ', true);
            this.logger.error(`Failed to retrieve all clients: ${error.message}`, error.stack);
            throw error;
        }
    }

    async findAllMasked(): Promise<Partial<Client>[]> {
        const clients = await this.findAll();
        const maskedClients = clients.map(client => {
            const { session, mobile, password, promoteMobile, ...maskedClient } = client;
            return { ...maskedClient };
        });
        return maskedClients;
    }

    async findOne(clientId: string, throwErr: boolean = true): Promise<Client> {
        const user = await this.clientModel.findOne({ clientId }, { _id: 0, updatedAt: 0 }).lean().exec();
        if (!user && throwErr) {
            throw new NotFoundException(`Client with ID "${clientId}" not found`);
        }
        return user;
    }

    async search(filter: any): Promise<Client[]> {
        console.log(filter)
        if (filter.firstName) {
            filter.firstName = { $regex: new RegExp(filter.firstName, 'i') }
        }
        console.log(filter)
        return this.clientModel.find(filter).exec();
    }

    async addPromoteMobile(clientId: string, mobileNumber: string): Promise<Client> {
        return this.clientModel.findOneAndUpdate(
            { clientId }, // Filter by clientId
            { $addToSet: { promoteMobile: mobileNumber } }, // Add only if it doesn't already exist
            { new: true } // Return the updated document
        ).exec();
    }

    async removePromoteMobile(clientId: string, mobileNumber: string): Promise<Client> {
        return this.clientModel.findOneAndUpdate(
            { clientId }, // Filter by clientId
            { $pull: { promoteMobile: mobileNumber } }, // Remove the specified number
            { new: true } // Return the updated document
        ).exec();
    }

    async getActiveClients() {
        return [{
            username: "test",
            clientId: "testClient",
            promoteMobile: [
                "918735077313",
                "919581094838",
            ]
        }]
        // const envClients = process.env.ACTIVE_CLIENTS ? process.env.ACTIVE_CLIENTS.split(',') : [];
        // try {
        //     return await this.clientModel.find({ clientId: { $in: envClients } }, { _id: 0, updatedAt: 0 }).lean().exec();
        // } catch (error) {
        //     this.logger.error(`Failed to retrieve active clients: ${error.message}`, error.stack);
        //     throw new NotFoundException(`No active clients found`);
        // }
    }
}
