import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { WorkspaceService, IWorkspace } from '../../core/services/workspace.service';
import { AgentService } from '../../core/services/agent.service';
import { ConsumptionService, WorkspaceUsageAgent, WorkspaceUsageDay, WorkspaceUsageRun } from '../../core/services/consumption.service';
import { TokenUsageService, RunUsage, UsageTotals } from '../../core/services/token-usage.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { UiFeedbackService } from '../../core/services/ui-feedback.service';
import { IAgent } from '../../core/models/agent.model';

function emptyTotals(): UsageTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costFromProvider: false };
}
function addTotals(dst: UsageTotals, src?: Partial<UsageTotals> | null) {
  if (!src) return;
  dst.input += Number(src.input || 0); dst.output += Number(src.output || 0); dst.cacheRead += Number(src.cacheRead || 0); dst.cacheWrite += Number(src.cacheWrite || 0); dst.totalTokens += Number(src.totalTokens || 0);
  const c: any = (src as any).cost || {};
  dst.cost.input += Number(c.input || 0); dst.cost.output += Number(c.output || 0); dst.cost.cacheRead += Number(c.cacheRead || 0); dst.cost.cacheWrite += Number(c.cacheWrite || 0); dst.cost.total += Number(c.total || 0);
  if ((src as any).costFromProvider) dst.costFromProvider = true;
}
function cloneTotals(t?: UsageTotals | null): UsageTotals { const out = emptyTotals(); addTotals(out, t || emptyTotals()); return out; }

interface AgentUsageRow {
  agentId: string; agent: IAgent | null; nickname: string; color: string;
  statusLabel: string; statusKind: 'active' | 'inactive' | 'archived' | 'deleted'; statusSeverity: 'success' | 'secondary' | 'warn' | 'danger' | 'contrast';
  role?: string | null; sessionTotals: UsageTotals; workspaceTotals: UsageTotals; sessionRuns: number; workspaceRuns: number; lastAt: string | null; usageResetAt?: string | null;
}

