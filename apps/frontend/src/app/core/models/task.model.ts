export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'HOLD';

export interface ITaskQueue {
  id: number;
  sender_agent_id: string;
  receiver_agent_id: string;
  payload: string;
  status: TaskStatus;
  parent_task_id: number | null;
  response?: string | null;
  created_at: string;
}
