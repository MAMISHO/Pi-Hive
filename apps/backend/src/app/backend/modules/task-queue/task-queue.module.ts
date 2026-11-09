import { Module } from '@nestjs/common';

import { TaskQueueApplicationModule } from './application/task-queue-application.module.js';
import { TaskQueueInfrastructureModule } from './infra/task-queue-infra.module.js';

@Module({
  imports: [TaskQueueApplicationModule, TaskQueueInfrastructureModule],
  exports: [TaskQueueApplicationModule, TaskQueueInfrastructureModule],
})
export class TaskQueueModule {}