@Component({
  selector: 'app-consumption',
  standalone: true,
  imports: [CommonModule, ButtonModule, TagModule],
  template: `
    <div class="consumption-page" *ngIf="ws as workspace; else noWs">
      <div class="page-header">
        <div>
          <div class="eyebrow">Workspace</div>
          <h2>Consumo</h2>
          <p class="sub">Tokens y coste acumulados del workspace, con vista de sesión actual por agente. El reseteo de sesión (en vivo o por agente) solo afecta la sesión visible; el reseteo del total elimina el histórico acumulado del workspace.</p>
        </div>
        <div class="header-actions">
          <button pButton type="button" icon="pi pi-refresh" label="Actualizar" class="p-button-text p-button-sm" (click)="reload(true)"></button>
        </div>
      </div>

      <section class="summary-grid">
        <article class="card hero">
          <div class="card-top">
            <div class="kicker">Total workspace</div>
            <button pButton type="button" icon="pi pi-replay" label="Resetear todo" class="p-button-text p-button-sm p-button-danger" (click)="resetAll()" [disabled]="!ws || !agentRows.length" title="Resetear el consumo visible de sesión de todos los agentes del workspace (no afecta al total/histórico acumulado)"></button>
          </div>
          <div class="big">{{ fmtNum(wsTotals.totalTokens) }} <span>tok</span></div>
          <div class="muted">{{ fmtCost(wsTotals.cost.total) }} · {{ wsTotals.costFromProvider ? 'coste reportado' : 'coste estimado' }}</div>
          <div class="meta-line"><span>{{ workspaceRuns.length }} ejecuciones</span><span>{{ agentRows.length }} agentes (histórico)</span></div>
        </article>
        <article class="card">
          <div class="card-top">
            <div class="kicker">Sesión en vivo (workspace)</div>
            <button pButton type="button" icon="pi pi-replay" label="Resetear sesión" class="p-button-text p-button-sm" (click)="resetLiveSession()" [disabled]="!ws" title="Resetear el consumo visible de la sesión en curso (agentes y vista en vivo; no afecta al total/histórico acumulado)"></button>
          </div>
          <div class="big sm">{{ fmtNum(liveTotals.totalTokens) }} <span>tok</span></div>
          <div class="muted">{{ fmtCost(liveTotals.cost.total) }} · tiempo real</div>
          <div class="meta-line"><span>{{ liveRuns.length }} ejecuciones activas</span></div>
        </article>
        <article class="card">
          <div class="kicker">Distribución por estado</div>
          <div class="status-bars">
            <div class="bar-row"><span>Activos</span><b>{{ counts.active }}</b></div><div class="bar-track"><i class="active" [style.width.%]="pct(counts.active)"></i></div>
            <div class="bar-row"><span>Inactivos</span><b>{{ counts.inactive }}</b></div><div class="bar-track"><i class="inactive" [style.width.%]="pct(counts.inactive)"></i></div>
            <div class="bar-row"><span>Archivados</span><b>{{ counts.archived }}</b></div><div class="bar-track"><i class="archived" [style.width.%]="pct(counts.archived)"></i></div>
            <div class="bar-row"><span>Eliminados</span><b>{{ counts.deleted }}</b></div><div class="bar-track"><i class="deleted" [style.width.%]="pct(counts.deleted)"></i></div>
          </div>
        </article>
        <article class="card breakdown">
          <div class="kicker">Desglose workspace</div>
          <div class="kv"><span>Entrada</span><b>{{ fmtNum(wsTotals.input) }}</b></div>
          <div class="kv"><span>Salida</span><b>{{ fmtNum(wsTotals.output) }}</b></div>
          <div class="kv"><span>Cache read</span><b>{{ fmtNum(wsTotals.cacheRead) }}</b></div>
          <div class="kv"><span>Cache write</span><b>{{ fmtNum(wsTotals.cacheWrite) }}</b></div>
          <div class="kv cost"><span>Coste in/out/cache</span><b>{{ fmtCost(wsTotals.cost.input) }} / {{ fmtCost(wsTotals.cost.output) }} / {{ fmtCost(wsTotals.cost.cacheRead + wsTotals.cost.cacheWrite) }}</b></div>
        </article>
      </section>

      <section class="grid two">
        <article class="card chart-card">
          <div class="card-head"><h3>Consumo en el tiempo</h3><span class="muted">tokens por día (workspace)</span></div>
          <div class="chart" *ngIf="timeline.length; else noTimeline">
            <div class="chart-row" *ngFor="let d of timeline">
              <div class="day">{{ d.day }}</div>
              <div class="bars"><div class="stack" [title]="fmtNum(d.totals.totalTokens) + ' tok · ' + fmtCost(d.totals.cost.total)">
                <i class="in" [style.width.%]="barPct(d.totals.input, timelineMax)"></i><i class="out" [style.width.%]="barPct(d.totals.output, timelineMax)"></i><i class="cache" [style.width.%]="barPct(d.totals.cacheRead + d.totals.cacheWrite, timelineMax)"></i>
              </div></div>
              <div class="val">{{ fmtNum(d.totals.totalTokens) }}</div>
            </div>
            <div class="legend"><span><i class="dot in"></i>Entrada</span><span><i class="dot out"></i>Salida</span><span><i class="dot cache"></i>Cache</span></div>
          </div>
          <ng-template #noTimeline><div class="empty">Sin histórico de consumo todavía.</div></ng-template>
        </article>

        <article class="card chart-card">
          <div class="card-head"><h3>Consumo por agente</h3><span class="muted">tokens totales acumulados</span></div>
          <div class="agent-bars" *ngIf="agentRows.length; else noAgents">
            <div class="agent-bar" *ngFor="let r of topAgentRows">
              <div class="ab-top"><span class="dot" [style.background]="r.color"></span><span class="name">{{ r.nickname }}</span><p-tag [value]="r.statusLabel" [severity]="r.statusSeverity"></p-tag><span class="ab-val">{{ fmtNum(r.workspaceTotals.totalTokens) }}</span></div>
              <div class="bar-track"><i [style.width.%]="barPct(r.workspaceTotals.totalTokens, agentMax)" [style.background]="r.color"></i></div>
              <div class="ab-sub">{{ fmtCost(r.workspaceTotals.cost.total) }} · {{ r.workspaceRuns }} ejecuciones</div>
            </div>
          </div>
          <ng-template #noAgents><div class="empty">Sin agentes con consumo registrado.</div></ng-template>
        </article>
      </section>

      <section class="card table-card">
        <div class="card-head"><h3>Detalle por agente</h3><span class="muted">incluye activos, inactivos, archivados y eliminados con histórico</span></div>
        <div class="table-wrap" *ngIf="agentRows.length; else noRows">
          <table>
            <thead><tr><th>Agente</th><th>Estado</th><th>Sesión actual</th><th>Total workspace</th><th>Ejecuciones</th><th>Última actividad</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let r of agentRows" [class.archived]="r.statusKind==='archived'" [class.deleted]="r.statusKind==='deleted'">
                <td class="agent-cell">
                  <span class="dot" [style.background]="r.color"></span>
                  <div class="agent-meta">
                    <div class="name-line">{{ r.nickname }} <small *ngIf="r.role">· {{ r.role }}</small></div>
                    <div class="id-line">{{ r.agentId }}</div>
                    <div class="reset-line" *ngIf="r.usageResetAt">reseteado: {{ fmtDate(r.usageResetAt) }}</div>
                  </div>
                </td>
                <td><p-tag [value]="r.statusLabel" [severity]="r.statusSeverity"></p-tag></td>
                <td><div class="metric">{{ fmtNum(r.sessionTotals.totalTokens) }} tok</div><div class="metric-sub">{{ fmtCost(r.sessionTotals.cost.total) }} · {{ r.sessionRuns }} runs</div></td>
                <td><div class="metric">{{ fmtNum(r.workspaceTotals.totalTokens) }} tok</div><div class="metric-sub">{{ fmtCost(r.workspaceTotals.cost.total) }} · {{ r.workspaceRuns }} runs</div></td>
                <td>{{ r.workspaceRuns }} <span class="muted">({{ r.sessionRuns }} sesión)</span></td>
                <td>{{ fmtDate(r.lastAt) || '—' }}</td>
                <td class="actions"><button pButton type="button" icon="pi pi-replay" label="Reset sesión" class="p-button-text p-button-sm" (click)="resetAgent(r)" [disabled]="!r.agent || r.statusKind==='deleted'" [title]="!r.agent ? 'Agente eliminado: no se puede resetear' : 'Resetear consumo visible de la sesión actual de este agente (no afecta al total del workspace)'"></button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <ng-template #noRows><div class="empty">No hay datos de consumo por agente.</div></ng-template>
      </section>

      <section class="card runs-card">
        <div class="card-head"><h3>Ejecuciones recientes (histórico)</h3><span class="muted">últimas {{ recentRuns.length }} registradas</span></div>
        <div class="runs" *ngIf="recentRuns.length; else noRuns">
          <div class="run" *ngFor="let r of recentRuns">
            <span class="dot" [style.background]="colorFor(r.agentId)"></span>
            <span class="who">{{ nameFor(r.agentId) }}</span>
            <span class="model" [title]="r.model || (r.provider+'/'+r.modelId)">{{ r.model || (r.provider + '/' + r.modelId) || 'modelo' }}</span>
            <span class="nums">{{ fmtNum(r.totals.totalTokens) }} tok · {{ fmtCost(r.totals.cost.total) }}</span>
            <span class="when">{{ fmtDate(r.createdAt) }}</span>
          </div>
        </div>
        <ng-template #noRuns><div class="empty">Sin ejecuciones registradas.</div></ng-template>
      </section>
    </div>
    <ng-template #noWs><div class="empty page-empty">Selecciona un workspace para ver su consumo.</div></ng-template>
  `,
  styles: [`
    :host { display:block; height:100%; min-height:0; }
    .consumption-page { height:100%; min-height:0; overflow:auto; padding: 4px 4px 20px; display:flex; flex-direction:column; gap:14px; }
    .page-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
    .eyebrow { font: 11px var(--font-mono); color: var(--accent-blue); text-transform:uppercase; letter-spacing:.08em; }
    h2 { margin:2px 0 4px; font-size:22px; color: var(--text-primary); }
    .sub { margin:0; color: var(--text-secondary); font-size:13px; max-width: 820px; }
    .header-actions { display:flex; gap:8px; }
    .summary-grid { display:grid; grid-template-columns: 1.4fr 1fr 1fr 1.1fr; gap:12px; }
    .grid.two { display:grid; grid-template-columns: 1.2fr 1fr; gap:12px; }
    .card { background: var(--bg-secondary); border:1px solid var(--border-color); border-radius: 12px; padding: 14px; min-width:0; }
    .card.hero { background: linear-gradient(145deg, rgba(88,166,255,0.12), rgba(22,27,34,0.9)); border-color: rgba(88,166,255,0.25); }
    .card-top { display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:4px; }
    .card-top .kicker { margin-bottom:0; }
    .kicker { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color: var(--text-muted); margin-bottom:6px; }
    .big { font-size:30px; font-weight:700; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height:1.1; }
    .big.sm { font-size:24px; } .big span { font-size:14px; color: var(--text-muted); font-weight:600; }
    .muted { color: var(--text-muted); font-size:12px; }
    .meta-line { margin-top:10px; display:flex; gap:10px; flex-wrap:wrap; font: 11px var(--font-mono); color: var(--text-secondary); }
    .status-bars { display:flex; flex-direction:column; gap:6px; } .bar-row { display:flex; justify-content:space-between; font-size:12px; color: var(--text-secondary); }
    .bar-track { height:6px; border-radius:999px; background: rgba(255,255,255,0.06); overflow:hidden; } .bar-track i { display:block; height:100%; border-radius:999px; }
    .bar-track i.active { background: var(--accent-green); } .bar-track i.inactive { background: var(--accent-amber); } .bar-track i.archived { background: #6b7280; } .bar-track i.deleted { background: var(--accent-red); }
    .breakdown .kv { display:flex; justify-content:space-between; gap:8px; font-size:12px; padding:4px 0; color: var(--text-secondary); } .breakdown .kv b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
    .breakdown .kv.cost { border-top:1px dashed var(--border-color); margin-top:4px; padding-top:8px; }
    .card-head { display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-bottom:10px; } .card-head h3 { margin:0; font-size:14px; color: var(--text-primary); }
    .chart { display:flex; flex-direction:column; gap:8px; } .chart-row { display:grid; grid-template-columns: 84px 1fr 70px; gap:8px; align-items:center; }
    .day, .val { font: 11px var(--font-mono); color: var(--text-secondary); } .val { text-align:right; color: var(--text-primary); }
    .bars .stack { height:10px; border-radius:999px; background: rgba(255,255,255,0.05); overflow:hidden; display:flex; } .bars .stack i { height:100%; display:block; }
    .bars .stack i.in, .legend .dot.in { background:#58a6ff; } .bars .stack i.out, .legend .dot.out { background:#bc8cff; } .bars .stack i.cache, .legend .dot.cache { background:#3fb950; }
    .legend { display:flex; gap:12px; flex-wrap:wrap; margin-top:4px; font-size:11px; color: var(--text-muted); } .legend .dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:4px; vertical-align:middle; }
    .agent-bars { display:flex; flex-direction:column; gap:10px; } .agent-bar .ab-top { display:flex; align-items:center; gap:8px; font-size:12px; margin-bottom:4px; }
    .agent-bar .name { color: var(--text-primary); font-weight:600; } .agent-bar .ab-val { margin-left:auto; font: 12px var(--font-mono); color: var(--text-primary); }
    .agent-bar .ab-sub { font-size:11px; color: var(--text-muted); margin-top:4px; } .dot { width:8px; height:8px; border-radius:50%; display:inline-block; flex:0 0 auto; }
    .table-wrap { overflow:auto; } table { width:100%; border-collapse: collapse; }
    th, td { text-align:left; padding:10px 8px; border-bottom:1px solid var(--border-color); vertical-align:middle; font-size:12px; color: var(--text-secondary); }
    th { font-size:11px; text-transform:uppercase; letter-spacing:.05em; color: var(--text-muted); font-weight:600; }
    .agent-cell { display:flex; gap:10px; align-items:flex-start; } .agent-meta .name-line { color: var(--text-primary); font-weight:600; } .agent-meta .name-line small { color: var(--text-muted); font-weight:500; }
    .agent-meta .id-line, .agent-meta .reset-line { font: 10px var(--font-mono); color: var(--text-muted); margin-top:2px; }
    .metric { color: var(--text-primary); font-variant-numeric: tabular-nums; } .metric-sub { font-size:11px; color: var(--text-muted); margin-top:2px; }
    tr.archived { opacity: .85; } tr.deleted .name-line { color: var(--text-secondary); } .actions { text-align:right; white-space:nowrap; }
    .runs { display:flex; flex-direction:column; gap:8px; max-height: 280px; overflow:auto; }
    .run { display:grid; grid-template-columns: 10px 140px 1fr auto auto; gap:10px; align-items:center; font-size:12px; color: var(--text-secondary); }
    .run .who { color: var(--text-primary); font-weight:500; } .run .model { font: 11px var(--font-mono); color: var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .run .nums, .run .when { font: 11px var(--font-mono); color: var(--text-secondary); white-space:nowrap; }
    .empty { color: var(--text-muted); font-size:13px; padding: 12px 0; } .page-empty { padding: 24px; }
    @media (max-width: 1200px) { .summary-grid { grid-template-columns: 1fr 1fr; } .grid.two { grid-template-columns: 1fr; } .run { grid-template-columns: 10px 120px 1fr; } .run .when { grid-column: 2 / -1; } }
    @media (max-width: 800px) { .summary-grid { grid-template-columns: 1fr; } .chart-row { grid-template-columns: 72px 1fr 56px; } }
  `]
})
export class ConsumptionComponent implements OnInit, OnDestroy {
  ws: IWorkspace | null = null; loading = false;
  agentRows: AgentUsageRow[] = []; topAgentRows: AgentUsageRow[] = []; timeline: WorkspaceUsageDay[] = []; workspaceRuns: WorkspaceUsageRun[] = []; recentRuns: WorkspaceUsageRun[] = [];
  liveRuns: RunUsage[] = []; liveTotals: UsageTotals = emptyTotals(); wsTotals: UsageTotals = emptyTotals();
  timelineMax = 1; agentMax = 1; counts = { active: 0, inactive: 0, archived: 0, deleted: 0, total: 0 };
  private agents: IAgent[] = []; private agentMap = new Map<string, IAgent>(); private usageAgents: WorkspaceUsageAgent[] = []; private usageRuns: WorkspaceUsageRun[] = []; private usageTimeline: WorkspaceUsageDay[] = []; private subs: Subscription[] = [];
  constructor(private workspace: WorkspaceService, private agentService: AgentService, private consumption: ConsumptionService, private tokenUsage: TokenUsageService, private wsock: WebsocketService, private feedback: UiFeedbackService) {}

