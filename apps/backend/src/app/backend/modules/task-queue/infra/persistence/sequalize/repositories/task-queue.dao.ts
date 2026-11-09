import { Injectable } from '@nestjs/common';

import { GenericSequalizeDAO } from '../../../../../../core/infra/database/sequalize/dao/impl/generic-sequalize.dao.js';
import { TaskQueueEntity } from '../entities/task-queue.schema.js';
import { ITaskQueue } from '../../../../domain/models/task-queue.interface.js';

@Injectable()
export class TaskQueueDAO extends GenericSequalizeDAO<TaskQueueEntity> {
  constructor() {
    super(TaskQueueEntity);
  }

  async create(task: ITaskQueue): Promise<ITaskQueue> {
    const entity = await super.create(task as any);
    return entity.toJSON() as ITaskQueue;
  }

  async read(id: number): Promise<ITaskQueue | null> {
    const entity = await super.read(id);
    return entity ? (entity.toJSON() as ITaskQueue) : null;
  }

  async readAll(): Promise<ITaskQueue[]> {
    const entities = await super.readAll();
    return entities.map((e) => e.toJSON() as ITaskQueue);
  }

  async update(task: ITaskQueue): Promise<void> {
    await super.update(task as any);
  }

  async readByCriteria<K>(filter: Partial<K>): Promise<ITaskQueue[]> {
    const entities = await super.readByCriteria(filter);
    return entities.map((e) => e.toJSON() as ITaskQueue);
  }
}