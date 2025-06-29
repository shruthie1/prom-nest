import Imap from 'imap';
import { fetchNumbersFromString, sleep } from '../utils';
import { parseError } from '../utils/parseError';

export class MailReader {
    private static instance: MailReader;
    private imap: Imap;
    private isReady: boolean = false;
    private result: string = '';

    private constructor() {
        this.imap = new Imap({
            user: process.env.GMAIL_ADD || '',
            password: process.env.GMAIL_PASS || '',
            host: 'imap.gmail.com',
            port: 993,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false,
            },
        });

        this.imap.on('ready', () => {
            console.log('Mail is Ready');
            this.isReady = true;
        });

        this.imap.on('error', (err: Error) => {
            console.error('SomeError:', err);
            this.isReady = false;
        });

        this.imap.on('end', () => {
            console.log('Connection ended');
            this.isReady = false;
        });
    }

    public static getInstance(): MailReader {
        if (!MailReader.instance) {
            MailReader.instance = new MailReader();
        }
        return MailReader.instance;
    }

    public async connectToMail(): Promise<void> {
        console.log('Connecting to mail server');
        try {
            this.imap.connect();
            this.isReady = true;
            console.log('Connected to mail server');
        } catch (err) {
            console.error('Error connecting to mail server:', parseError(err));
            throw err;
        }
    }

    public async disconnectFromMail(): Promise<void> {
        console.log('Disconnecting from mail server');
        try {
            this.imap.end();
            this.isReady = false;
            console.log('Disconnected from mail server');
        } catch (err) {
            console.error('Error disconnecting from mail server:', parseError(err));
            throw err;
        }
    }

    public async isMailReady(): Promise<boolean> {
        return this.isReady;
    }

    public async getCode(): Promise<string> {
        console.log("MailReady : ", this.isReady)
        if (!this.isReady) {
            console.log("Re-Connecting mail server");
            await this.connectToMail();
            await sleep(10000);
        }

        try {
            await this.openInbox();

            const searchCriteria = [['FROM', 'noreply@telegram.org']];
            const fetchOptions = { bodies: ['HEADER', 'TEXT'], markSeen: true };
            console.log('Inbox Opened');

            const results = await new Promise<any[]>((resolve, reject) => {
                this.imap.search(searchCriteria, (err, results) => {
                    if (err) {
                        console.error('Search error:', parseError(err));
                        reject(err);
                    } else {
                        resolve(results);
                    }
                });
            });

            if (results.length > 0) {
                console.log('Emails found:', results.length);
                const length = results.length;
                const fetch = this.imap.fetch([results[length - 1]], fetchOptions);

                await new Promise<void>((resolve, reject) => {
                    fetch.on('message', (msg, seqno) => {
                        const emailData: string[] = [];

                        msg.on('body', (stream, info) => {
                            let buffer = '';
                            stream.on('data', (chunk) => buffer += chunk.toString('utf8'));
                            stream.on('end', () => {
                                if (info.which === 'TEXT') {
                                    emailData.push(buffer);
                                }
                                this.imap.seq.addFlags([seqno], '\\Deleted', (err) => {
                                    if (err) reject(err);
                                    this.imap.expunge((err) => {
                                        if (err) reject(err);
                                        console.log('Deleted message');
                                    });
                                });
                            });
                        });

                        msg.once('end', () => {
                            console.log(`Email #${seqno}, Latest ${results[length - 1]}`);
                            console.log('EmailDataLength:', emailData.length);
                            console.log('Mail:', emailData[emailData.length - 1].split('.'));
                            this.result = fetchNumbersFromString(emailData[emailData.length - 1].split('.')[0]);
                            resolve();
                        });
                    });

                    fetch.once('end', () => {
                        console.log('Fetched mails');
                        resolve();
                    });
                });
            } else {
                console.log('No new emails found');
            }

            console.log('Returning result:', this.result);
            return this.result;
        } catch (error) {
            console.error('Error:', error);
            this.isReady = false;
            throw error;
        }
    }

    private async openInbox(): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            this.imap.openBox('INBOX', false, (err) => {
                if (err) {
                    console.error('Open Inbox error:', parseError(err));
                    reject(err);
                } else {
                    console.log('Inbox opened');
                    resolve();
                }
            });
        });
    }
}