  ngOnInit(): void {
    this.subs.push(this.workspace.active$.subscribe(ws => { this.ws = ws; this.reload(); }));
    this.subs.push(this.tokenUsage.runs$.subscribe(r => { this.liveRuns = r || []; this.recompute(); }));
    this.subs.push(this.tokenUsage.workspaceTotals$.subscribe(t => { this.liveTotals = t || emptyTotals(); }));
    this.subs.push(this.wsock.runEvent$.subscribe(ev => { if (ev && (!this.ws || !ev.workspaceId || ev.workspaceId === this.ws.id) && (ev as any).type === 'finished') this.reload(); }));
    this.subs.push((this.wsock as any).usageReset$?.subscribe((ev: any) => { if (!this.ws || !ev || ev.workspaceId === this.ws.id) this.reload(); }) || { unsubscribe(){} } as any);
  }

  reload(showToast = false): void {
    if (!this.ws?.id) { this.agents = []; this.agentMap.clear(); this.usageAgents = []; this.usageRuns = []; this.usageTimeline = []; this.recompute(); return; }
    this.loading = true; const wsId = this.ws.id;
    forkJoin({
      agents: this.agentService.getByWorkspace(wsId).pipe(catchError(() => of([] as IAgent[]))),
      usage: this.consumption.getWorkspaceUsage(wsId).pipe(catchError(() => of({ workspaceId: wsId, overall: emptyTotals(), agents: [], timeline: [], runs: [] } as any))),
    }).subscribe(({ agents, usage }) => {
      if (!this.ws || this.ws.id !== wsId) return;
      this.agents = agents || []; this.agentMap = new Map(this.agents.map(a => [a.id, a]));
      this.usageAgents = (usage?.agents || []) as WorkspaceUsageAgent[]; this.usageRuns = (usage?.runs || []) as WorkspaceUsageRun[]; this.usageTimeline = (usage?.timeline || []) as WorkspaceUsageDay[];
      this.wsTotals = cloneTotals(usage?.overall || emptyTotals()); this.loading = false; this.recompute(); if (showToast) this.feedback.success('Consumo actualizado.');
    });
  }

