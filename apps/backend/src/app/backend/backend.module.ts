import { Module } from '@nestjs/common';

import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './core/infra/database/database.module.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { TaskQueueModule } from './modules/task-queue/task-queue.module.js';
import { AgentMemoryModule } from './modules/agent-memory/agent-memory.module.js';
import { AgentRunnerModule } from './modules/agent-runner/agent-runner.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';
import { PongModule } from './modules/pong/pong.module.js';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    WorkspaceModule,
    AgentModule,
    TaskQueueModule,
    AgentMemoryModule,
    AgentRunnerModule,
    PongModule,
  ],
})
export class BackendModule {}