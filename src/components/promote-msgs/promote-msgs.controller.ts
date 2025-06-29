import { Controller, Get, Body, Param, Patch } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { PromoteMsgsService } from './promote-msgs.service';

@ApiTags('Promote-msgs')
@Controller('promote-msgs')
export class PromoteMsgsController {
  constructor(private readonly promoteMsgsService: PromoteMsgsService) {}

  @Get()
  @ApiOperation({ summary: 'Get promote-msgs data' })
  async findOne(): Promise<any>{
    return this.promoteMsgsService.findOne();
  }

  @Patch()
  @ApiOperation({ summary: 'Update promote-msgs' })
  @ApiBody({type: Object})
  async update( @Body() updateClientDto: any): Promise<any> {
    return this.promoteMsgsService.update( updateClientDto);
  }

}
