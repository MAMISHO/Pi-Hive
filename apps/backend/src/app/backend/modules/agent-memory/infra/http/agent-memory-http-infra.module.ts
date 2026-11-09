import { Module } from '@nestjs/common';

import { AgentMemoryPersistenceInfrastructureModule } from '../persistence/agent-memory-persistence-infra.module.js';
import { AgentMemoryController } from './controllers/agent-memory.controller.js';

@Module({
  imports: [AgentMemoryPersistenceInfrastructureModule],
  controllers: [AgentMemoryController],
  providers: [],
})
export class AgentMemoryHttpInfrastructureModule {}