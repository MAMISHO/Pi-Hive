import { Controller, Get } from '@nestjs/common';

@Controller('pong')
export class PongController {
  @Get('ping')
  ping(): { pong: string } {
    return { pong: 'pong' };
  }
}
