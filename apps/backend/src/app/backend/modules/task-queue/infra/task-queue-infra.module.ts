import { Module } from '@nestjs/common';

import { TaskQueuePersistenceInfrastructureModule } from './persistence/task-queue-persistence-infra.module.js';
import { TaskQueueHttpInfrastructureModule } from './http/task-queue-http-infra.module.js';

@Module({
  imports: [TaskQueuePersistenceInfrastructureModule, TaskQueueHttpInfrastructureModule],
  exports: [TaskQueuePersistenceInfrastructureModule, TaskQueueHttpInfrastructureModule],
})
export class TaskQueueInfrastructureModule {}