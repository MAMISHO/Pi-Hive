export interface IChatEvent {
  id: number;
  workspace_id: string;
  agent_id: string;
  task_id?: number | null;
  parent_task_id?: number | null;
  request_id?: string | null;
  request_parent_id?: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  kind: string;
  content: string;
  collapsible_group_id?: string | null;
  created_at: string;
}
