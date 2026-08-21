import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Comprobar estado del servidor' })
  @ApiResponse({ status: 200, description: 'Servidor operativo' })
  getHello(): string {
    return this.appService.getHello();
  }
}
