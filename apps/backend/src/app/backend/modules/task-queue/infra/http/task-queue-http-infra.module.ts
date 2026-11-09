import { Module } from '@nestjs/common';

import { TaskQueuePersistenceInfrastructureModule } from '../persistence/task-queue-persistence-infra.module.js';
import { TaskQueueController } from './controllers/task-queue.controller.js';

@Module({
  imports: [TaskQueuePersistenceInfrastructureModule],
  controllers: [TaskQueueController],
  providers: [],
})
export class TaskQueueHttpInfrastructureModule {}