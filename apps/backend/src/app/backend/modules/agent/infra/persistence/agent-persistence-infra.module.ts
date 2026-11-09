import { Module } from '@nestjs/common';

import { AgentDAO } from './sequalize/repositories/agent.dao.js';
import { AgentRepositoryImpl } from '../../domain/repositories/impl/agent.repository.js';
import { IAgentDAOToken } from '../../domain/repositories/agent-dao.interface.js';
import { IAgentRepositoryToken } from '../../domain/repositories/agent-repository.interface.js';

@Module({
  providers: [
    AgentDAO,
    { provide: IAgentDAOToken, useExisting: AgentDAO },
    AgentRepositoryImpl,
    { provide: IAgentRepositoryToken, useExisting: AgentRepositoryImpl },
  ],
  exports: [IAgentRepositoryToken, IAgentDAOToken],
})
export class AgentPersistenceInfrastructureModule {}