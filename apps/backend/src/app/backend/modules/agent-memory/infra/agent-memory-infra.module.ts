import { Module } from '@nestjs/common';

import { AgentMemoryPersistenceInfrastructureModule } from './persistence/agent-memory-persistence-infra.module.js';
import { AgentMemoryHttpInfrastructureModule } from './http/agent-memory-http-infra.module.js';

@Module({
  imports: [AgentMemoryPersistenceInfrastructureModule, AgentMemoryHttpInfrastructureModule],
  exports: [AgentMemoryPersistenceInfrastructureModule, AgentMemoryHttpInfrastructureModule],
})
export class AgentMemoryInfrastructureModule {}