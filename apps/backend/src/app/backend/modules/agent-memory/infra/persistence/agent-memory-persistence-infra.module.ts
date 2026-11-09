import { Module } from '@nestjs/common';

import { AgentMemoryDAO } from './sequalize/repositories/agent-memory.dao.js';
import { AgentMemoryRepositoryImpl } from '../../domain/repositories/impl/agent-memory.repository.js';
import { IAgentMemoryDAOToken } from '../../domain/repositories/agent-memory-dao.interface.js';
import { IAgentMemoryRepositoryToken } from '../../domain/repositories/agent-memory-repository.interface.js';

@Module({
  providers: [
    AgentMemoryDAO,
    { provide: IAgentMemoryDAOToken, useExisting: AgentMemoryDAO },
    AgentMemoryRepositoryImpl,
    { provide: IAgentMemoryRepositoryToken, useExisting: AgentMemoryRepositoryImpl },
  ],
  exports: [IAgentMemoryRepositoryToken, IAgentMemoryDAOToken],
})
export class AgentMemoryPersistenceInfrastructureModule {}