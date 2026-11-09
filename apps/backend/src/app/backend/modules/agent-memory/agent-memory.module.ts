import { Module } from '@nestjs/common';

import { AgentMemoryApplicationModule } from './application/agent-memory-application.module.js';
import { AgentMemoryInfrastructureModule } from './infra/agent-memory-infra.module.js';

@Module({
  imports: [AgentMemoryApplicationModule, AgentMemoryInfrastructureModule],
  exports: [AgentMemoryApplicationModule, AgentMemoryInfrastructureModule],
})
export class AgentMemoryModule {}