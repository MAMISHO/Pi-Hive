import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Subscription } from 'rxjs';
import { WebsocketService } from './websocket.service';
import { WorkspaceService } from './workspace.service';
import { UsageEvent } from '../models/stream.model';

const BASE_URL = 'http://localhost:8090';

export interface UsageTotals {
  input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  costFromProvider: boolean;
}

export interface RunUsage {
  runId: string;
  agentId: string;
  workspaceId?: string | null;
  taskId?: number | null;
  provider?: string; modelId?: string; model?: string;
  turns: number;
  totals: UsageTotals;
  lastTurn?: UsageEvent['usage'];
  startedAt?: number;
  updatedAt: number;
  source?: 'live' | 'history';
}

export function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costFromProvider: false };
}

function cloneTotals(t?: Partial<UsageTotals> | null): UsageTotals {
  const c: any = (t as any)?.cost || {};
  return {
    input: Number(t?.input || 0), output: Number(t?.output || 0), cacheRead: Number(t?.cacheRead || 0), cacheWrite: Number(t?.cacheWrite || 0), totalTokens: Number(t?.totalTokens || 0),
    cost: { input: Number(c.input || 0), output: Number(c.output || 0), cacheRead: Number(c.cacheRead || 0), cacheWrite: Number(c.cacheWrite || 0), total: Number(c.total || 0) },
    costFromProvider: !!(t as any)?.costFromProvider,
  };
}

@Injectable({ providedIn: 'root' })
export class TokenUsageService implements OnDestroy {
  private runs = new Map<string, RunUsage>();
  private resetAtByAgent = new Map<string, number>();
  private sub: Subscription;
  private wsSub?: Subscription;
  private resetSub?: Subscription;
  private reconnectSub?: Subscription;
  private loadedWorkspaceId: string | null = null;
  readonly runs$ = new BehaviorSubject<RunUsage[]>([]);
  readonly workspaceTotals$ = new BehaviorSubject<UsageTotals>(emptyTotals());

  constructor(private ws: WebsocketService, private workspace: WorkspaceService, private http: HttpClient) {
    this.wsSub = this.workspace.active$.subscribe(ws => { this.loadWorkspace(ws?.id || null); });
    this.sub = this.ws.usage$.subscribe(ev => this.apply(ev));
    this.resetSub = (this.ws as any).usageReset$?.subscribe((ev: any) => this.onUsageReset(ev));
    this.reconnectSub = this.ws.rehydrate$.subscribe(() => { const id = this.workspace.active?.id || null; this.loadWorkspace(id, true); });
  }

  private onUsageReset(ev: any) {
    const agentId = ev?.agentId;
    if (!agentId) return;
    const ts = ev?.usage_reset_at ? new Date(ev.usage_reset_at).getTime() : Date.now();
    this.resetAtByAgent.set(agentId, ts);
    for (const [k, r] of Array.from(this.runs.entries())) {
      if (r.agentId === agentId) this.runs.delete(k);
    }
    this.emit();
  }

  clearAgent(agentId: string): void {
    this.resetAtByAgent.set(agentId, Date.now());
    for (const [k, r] of Array.from(this.runs.entries())) { if (r.agentId === agentId) this.runs.delete(k); }
    this.emit();
  }

  private loadWorkspace(workspaceId: string | null, force = false): void {
    if (!force && this.loadedWorkspaceId === workspaceId) { this.emit(); return; }
    this.loadedWorkspaceId = workspaceId;
    this.runs.clear();
    this.resetAtByAgent.clear();
    if (!workspaceId) { this.emit(); return; }
    this.http.get<any[]>(`${BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/agents`).subscribe({
      next: (agents) => {
        (agents || []).forEach((a: any) => { if (a?.id && a?.usage_reset_at) { const ts = new Date(a.usage_reset_at).getTime(); if (!isNaN(ts)) this.resetAtByAgent.set(a.id, ts); } });
        this.fetchHistory(workspaceId);
      },
      error: () => this.fetchHistory(workspaceId)
    });
  }

  private fetchHistory(workspaceId: string): void {
    this.http.get<any>(`${BASE_URL}/api/traces/usage/workspace/${encodeURIComponent(workspaceId)}`).subscribe({
      next: (res) => {
        const runs = (res?.runs || []) as any[];
        for (const r of runs) {
          const agentId = String(r.agentId || '');
          const ts = r.createdAt ? new Date(r.createdAt).getTime() : Date.now();
          const resetAt = this.resetAtByAgent.get(agentId);
          if (resetAt && ts < resetAt) continue;
          const key = String(r.runId || `hist-${agentId}-${ts}-${Math.random()}`);
          const totals = cloneTotals(r.totals || {});
          this.runs.set(key, {
            runId: key,
            agentId,
            workspaceId: r.workspaceId ?? workspaceId,
            taskId: r.taskId ?? null,
            provider: r.provider,
            modelId: r.modelId,
            model: r.model,
            turns: Number(r.turns || 0),
            totals,
            startedAt: ts,
            updatedAt: ts,
            source: 'history',
          });
        }
        this.emit();
      },
      error: () => this.emit()
    });
  }

  private apply(ev: UsageEvent) {
    if (!ev || !ev.runId) return;
    const key = ev.runId;
    const prev = this.runs.get(key);
    const totals: UsageTotals = cloneTotals(ev.totals as any);
    const run: RunUsage = {
      runId: key,
      agentId: ev.agentId,
      workspaceId: ev.workspaceId ?? prev?.workspaceId ?? null,
      taskId: ev.taskId ?? prev?.taskId ?? null,
      provider: ev.provider || prev?.provider,
      modelId: ev.modelId || prev?.modelId,
      model: ev.model || prev?.model,
      turns: ev.turn || prev?.turns || 0,
      totals,
      lastTurn: ev.usage,
      startedAt: prev?.startedAt || ev.emittedAt || Date.now(),
      updatedAt: ev.emittedAt || Date.now(),
      source: 'live',
    };
    this.runs.set(key, run);
    this.emit();
  }

  private emit() {
    const ws = this.workspace.active?.id;
    const list = Array.from(this.runs.values())
      .filter(r => !ws || r.workspaceId === ws)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    this.runs$.next(list);
    const agg = emptyTotals();
    for (const r of list) {
      agg.input += r.totals.input; agg.output += r.totals.output; agg.cacheRead += r.totals.cacheRead; agg.cacheWrite += r.totals.cacheWrite; agg.totalTokens += r.totals.totalTokens;
      agg.cost.input += r.totals.cost.input; agg.cost.output += r.totals.cost.output; agg.cost.cacheRead += r.totals.cost.cacheRead; agg.cost.cacheWrite += r.totals.cost.cacheWrite; agg.cost.total += r.totals.cost.total;
      if (r.totals.costFromProvider) agg.costFromProvider = true;
    }
    this.workspaceTotals$.next(agg);
  }

  ngOnDestroy(): void { this.sub?.unsubscribe(); this.wsSub?.unsubscribe(); this.resetSub?.unsubscribe(); this.reconnectSub?.unsubscribe(); }
}
