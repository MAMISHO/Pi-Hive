import { Global, Module } from '@nestjs/common';
import { PromptCatalogService } from './prompt-catalog.service.js';
import { FilePromptProvider } from './provider/file-prompt.provider.js';
import { IPromptProviderToken } from './provider/prompt-provider.interface.js';

@Global()
@Module({
  providers: [
    { provide: IPromptProviderToken, useClass: FilePromptProvider },
    PromptCatalogService,
  ],
  exports: [IPromptProviderToken, PromptCatalogService],
})
export class PromptsModule {}
