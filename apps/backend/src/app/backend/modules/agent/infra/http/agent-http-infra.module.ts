import { Module, forwardRef } from '@nestjs/common';

import { AgentApplicationModule } from '../../application/agent-application.module.js';
import { AgentController } from './controllers/agent.controller.js';
import { AgentRunnerModule } from '../../../agent-runner/agent-runner.module.js';
import { AgentPersistenceInfrastructureModule } from '../persistence/agent-persistence-infra.module.js';

@Module({
  imports: [AgentApplicationModule, AgentPersistenceInfrastructureModule, forwardRef(() => AgentRunnerModule)],
  controllers: [AgentController],
})
export class AgentHttpInfrastructureModule {}
