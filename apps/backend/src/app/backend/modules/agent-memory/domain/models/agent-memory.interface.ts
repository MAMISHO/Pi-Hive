export interface IAgentMemory {
  id: number;
  agent_id: string;
  session_id: string;
  compacted_summary: string;
  created_at: Date;
}