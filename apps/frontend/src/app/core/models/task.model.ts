export type TaskStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'HOLD' | 'STOPPED';

export interface ITaskQueue {
  id?: number;
  sender_agent_id: string;
  receiver_agent_id: string;
  payload: string;
  status: TaskStatus;
  parent_task_id?: number | null;
  response?: string | null;
  workspace_id?: string;
  created_at?: string | Date;
  task_flow?: string | null;          // 'direct' | 'delegation_result' | 'delegation_progress'
  depth?: number;
  depth_path?: string | null;
  parent_task_callback?: boolean;
  callback_context?: string | null;
  callback_final?: boolean | null;
}
