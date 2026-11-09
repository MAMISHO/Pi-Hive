import { Module } from '@nestjs/common';

import { AgentApplicationModule } from './application/agent-application.module.js';
import { AgentInfrastructureModule } from './infra/agent-infra.module.js';

@Module({
  imports: [AgentApplicationModule, AgentInfrastructureModule],
  exports: [AgentApplicationModule, AgentInfrastructureModule],
})
export class AgentModule {}