  private recompute(): void {
    const known = new Map(this.agentMap); const byAgentUsage = new Map<string, WorkspaceUsageAgent>(this.usageAgents.map(a => [a.agentId, a]));
    const ids = new Set<string>([...known.keys(), ...byAgentUsage.keys(), ...this.liveRuns.map(r => r.agentId)]);
    const rows: AgentUsageRow[] = [];
    ids.forEach(id => {
      const agent = known.get(id) || null; const hist = byAgentUsage.get(id);
      const workspaceTotals = cloneTotals(hist?.totals || emptyTotals()); const wsRuns = Number(hist?.runs || 0);
      const { totals: sessionTotals, runs: sessionRuns } = this.sessionUsageFor(id, agent, hist);
      const status = this.statusFor(agent);
      const nickname = agent?.nickname || (id === 'unknown' ? 'Desconocido' : (agent ? agent.name : `Eliminado (${this.short(id)})`));
      rows.push({ agentId: id, agent, nickname, color: this.colorFor(id), statusLabel: status.label, statusKind: status.kind, statusSeverity: status.severity, role: agent?.role || null, sessionTotals, workspaceTotals, sessionRuns, workspaceRuns: wsRuns, lastAt: hist?.lastAt || this.lastLiveFor(id) || null, usageResetAt: (agent as any)?.usage_reset_at || null });
    });
    rows.sort((a, b) => (Number(b.workspaceTotals.totalTokens || 0) - Number(a.workspaceTotals.totalTokens || 0)) || (Number(b.sessionTotals.totalTokens || 0) - Number(a.sessionTotals.totalTokens || 0)));
    this.agentRows = rows; this.topAgentRows = [...rows].sort((a,b)=>b.workspaceTotals.totalTokens-a.workspaceTotals.totalTokens).slice(0, 8);
    this.agentMax = Math.max(1, ...this.topAgentRows.map(r => Number(r.workspaceTotals.totalTokens || 0)));
    this.timeline = [...this.usageTimeline].sort((a,b)=>String(a.day).localeCompare(String(b.day)));
    this.timelineMax = Math.max(1, ...this.timeline.map(d => Number(d.totals?.totalTokens || 0)));
    this.workspaceRuns = [...this.usageRuns];
    this.recentRuns = [...this.usageRuns].sort((a,b)=> new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()).slice(0, 20);
    const counts = { active: 0, inactive: 0, archived: 0, deleted: 0, total: rows.length }; rows.forEach(r => { counts[r.statusKind]++; }); this.counts = counts;
  }

