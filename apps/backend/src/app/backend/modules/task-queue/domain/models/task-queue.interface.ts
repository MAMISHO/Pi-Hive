import { TaskStatus } from './task-status.enum.js';

export interface ITaskQueue {
  id: number;
  sender_agent_id: string;
  receiver_agent_id: string;
  payload: string;
  status: TaskStatus;
  parent_task_id: number | null;
  created_at: Date;
}