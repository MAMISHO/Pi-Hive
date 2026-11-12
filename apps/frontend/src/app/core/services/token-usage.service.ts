import { Injectable, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subscription } from 'rxjs';
import { WebsocketService } from './websocket.service';
import { WorkspaceService } from './workspace.service';
import { UsageEvent } from '../models/stream.model';

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
}

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costFromProvider: false };
}

@Injectable({ providedIn: 'root' })
export class TokenUsageService implements OnDestroy {
  private runs = new Map<string, RunUsage>();
  private sub: Subscription;
  private wsSub?: Subscription;
  readonly runs$ = new BehaviorSubject<RunUsage[]>([]);
  readonly workspaceTotals$ = new BehaviorSubject<UsageTotals>(emptyTotals());

  constructor(private ws: WebsocketService, private workspace: WorkspaceService) {
    this.wsSub = this.workspace.active$.subscribe(() => this.emit());
    this.sub = this.ws.usage$.subscribe(ev => this.apply(ev));
  }

  private apply(ev: UsageEvent) {
    if (!ev || !ev.runId) return;
    const key = ev.runId;
    const prev = this.runs.get(key);
    const totals: UsageTotals = {
      input: Number(ev.totals?.input || 0),
      output: Number(ev.totals?.output || 0),
      cacheRead: Number(ev.totals?.cacheRead || 0),
      cacheWrite: Number(ev.totals?.cacheWrite || 0),
      totalTokens: Number(ev.totals?.totalTokens || 0),
      cost: {
        input: Number(ev.totals?.cost?.input || 0),
        output: Number(ev.totals?.cost?.output || 0),
        cacheRead: Number(ev.totals?.cost?.cacheRead || 0),
        cacheWrite: Number(ev.totals?.cost?.cacheWrite || 0),
        total: Number(ev.totals?.cost?.total || 0),
      },
      costFromProvider: !!ev.totals?.costFromProvider,
    };
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

  ngOnDestroy(): void { this.sub?.unsubscribe(); this.wsSub?.unsubscribe(); }
}
