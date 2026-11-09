export type AgentRole = 'CHIEF' | 'WORKER';
export type AgentStatus = 'IDLE' | 'WORKING' | 'PAUSED';

export interface IAgent {
  id: string;
  name: string;
  nickname: string;
  role: AgentRole;
  status: AgentStatus;
  current_session_id: string | null;
  task_state: Record<string, unknown> | null;
  workspace_id: string;
}