  private sessionUsageFor(agentId: string, agent: IAgent | null, hist?: WorkspaceUsageAgent): { totals: UsageTotals; runs: number } {
    const live = this.liveRuns.filter(r => r.agentId === agentId);
    if (live.length) { const t = emptyTotals(); live.forEach(r => addTotals(t, r.totals)); return { totals: t, runs: live.length }; }
    const resetAt = agent && (agent as any).usage_reset_at ? new Date((agent as any).usage_reset_at).getTime() : null;
    if (resetAt && this.usageRuns.length) {
      const t = emptyTotals(); let runs = 0;
      this.usageRuns.forEach(r => { if (r.agentId !== agentId) return; const ts = r.createdAt ? new Date(r.createdAt).getTime() : 0; if (ts >= resetAt) { addTotals(t, r.totals); runs++; } });
      return { totals: t, runs };
    }
    if (!resetAt && hist) return { totals: cloneTotals(hist.totals), runs: Number(hist.runs || 0) };
    return { totals: emptyTotals(), runs: 0 };
  }

  private lastLiveFor(agentId: string): string | null { const r = this.liveRuns.filter(x => x.agentId === agentId).sort((a,b)=>b.updatedAt-a.updatedAt)[0]; return r ? new Date(r.updatedAt).toISOString() : null; }
  statusFor(agent: IAgent | null): { label: string; kind: AgentUsageRow['statusKind']; severity: AgentUsageRow['statusSeverity'] } {
    if (!agent) return { label: 'Eliminado', kind: 'deleted', severity: 'danger' };
    if ((agent as any).archived_at) return { label: 'Archivado', kind: 'archived', severity: 'secondary' };
    const st = String(agent.status || '').toUpperCase();
    if (st === 'WORKING') return { label: 'Activo (trabajando)', kind: 'active', severity: 'success' };
    if (st === 'IDLE') return { label: 'Inactivo (idle)', kind: 'inactive', severity: 'warn' };
    if (st === 'PAUSED' || st === 'HOLD') return { label: 'Inactivo (pausa)', kind: 'inactive', severity: 'warn' };
    if (st === 'ERROR') return { label: 'Inactivo (error)', kind: 'inactive', severity: 'danger' };
    return { label: st || 'Inactivo', kind: 'inactive', severity: 'secondary' };
  }

