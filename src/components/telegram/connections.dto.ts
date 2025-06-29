import { ApiProperty } from '@nestjs/swagger';



export class ConnectionStatusDto {
    @ApiProperty({ description: 'Connection state of the client', enum: ['connecting', 'connected', 'disconnecting', 'disconnected', 'error'] })
    state: string;

    @ApiProperty({ description: 'Whether auto disconnect is enabled' })
    autoDisconnect: boolean;

    @ApiProperty({ description: 'When the connection was last used', type: 'number' })
    lastUsed: number;

    @ApiProperty({ description: 'Number of connection attempts', type: 'number' })
    connectionAttempts: number;

    @ApiProperty({ description: 'Last error message if any', required: false })
    lastError?: string;
}

export class GetClientOptionsDto {
    @ApiProperty({ description: 'Whether to auto disconnect the client after period of inactivity', required: false, default: true })
    autoDisconnect?: boolean;

    @ApiProperty({ description: 'Whether to use event handler', required: false, default: true })
    handler?: boolean;

    @ApiProperty({ description: 'Connection timeout in milliseconds', required: false, default: 30000 })
    timeout?: number;
}
