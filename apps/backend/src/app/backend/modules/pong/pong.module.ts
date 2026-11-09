import { Module } from '@nestjs/common';

import { PongController } from './infra/http/controllers/pong.controller.js';

@Module({
  controllers: [PongController],
})
export class PongModule {}
