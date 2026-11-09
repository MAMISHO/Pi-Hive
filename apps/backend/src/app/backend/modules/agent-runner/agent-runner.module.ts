import { Module, forwardRef } from '@nestjs/common';

import { AgentModule } from '../agent/agent.module.js';
import { TaskQueueModule } from '../task-queue/task-queue.module.js';
import { AgentMemoryModule } from '../agent-memory/agent-memory.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';

import { AgentRunnerService } from './agent-runner.service.js';
import { AgentGateway } from './agent.gateway.js';
import { IdentityResolverService } from './identity-resolver.service.js';
import { PromptBuilderService } from './prompt-builder.service.js';

@Module({
  imports: [forwardRef(() => AgentModule), TaskQueueModule, AgentMemoryModule, WorkspaceModule],
  providers: [AgentRunnerService, AgentGateway, IdentityResolverService, PromptBuilderService],
  exports: [AgentRunnerService, AgentGateway, IdentityResolverService, PromptBuilderService],
})
export class AgentRunnerModule {}
