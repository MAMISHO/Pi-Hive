import { Module } from '@nestjs/common';

import { TaskQueueDAO } from './sequalize/repositories/task-queue.dao.js';
import { TaskQueueRepositoryImpl } from '../../domain/repositories/impl/task-queue.repository.js';
import { ITaskQueueDAOToken } from '../../domain/repositories/task-queue-dao.interface.js';
import { ITaskQueueRepositoryToken } from '../../domain/repositories/task-queue-repository.interface.js';

@Module({
  providers: [
    TaskQueueDAO,
    { provide: ITaskQueueDAOToken, useExisting: TaskQueueDAO },
    TaskQueueRepositoryImpl,
    { provide: ITaskQueueRepositoryToken, useExisting: TaskQueueRepositoryImpl },
  ],
  exports: [ITaskQueueRepositoryToken, ITaskQueueDAOToken],
})
export class TaskQueuePersistenceInfrastructureModule {}