import { ITaskQueue } from '../models/task-queue.interface.js';

export const ITaskQueueDAOToken = 'ITaskQueueDAO';

export interface ITaskQueueDAO {
  create(task: ITaskQueue): Promise<ITaskQueue>;
  read(id: number): Promise<ITaskQueue | null>;
  readAll(): Promise<ITaskQueue[]>;
  update(task: ITaskQueue): Promise<void>;
  readByCriteria<K>(filter: Partial<K>): Promise<ITaskQueue[]>;
}