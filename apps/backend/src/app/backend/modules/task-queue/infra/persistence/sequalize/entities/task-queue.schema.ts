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
const _lastPendingEmit = new Map<string, number>();

function dedupPending(id: any, status: any): boolean {
  if (status !== TaskStatus.PENDING && status !== 'PENDING') return true;
  const key = `${id}`;
  const now = Date.now();
  const prev = _lastPendingEmit.get(key) || 0;
  if (now - prev < 1500) return false; // dedup duplicate hook/controller emissions
  _lastPendingEmit.set(key, now);
  return true;
}

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

  @Column(DataType.STRING)
  status: TaskStatus;

  @ForeignKey(() => TaskQueueEntity)
  @Column(DataType.INTEGER)
  parent_task_id: number | null;

  @BelongsTo(() => TaskQueueEntity, 'parent_task_id')
  parentTask: TaskQueueEntity;

  @Column(DataType.TEXT)
  response: string | null;

  @Column({ type: DataType.STRING, allowNull: true })
  workspace_id: string | null;

  @Column({ type: DataType.STRING, allowNull: true, defaultValue: 'direct' })
  declare task_flow: string | null;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare depth: number;

  @Column({ type: DataType.STRING, allowNull: true })
  declare depth_path: string | null;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  declare parent_task_callback: boolean;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare callback_context: string | null;

  @Column({ type: DataType.BOOLEAN, allowNull: true, defaultValue: null })
  declare callback_final: boolean | null;

  @Column({ type: DataType.INTEGER, allowNull: true })
  declare plan_ref: number | null;

  @Column(DataType.DATE)
  declare created_at: Date;

  @AfterCreate
  static async afterCreateHook(instance: TaskQueueEntity) {
    const json = instance.toJSON() as any;
    if (json.status === TaskStatus.PENDING && dedupPending(json.id, json.status)) {
      taskEventEmitter.emit('task:pending', json);
    }
    taskEventEmitter.emit('task:updated', json);
    taskEventEmitter.emit('task:changed', { taskId: json.id, workspaceId: json.workspace_id, agentId: json.receiver_agent_id, previousStatus: null, status: json.status, task: json, reason: 'created', emittedAt: Date.now() });
  }

  @AfterUpdate
  static async afterUpdateHook(instance: TaskQueueEntity) {
    const json = instance.toJSON() as any;
    const prev = (instance.previous('status') as any) ?? null;
    if (json.status === TaskStatus.PENDING && prev !== 'PENDING' && prev !== TaskStatus.PENDING && dedupPending(json.id, json.status)) {
      taskEventEmitter.emit('task:pending', json);
    }
    taskEventEmitter.emit('task:updated', json);
    taskEventEmitter.emit('task:changed', { taskId: json.id, workspaceId: json.workspace_id, agentId: json.receiver_agent_id, previousStatus: prev, status: json.status, task: json, reason: 'status', emittedAt: Date.now() });
  }
}