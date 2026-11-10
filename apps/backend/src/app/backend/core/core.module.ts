import { Global, Module } from '@nestjs/common';
import { PromptsModule } from './infra/prompts/prompts.module.js';

@Global()
@Module({
  imports: [PromptsModule],
  exports: [PromptsModule],
})
export class CoreModule {}
