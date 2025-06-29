import { ApiProperty } from '@nestjs/swagger';

export class CreateClientDto {
    @ApiProperty({ example: 'paid_giirl_shruthiee', description: 'Channel link of the user' })
    readonly channelLink: string;

    @ApiProperty({ example: 'shruthi', description: 'Database collection name' })
    readonly dbcoll: string;

    @ApiProperty({ example: 'PaidGirl.netlify.app/Shruthi1', description: 'Link of the user' })
    readonly link: string;

    @ApiProperty({ example: 'Shruthi Reddy', description: 'Name of the user' })
    readonly name: string;

    @ApiProperty({ example: '+916265240911', description: 'Phone number of the user' })
    readonly mobile: string;

    @ApiProperty({ example: 'Ajtdmwajt1@', description: 'Password of the user' })
    readonly password: string;

    @ApiProperty({ example: 'https://shruthi1.glitch.me', description: 'Repl link of the user' })
    readonly repl: string;

    @ApiProperty({ example: 'https://shruthiprom0101.glitch.me', description: 'Promotion Repl link of the user' })
    readonly promoteRepl: string;

    @ApiProperty({ example: '1BQANOTEuMTA4LjUg==', description: 'Session token' })
    readonly session: string;

    @ApiProperty({ example: 'ShruthiRedd2', description: 'Username of the user' })
    readonly username: string;

    @ApiProperty({ example: 'shruthi1', description: 'Client ID of the user' })
    readonly clientId: string;

    @ApiProperty({ example: 'https://shruthi1.glitch.me/exit', description: 'Deployment key URL' })
    readonly deployKey: string;

    @ApiProperty({ example: 'ShruthiRedd2', description: 'Main account of the user' })
    readonly mainAccount: string;

    @ApiProperty({ example: 'booklet_10', description: 'Product associated with the user' })
    readonly product: string;

    @ApiProperty({ example: ['916265240911'], description: 'Promote mobile number of the user', required: false, type: [String] })
    readonly promoteMobile: string[];

    @ApiProperty({ example: 'paytmqr281005050101xv6mfg02t4m9@paytm', description: 'Paytm QR ID of the user', required: false })
    readonly qrId: string;

    @ApiProperty({ example: 'myred1808@postbank', description: 'Google Pay ID of the user', required: false })
    readonly gpayId: string;
}
