export interface IChatEvent {
  id: number;
  workspace_id: string;
  agent_id: string;
  task_id?: number | null;
  parent_task_id?: number | null;
  // self-ref: parent request event id (agent_chat_events.id). null for root requests or unscoped events.
  request_id?: number | null;
  direction: 'INBOUND' | 'OUTBOUND';
  kind: string;
  content: string;
  collapsible_group_id?: string | null;
  created_at: string;
}
