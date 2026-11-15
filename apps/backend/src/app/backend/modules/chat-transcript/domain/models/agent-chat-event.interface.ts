export type ChatDirection = 'INBOUND' | 'OUTBOUND';
export type ChatKind = 'request' | 'response' | 'thinking' | 'tool_call' | 'tool_result' | 'status' | 'system_prompt' | 'plan' | 'intermediate_group';

export interface IAgentChatEvent {
  id: number;
  workspace_id: string;
  agent_id: string;
  task_id: number | null;
  parent_task_id: number | null;
  request_id: string | null;
  request_parent_id: string | null;
  direction: ChatDirection;
  kind: ChatKind;
  content: string;
  collapsible_group_id: string | null;
  created_at: Date | string | null;
}