  async resetAgent(r: AgentUsageRow): Promise<void> {
    if (!r.agent) return;
    const ok = await this.feedback.confirm({ title: 'Resetear consumo de sesión', message: `¿Resetear el consumo visible de la sesión actual de "${r.nickname}"?\nEl total acumulado del workspace no se modificará.`, confirmLabel: 'Resetear sesión', danger: false });
    if (!ok) return;
    this.consumption.resetAgentUsage(r.agentId).subscribe({
      next: () => { this.feedback.success(`Consumo de sesión reseteado para ${r.nickname}.`); this.tokenUsage.clearAgent(r.agentId); this.reload(); },
      error: (e) => this.feedback.error(e?.error?.message || 'No se pudo resetear el consumo de sesión')
    });
  }

  async resetAll(): Promise<void> {
    if (!this.ws) return;
    const ok = await this.feedback.confirm({
      title: 'Resetear consumo del workspace',
      message: `¿Resetear todo el consumo acumulado (total e histórico) del workspace "${this.ws.name}"?\nEsto eliminará el histórico de ejecuciones registrado y pondrá a cero los totales del workspace. Esta acción no se puede deshacer.`,
      confirmLabel: 'Resetear todo',
      danger: true
    });
    if (!ok) return;
    this.consumption.resetWorkspaceUsageHistory(this.ws.id).subscribe({
      next: () => { this.feedback.success('Consumo total del workspace reseteado.'); this.tokenUsage.clearAll(); this.reload(); },
      error: (e) => this.feedback.error(e?.error?.message || 'No se pudo resetear el consumo del workspace')
    });
  }

