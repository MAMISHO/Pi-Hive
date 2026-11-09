import { Module } from '@nestjs/common';

import { AgentPersistenceInfrastructureModule } from '../persistence/agent-persistence-infra.module.js';
import { AgentController } from './controllers/agent.controller.js';

@Module({
  imports: [AgentPersistenceInfrastructureModule],
  controllers: [AgentController],
  providers: [],
})
export class AgentHttpInfrastructureModule {}