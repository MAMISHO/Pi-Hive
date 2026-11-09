export type SessionHistoryEventType =
  | 'COMPACTION_SUMMARY'
  | 'SESSION_CLEARED'
  | 'WORKSPACE_RESET'
  | 'TASK_SUMMARY';

export interface IAgentSessionHistory {
  id: number;
  workspace_id: string;
  agent_id: string;
  session_id: string | null;
  event_type: SessionHistoryEventType;
  summary: string;
  details: Record<string, unknown> | null;
  created_at: Date | string | null;
}
