import { Inject, Injectable } from '@nestjs/common';

import { ITaskQueue } from '../../models/task-queue.interface.js';
import { ITaskQueueDAO, ITaskQueueDAOToken } from '../task-queue-dao.interface.js';
import { ITaskQueueRepository, ITaskQueueRepositoryToken } from '../task-queue-repository.interface.js';

@Injectable()
export class TaskQueueRepositoryImpl implements ITaskQueueRepository {
  constructor(@Inject(ITaskQueueDAOToken) private taskQueueDAO: ITaskQueueDAO) {}

  async get(id: number): Promise<ITaskQueue | null> {
    return this.taskQueueDAO.read(id);
  }

  async getAll(): Promise<ITaskQueue[]> {
    return this.taskQueueDAO.readAll();
  }

  async add(task: ITaskQueue): Promise<ITaskQueue> {
    return this.taskQueueDAO.create(task);
  }

  async update(task: ITaskQueue): Promise<void> {
    await this.taskQueueDAO.update(task);
  }

  async findByReceiver(receiverId: string): Promise<ITaskQueue[]> {
    return this.taskQueueDAO.readByCriteria({ receiver_agent_id: receiverId });
  }

  async findByStatus(status: string): Promise<ITaskQueue[]> {
    return this.taskQueueDAO.readByCriteria({ status });
  }
}