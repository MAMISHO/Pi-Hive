import { Module, forwardRef } from '@nestjs/common';

import { AgentApplicationModule } from '../../application/agent-application.module.js';
import { AgentController } from './controllers/agent.controller.js';
import { AgentRunnerModule } from '../../../agent-runner/agent-runner.module.js';

@Module({
  imports: [AgentApplicationModule, forwardRef(() => AgentRunnerModule)],
  controllers: [AgentController],
})
export class AgentHttpInfrastructureModule {}
