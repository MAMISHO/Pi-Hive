export type ChatDirection = 'INBOUND' | 'OUTBOUND';
export type ChatKind = 'request' | 'response' | 'thinking' | 'tool_call' | 'tool_result' | 'status' | 'system_prompt' | 'plan' | 'intermediate_group';

export interface IAgentChatEvent {
  id: number;
  workspace_id: string;
  agent_id: string;
  task_id: number | null;
  parent_task_id: number | null;
  // self-reference: id of the parent request event (agent_chat_events.id).
  // - kind='request': points to the originating request event (null for root/user-origin requests)
  // - other kinds (response/thinking/tool/plan/...): point to this event's own request event id
  request_id: number | null;
  direction: ChatDirection;
  kind: ChatKind;
  content: string;
  collapsible_group_id: string | null;
  created_at: Date | string | null;
}
