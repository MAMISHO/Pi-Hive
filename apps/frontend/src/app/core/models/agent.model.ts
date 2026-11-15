export type AgentRole = 'CHIEF' | 'WORKER';
export type AgentStatus = 'IDLE' | 'WORKING' | 'PAUSED' | 'HOLD' | 'ERROR';
export type ThinkingLevel = 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
export interface IAgent {
  id: string; name: string; nickname: string; role: AgentRole; status: AgentStatus;
  workspace_id?: string | null; color?: string | null; additional_instruction?: string | null; inject_context?: boolean;
  thinkingLevel?: ThinkingLevel;
  memory_enabled?: boolean | null; memoryPreference?: boolean; memoryEffective?: boolean; memoryAvailable?: boolean; memoryGlobalEnabled?: boolean; memoryConfigured?: boolean; memoryWorkspaceEnabled?: boolean;
  current_session_id?: string | null; task_state?: Record<string, unknown> | null;
  archived_at?: Date | null; created_at?: Date | null; updated_at?: Date | null;
}
