export interface StreamTextEvent {
  agentId: string; workspaceId?: string | null; taskId?: number | null; runId?: string | null; seq?: number;
  delta: string; kind?: 'thinking' | 'text'; emittedAt?: number;
}

export interface StreamToolEvent {
  agentId: string; workspaceId?: string | null; taskId?: number | null; runId?: string | null; seq?: number;
  toolName?: string; toolCallId?: string; args?: any; resultSummary?: string; phase?: 'call'|'start'|'end'|'error'; emittedAt?: number;
}

export interface StatusChangeEvent {
  agentId: string; workspaceId?: string | null; taskId?: number | null; runId?: string | null;
  status: 'IDLE' | 'WORKING' | 'PAUSED'; reason?: string; emittedAt?: number;
}

export interface QueueItem { taskId: number; sender_agent_id?: string; sender_nickname?: string; preview?: string; task_flow?: string; callback_final?: boolean | null; created_at?: string | Date; parent_task_id?: number | null; }
export interface QueueUpdatedEvent { agentId: string; workspaceId?: string | null; currentTaskId?: number | null; pendingCount: number; pendingTaskIds?: number[]; items?: QueueItem[]; emittedAt?: number; }
export interface RunEvent { agentId: string; workspaceId?: string | null; taskId?: number | null; runId?: string | null; [k: string]: any; }
export interface TaskChangedEvent { taskId: number; workspaceId?: string | null; agentId?: string | null; previousStatus?: string | null; status: string; task?: any; reason?: string; emittedAt?: number; }

export interface UsageEvent {
  agentId: string; workspaceId?: string | null; taskId?: number | null; runId?: string | null;
  provider?: string; modelId?: string; model?: string;
  turn?: number;
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; reasoning?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number; totalFromProvider?: boolean } };
  totals?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; totalTokens?: number; cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number }; costFromProvider?: boolean };
  emittedAt?: number;
}

