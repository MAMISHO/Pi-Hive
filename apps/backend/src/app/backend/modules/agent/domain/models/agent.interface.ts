import { AgentRole } from './agent-role.enum.js';
import { AgentStatus } from './agent-status.enum.js';

export interface IAgent {
  id: string;
  name: string;
  nickname: string;
  role: AgentRole;
  status: AgentStatus;
  current_session_id: string | null;
  task_state: Record<string, unknown> | null;
  workspace_id: string | null;
  additional_instruction: string | null;
  color: string | null;
  inject_context: boolean;
  thinkingLevel?: 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
  memory_enabled?: boolean | null;
  archived_at?: Date | string | null;
  usage_reset_at?: Date | string | null;
}
