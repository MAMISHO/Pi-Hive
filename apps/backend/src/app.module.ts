import { Module } from '@nestjs/common';

import { BackendModule } from './app/backend/backend.module.js';

@Module({
  imports: [BackendModule],
})
export class AppModule {}