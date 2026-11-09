import { EventEmitter } from 'events';
import {
  AfterCreate,
  AfterUpdate,
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

import { ITaskQueue } from '../../../../domain/models/task-queue.interface.js';
import { TaskStatus } from '../../../../domain/models/task-status.enum.js';

export const taskEventEmitter = new EventEmitter();

@Table({
  tableName: 'tasks_queue',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
})
export class TaskQueueEntity extends Model<ITaskQueue> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Column(DataType.STRING)
  sender_agent_id: string;

  @Column(DataType.STRING)
  receiver_agent_id: string;

  @Column(DataType.TEXT)
  payload: string;

  @Column(DataType.ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'HOLD'))
  status: TaskStatus;

  @ForeignKey(() => TaskQueueEntity)
  @Column(DataType.INTEGER)
  parent_task_id: number | null;

  @BelongsTo(() => TaskQueueEntity, 'parent_task_id')
  parentTask: TaskQueueEntity;

  @Column(DataType.TEXT)
  response: string | null;

  @Column(DataType.DATE)
  declare created_at: Date;

  @AfterCreate
  static async afterCreateHook(instance: TaskQueueEntity) {
    if (instance.status === TaskStatus.PENDING) {
      taskEventEmitter.emit('task:pending', instance.toJSON());
    }
  }

  @AfterUpdate
  static async afterUpdateHook(instance: TaskQueueEntity) {
    if (instance.status === TaskStatus.PENDING) {
      taskEventEmitter.emit('task:pending', instance.toJSON());
    }
  }
}