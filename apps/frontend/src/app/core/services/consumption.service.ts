import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { UsageTotals } from './token-usage.service';

const BASE_URL = 'http://localhost:8090';

export interface WorkspaceUsageAgent {
  agentId: string;
  totals: UsageTotals;
  runs: number;
  turns: number;
  lastAt: string | null;
  providers?: string[];
}

export interface WorkspaceUsageDay {
  day: string;
  totals: UsageTotals;
  runs: number;
}

export interface WorkspaceUsageRun {
  runId: string;
  agentId: string;
  workspaceId?: string | null;
  taskId?: number | null;
  provider?: string;
  modelId?: string;
  model?: string;
  turns: number;
  outcome?: string | null;
  stopReason?: string | null;
  totals: UsageTotals;
  createdAt?: string | null;
}

export interface WorkspaceUsageResponse {
  workspaceId: string;
  overall: UsageTotals;
  agents: WorkspaceUsageAgent[];
  timeline: WorkspaceUsageDay[];
  runs: WorkspaceUsageRun[];
}

@Injectable({ providedIn: 'root' })
export class ConsumptionService {
  constructor(private http: HttpClient) {}

  getWorkspaceUsage(workspaceId: string): Observable<WorkspaceUsageResponse> {
    return this.http.get<WorkspaceUsageResponse>(`${BASE_URL}/api/traces/usage/workspace/${encodeURIComponent(workspaceId)}`);
  }

  resetAgentUsage(agentId: string): Observable<{ ok: boolean; usage_reset_at?: string | null }> {
    return this.http.put<{ ok: boolean; usage_reset_at?: string | null }>(`${BASE_URL}/agents/${encodeURIComponent(agentId)}/usage/reset`, {});
  }
}
