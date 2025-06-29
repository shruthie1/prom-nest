import { Controller, Get, Post, Delete, Param, Body, Logger } from '@nestjs/common';
import { PromotionService } from './promotion.service';

@Controller('promotion')
export class PromotionController {
  private readonly logger = new Logger(PromotionController.name);

  constructor(private readonly promotionService: PromotionService) {}

  @Get('status')
  async getPromotionStatus() {
    this.logger.log('Getting promotion status');
    return await this.promotionService.getPromotionStatus();
  }

  @Get('health')
  async getSystemHealth() {
    this.logger.log('Getting system health');
    return await this.promotionService.getSystemHealth();
  }

  @Get('mobile/:mobile/stats')
  async getMobileStats(@Param('mobile') mobile: string) {
    this.logger.log(`Getting stats for mobile: ${mobile}`);
    return await this.promotionService.getMobileStats(mobile);
  }

  @Post('start')
  async startPromotion() {
    this.logger.log('Starting promotion system');
    await this.promotionService.startPromotion();
    return { message: 'Promotion system started successfully' };
  }

  @Post('stop')
  async stopPromotion() {
    this.logger.log('Stopping promotion system');
    this.promotionService.stopPromotion();
    return { message: 'Promotion system stopped successfully' };
  }

  @Post('restart')
  async restartPromotion() {
    this.logger.log('Restarting promotion system');
    await this.promotionService.restartPromotion();
    return { message: 'Promotion system restarted successfully' };
  }

  @Post('sync')
  async syncWithConnectionManager() {
    this.logger.log('Syncing with connection manager');
    await this.promotionService.handleRotation();
    return { message: 'Sync with connection manager completed' };
  }

  @Post('mobile/:mobile/reset')
  async resetMobilePromotion(@Param('mobile') mobile: string) {
    this.logger.log(`Resetting promotion for mobile: ${mobile}`);
    await this.promotionService.resetMobilePromotion(mobile);
    return { message: `Promotion reset for mobile: ${mobile}` };
  }

  @Post('save')
  async saveResults(@Body() body?: { mobile?: string }) {
    const mobile = body?.mobile;
    this.logger.log(`Saving results${mobile ? ` for mobile: ${mobile}` : ' for all mobiles'}`);
    await this.promotionService.saveResults(mobile);
    return { message: `Results saved${mobile ? ` for mobile: ${mobile}` : ' for all mobiles'}` };
  }

  @Post('load')
  async loadResults(@Body() body?: { mobile?: string }) {
    const mobile = body?.mobile;
    this.logger.log(`Loading results${mobile ? ` for mobile: ${mobile}` : ' for all mobiles'}`);
    await this.promotionService.loadResults(mobile);
    return { message: `Results loaded${mobile ? ` for mobile: ${mobile}` : ' for all mobiles'}` };
  }

  @Post('mobile/:mobile/add')
  async addNewClient(@Param('mobile') mobile: string) {
    this.logger.log(`Adding new client for mobile: ${mobile}`);
    await this.promotionService.addNewClient(mobile);
    return { message: `Client added for mobile: ${mobile}` };
  }

  @Delete('mobile/:mobile')
  async removeClient(@Param('mobile') mobile: string) {
    this.logger.log(`Removing client for mobile: ${mobile}`);
    await this.promotionService.removeClient(mobile);
    return { message: `Client removed for mobile: ${mobile}` };
  }
}