  async resetLiveSession(): Promise<void> {
    if (!this.ws) return;
    const ok = await this.feedback.confirm({
      title: 'Resetear sesión en curso',
      message: `¿Resetear el consumo visible de la sesión en curso del workspace "${this.ws.name}" (agentes y vista en vivo)?\nEl total acumulado/histórico del workspace no se modificará.`,
      confirmLabel: 'Resetear sesión',
      danger: false
    });
    if (!ok) return;
    this.consumption.resetWorkspaceUsage(this.ws.id).subscribe({
      next: (res) => { this.feedback.success(`Sesión en curso reseteada para ${res?.reset ?? 'todos los'} agentes.`); this.tokenUsage.clearAll(); this.reload(); },
      error: (e) => this.feedback.error(e?.error?.message || 'No se pudo resetear la sesión en curso')
    });
  }

  fmtNum(n: any): string { return Number(n || 0).toLocaleString('en-US'); }
  fmtCost(n: any): string { const v = Number(n || 0); if (v === 0) return '$0.00'; if (v > 0 && v < 0.01) return '$' + v.toFixed(4); return '$' + v.toFixed(2); }
  fmtDate(d: any): string { if (!d) return ''; try { const dt = new Date(d); if (isNaN(dt.getTime())) return String(d); return dt.toLocaleString(); } catch { return String(d); } }
  short(id: string): string { return id ? id.slice(0, 8) : ''; }
  pct(n: number): number { return this.counts.total ? Math.max(0, Math.min(100, (Number(n||0) / this.counts.total) * 100)) : 0; }
  barPct(v: number, max: number): number { return max ? Math.max(1.5, Math.min(100, (Number(v||0) / max) * 100)) : 0; }
  nameFor(id: string): string { const a = this.agentMap.get(id); if (!a) return id === 'unknown' ? 'Desconocido' : `Eliminado (${this.short(id)})`; return a.nickname || a.name || id; }
  colorFor(id: string): string { const a = this.agentMap.get(id); if ((a as any)?.archived_at) return '#6b7280'; if (a?.color) return a.color as string; let h = 0; for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return `hsl(${h % 360} 65% 55%)`; }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }
}
