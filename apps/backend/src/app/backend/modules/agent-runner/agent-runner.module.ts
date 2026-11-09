import { Module, forwardRef } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { TaskQueueModule } from '../task-queue/task-queue.module.js';
import { AgentMemoryModule } from '../agent-memory/agent-memory.module.js';

import { AgentRunnerService } from './agent-runner.service.js';
import { AgentGateway } from './agent.gateway.js';
import { IdentityResolverService } from './identity-resolver.service.js';

@Module({
  imports: [forwardRef(() => AgentModule), TaskQueueModule, AgentMemoryModule],
  providers: [AgentRunnerService, AgentGateway, IdentityResolverService],
  exports: [AgentRunnerService, AgentGateway, IdentityResolverService],
})
export class AgentRunnerModule {}