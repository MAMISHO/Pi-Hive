import { Global, Module } from '@nestjs/common';

import { databaseProviders } from './database.provider.js';

@Global()
@Module({
  providers: [...databaseProviders],
  exports: [...databaseProviders],
})
export class DatabaseModule {}