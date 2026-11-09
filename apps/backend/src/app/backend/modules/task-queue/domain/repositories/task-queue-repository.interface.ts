import { ITaskQueue } from '../models/task-queue.interface.js';

export const ITaskQueueRepositoryToken = 'ITaskQueueRepository';

export interface ITaskQueueRepository {
  get(id: number): Promise<ITaskQueue | null>;
  getAll(): Promise<ITaskQueue[]>;
  add(task: ITaskQueue): Promise<ITaskQueue>;
  update(task: ITaskQueue): Promise<void>;
  findByReceiver(receiverId: string): Promise<ITaskQueue[]>;
  findByStatus(status: string): Promise<ITaskQueue[]>;
}