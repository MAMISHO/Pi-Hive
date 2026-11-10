import { TaskStatus } from './task-status.enum.js';

export interface ITaskQueue {
  id: number;
  sender_agent_id: string;
  receiver_agent_id: string;
  payload: string;
  status: TaskStatus;
  parent_task_id: number | null;
  response?: string | null;
  created_at: Date;
  task_flow?: string | null; // 'direct' | 'delegation_result'
  depth?: number;                    // 0 = root (user input)
  depth_path?: string | null;        // '/root/bob/pam/result'
  parent_task_callback?: boolean;    // true = this is a delegation result activating callback
  callback_context?: string | null;  // accumulated instructions to continue
}
