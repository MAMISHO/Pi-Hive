import { Global, Module } from '@nestjs/common';
import { AppSettingsModule } from '../app-settings/app-settings.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { NexoPalaceMemoryService } from './nexo-palace-memory.service.js';

@Global()
@Module({
  imports: [AppSettingsModule, WorkspaceModule],
  providers: [NexoPalaceMemoryService],
  exports: [NexoPalaceMemoryService],
})
export class MemoryMcpModule {}
