export type AgentRole = 'CHIEF' | 'WORKER';
export type AgentStatus = 'IDLE' | 'WORKING' | 'PAUSED' | 'HOLD' | 'ERROR';
export interface IAgent {
  id: string; name: string; nickname: string; role: AgentRole; status: AgentStatus;
  workspace_id?: string | null; color?: string | null; additional_instruction?: string | null;
  current_session_id?: string | null; task_state?: Record<string, unknown> | null;
  archived_at?: Date | null; created_at?: Date | null; updated_at?: Date | null;
}
