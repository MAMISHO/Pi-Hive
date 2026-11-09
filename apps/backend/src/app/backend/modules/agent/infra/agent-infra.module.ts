import { Module } from '@nestjs/common';

import { AgentPersistenceInfrastructureModule } from './persistence/agent-persistence-infra.module.js';
import { AgentHttpInfrastructureModule } from './http/agent-http-infra.module.js';

@Module({
  imports: [AgentPersistenceInfrastructureModule, AgentHttpInfrastructureModule],
  exports: [AgentPersistenceInfrastructureModule, AgentHttpInfrastructureModule],
})
export class AgentInfrastructureModule {}