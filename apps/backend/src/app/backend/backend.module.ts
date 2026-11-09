import { Module } from '@nestjs/common';

import { CoreModule } from './core/core.module.js';
import { DatabaseModule } from './core/infra/database/database.module.js';
import { AgentModule } from './modules/agent/agent.module.js';
import { TaskQueueModule } from './modules/task-queue/task-queue.module.js';
import { AgentMemoryModule } from './modules/agent-memory/agent-memory.module.js';
import { AgentRunnerModule } from './modules/agent-runner/agent-runner.module.js';

@Module({
  imports: [
    CoreModule,
    DatabaseModule,
    AgentModule,
    TaskQueueModule,
    AgentMemoryModule,
    AgentRunnerModule,
  ],
})
export class BackendModule {}