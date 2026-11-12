import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, OnDestroy, OnInit, QueryList, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { forkJoin, of, Subscription } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { TaskService } from '../../core/services/task.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { AgentService } from '../../core/services/agent.service';
import { UiFeedbackService } from '../../core/services/ui-feedback.service';
import { TokenUsageService, RunUsage, UsageTotals } from '../../core/services/token-usage.service';
import { ITaskQueue } from '../../core/models/task.model';
import { IAgent } from '../../core/models/agent.model';

interface GraphNode extends ITaskQueue {
  depth: number;
  lane: number;
  isReturn: boolean;
  isProgress: boolean;
  isFinal: boolean;
  flow: 'in' | 'out';
  color: string;
  agentLabel: string;
}

interface Edge { x1:number; y1:number; x2:number; y2:number; color:string; kind:'down'|'return-progress'|'return-resolved-progress'|'return-final'|'spine'; d:string; dashed:boolean; key:string; }

@Component({
  selector: 'app-sidebar-right',
  standalone: true,
  imports: [CommonModule, TagModule, ButtonModule],
  template: `
    <div class="sidebar-right">
      <div class="tabs">
        <button type="button" class="tab" [class.active]="activeTab==='lineage'" (click)="setTab('lineage')">Task Lineage <span class="tcount">{{ tasks.length }}</span></button>
        <button type="button" class="tab" [class.active]="activeTab==='usage'" (click)="setTab('usage')">Consumo <span class="tcount" *ngIf="usageRuns.length">{{ usageRuns.length }}</span></button>
      </div>

      @if (activeTab === 'lineage') {
        <div class="header lineage-header">
          <h2>Task Lineage</h2>
          <div class="head-actions"><span class="count">{{ tasks.length }}</span><button pButton icon="pi pi-trash" severity="danger" [text]="true" class="p-button-sm" title="Limpiar Task Lineage" (click)="clearLineage()"></button></div>
        </div>
        <div class="legend" *ngIf="agents.length">
          <span class="leg" *ngFor="let a of agents"><i [style.background]="agentColor(a.id)"></i>{{a.nickname}}</span>
          <span class="leg key"><i class="line solid"></i>resuelto</span>
          <span class="leg key"><i class="line dashed"></i>en curso/pendiente</span>
          <span class="leg key"><i class="line resolved-progress"></i>progreso reportado + resuelto</span>
        </div>
        <div class="timeline" #timeline>
          <svg class="graph" *ngIf="edges.length" [attr.width]="graphW" [attr.height]="graphH">
            <path *ngFor="let e of edges; trackBy: trackEdge"
                  [attr.d]="e.d"
                  [attr.stroke]="e.color"
                  fill="none"
                  stroke-width="2.4"
                  stroke-linecap="round"
                  [class.edge-path]="true"
                  [class.dashed]="e.dashed"
                  [class.solid]="!e.dashed"
                  [class.spine]="e.kind==='spine'"
                  [class.active-flow]="e.dashed"
                  [style.color]="e.color"/>
            <circle class="node" *ngFor="let n of nodes; let i = index" [attr.cx]="cx(n)" [attr.cy]="cy[i]||0" r="5.5" [attr.fill]="n.color" [attr.stroke]="'var(--bg-secondary,#111827)'" stroke-width="1.5" [class.active-node]="(n.isProgress && !isResolvedProgress(n.id!)) || n.status==='PROCESSING' || n.status==='PENDING'" [style.color]="n.color">
              <title>{{ nodeTitle(n) }}</title>
            </circle>
          </svg>
          <div class="rows" [style.padding-left.px]="graphW">
            @for (n of nodes; track n.id; let i = $index) {
              <div #row class="task-timeline-item" [class.completed]="n.status==='COMPLETED'" [class.hold]="n.status==='HOLD'||n.status==='STOPPED'" [class.processing]="n.status==='PROCESSING'">
                <div class="task-header">
                  <span class="flow" [class.out]="n.isReturn" [style.color]="n.color">{{ n.isReturn ? '↩' : '↳' }}</span>
                  <span class="task-id">#{{ n.id }}</span>
                  <span class="depth">d{{ n.depth }}</span>
                  <span class="ftag" *ngIf="n.isProgress">progress</span>
                  <span class="ftag final" *ngIf="n.isFinal">final</span>
                  <p-tag [value]="n.status" [severity]="severity(n.status)"></p-tag>
                </div>
                <div class="task-route"><span [style.color]="agentColor(n.sender_agent_id)">{{ label(n.sender_agent_id) }}</span> → <span [style.color]="agentColor(n.receiver_agent_id)">{{ label(n.receiver_agent_id) }}</span></div>
                @if (n.parent_task_id) { <div class="parent">parent: #{{ n.parent_task_id }} · {{ n.task_flow || 'direct' }}<ng-container *ngIf="n.isProgress && !isResolvedProgress(n.id!)"> (en curso)</ng-container><ng-container *ngIf="n.isFinal"> (resuelto)</ng-container></div> }
                <div class="payload" [title]="fullText(n)">{{ preview(n.payload) }}</div>
              </div>
            } @empty {
              <div class="empty">No tasks yet</div>
            }
          </div>
        </div>
      } @else {
        <div class="usage-pane">
          <div class="usage-summary">
            <div class="u-card primary"><div class="u-label">Tokens totales</div><div class="u-value">{{ fmtNum(usageTotals.totalTokens) }}</div><div class="u-sub">workspace · sesión en vivo</div></div>
            <div class="u-grid">
              <div class="u-card"><div class="u-label">Entrada</div><div class="u-value sm">{{ fmtNum(usageTotals.input) }}</div></div>
              <div class="u-card"><div class="u-label">Salida</div><div class="u-value sm">{{ fmtNum(usageTotals.output) }}</div></div>
              <div class="u-card"><div class="u-label">Cache read</div><div class="u-value sm">{{ fmtNum(usageTotals.cacheRead) }}</div></div>
              <div class="u-card"><div class="u-label">Cache write</div><div class="u-value sm">{{ fmtNum(usageTotals.cacheWrite) }}</div></div>
            </div>
            <div class="u-card cost"><div class="u-label">Coste</div><div class="u-value">{{ fmtCost(usageTotals.cost.total) }}</div><div class="u-sub">{{ usageTotals.costFromProvider ? 'reportado por proveedor' : 'estimado (catálogo)' }}</div></div>
            <div class="u-breakdown" *ngIf="usageTotals.cost.total || usageTotals.input || usageTotals.output">
              <div class="u-row"><span>Entrada</span><span>{{ fmtCost(usageTotals.cost.input) }}</span></div>
              <div class="u-row"><span>Salida</span><span>{{ fmtCost(usageTotals.cost.output) }}</span></div>
              <div class="u-row"><span>Cache read</span><span>{{ fmtCost(usageTotals.cost.cacheRead) }}</span></div>
              <div class="u-row"><span>Cache write</span><span>{{ fmtCost(usageTotals.cost.cacheWrite) }}</span></div>
            </div>
          </div>
          <div class="runs-header"><span>Ejecuciones (tiempo real)</span><span class="live-dot" [class.on]="usageRuns.length"></span></div>
          <div class="runs-list">
            @for (r of usageRuns; track r.runId) {
              <div class="run-card">
                <div class="run-top">
                  <span class="agent-dot" [style.background]="agentColor(r.agentId)"></span>
                  <span class="agent-name">{{ label(r.agentId) }}</span>
                  <span class="run-task" *ngIf="r.taskId">#{{ r.taskId }}</span>
                  <span class="run-turns">{{ r.turns }} turno{{ r.turns === 1 ? '' : 's' }}</span>
                </div>
                <div class="run-model" [title]="r.model || (r.provider+'/'+r.modelId)">{{ r.model || (r.provider + '/' + r.modelId) || 'modelo desconocido' }}</div>
                <div class="run-metrics">
                  <span title="Tokens totales"><b>{{ fmtNum(r.totals.totalTokens) }}</b> tok</span>
                  <span title="Entrada / Salida">in {{ fmtNum(r.totals.input) }} · out {{ fmtNum(r.totals.output) }}</span>
                </div>
                <div class="run-metrics sub">
                  <span>cache r {{ fmtNum(r.totals.cacheRead) }} · w {{ fmtNum(r.totals.cacheWrite) }}</span>
                  <span class="run-cost">{{ fmtCost(r.totals.cost.total) }} <em>{{ r.totals.costFromProvider ? 'prov.' : 'est.' }}</em></span>
                </div>
                <div class="run-time">{{ fmtTime(r.updatedAt) }}</div>
              </div>
            } @empty {
              <div class="empty">Sin datos de consumo aún. Se mostrará en tiempo real al ejecutar tareas.</div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; min-height: 0; }
    .sidebar-right { display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; padding: 10px 10px 8px; box-sizing: border-box; }
    .tabs { display:flex; gap:4px; padding:2px; background: var(--bg-tertiary, rgba(255,255,255,0.03)); border:1px solid var(--border-color); border-radius:10px; margin-bottom:8px; flex:0 0 auto; }
    .tab { flex:1; display:inline-flex; align-items:center; justify-content:center; gap:6px; padding:6px 8px; border:0; border-radius:8px; background:transparent; color: var(--text-muted); font-size:12px; font-weight:600; cursor:pointer; transition: all .15s ease; }
    .tab:hover { color: var(--text-secondary); background: rgba(255,255,255,0.03); }
    .tab.active { color: var(--text-primary); background: var(--bg-secondary, #161b22); box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
    .tcount { font: 10px var(--font-mono); color: var(--text-muted); background: rgba(255,255,255,0.06); padding: 0 6px; border-radius: 999px; }
    .tab.active .tcount { color: var(--accent-blue); background: rgba(88,166,255,0.12); }
    .usage-pane { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; display:flex; flex-direction:column; gap:10px; padding-bottom:8px; overscroll-behavior: contain; }
    .usage-summary { display:flex; flex-direction:column; gap:8px; }
    .u-card { background: var(--bg-tertiary, rgba(255,255,255,0.02)); border:1px solid var(--border-color); border-radius:10px; padding:8px 10px; }
    .u-card.primary { background: linear-gradient(135deg, rgba(88,166,255,0.10), rgba(59,130,246,0.04)); border-color: rgba(88,166,255,0.25); }
    .u-card.cost { background: linear-gradient(135deg, rgba(34,197,94,0.08), rgba(34,197,94,0.02)); border-color: rgba(34,197,94,0.2); }
    .u-label { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color: var(--text-muted); margin-bottom:2px; }
    .u-value { font-size:22px; font-weight:700; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height:1.15; }
    .u-value.sm { font-size:15px; }
    .u-sub { font-size:10px; color: var(--text-muted); margin-top:2px; }
    .u-grid { display:grid; grid-template-columns: 1fr 1fr; gap:6px; }
    .u-breakdown { border:1px dashed var(--border-color); border-radius:8px; padding:6px 8px; display:flex; flex-direction:column; gap:4px; }
    .u-row { display:flex; justify-content:space-between; font-size:11px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }
    .u-row span:last-child { color: var(--text-primary); font-family: var(--font-mono); }
    .runs-header { display:flex; align-items:center; justify-content:space-between; font-size:11px; font-weight:600; color: var(--text-secondary); text-transform:uppercase; letter-spacing:.05em; margin-top:2px; flex:0 0 auto; }
    .live-dot { width:7px; height:7px; border-radius:50%; background: var(--text-muted); opacity:.5; }
    .live-dot.on { background: #22c55e; opacity:1; box-shadow: 0 0 0 0 rgba(34,197,94,.5); animation: usage-pulse 1.6s ease-out infinite; }
    @keyframes usage-pulse { 0%{box-shadow:0 0 0 0 rgba(34,197,94,.5)} 70%{box-shadow:0 0 0 6px rgba(34,197,94,0)} 100%{box-shadow:0 0 0 0 rgba(34,197,94,0)} }
    .runs-list { display:flex; flex-direction:column; gap:8px; }
    .run-card { border:1px solid var(--border-color); border-radius:10px; padding:8px 10px; background: rgba(255,255,255,0.015); }
    .run-top { display:flex; align-items:center; gap:6px; font-size:12px; }
    .agent-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
    .agent-name { font-weight:600; color: var(--text-primary); }
    .run-task { font: 10px var(--font-mono); color: var(--text-muted); padding:0 5px; border:1px solid var(--border-color); border-radius:6px; }
    .run-turns { margin-left:auto; font-size:10px; color: var(--text-muted); }
    .run-model { font: 10px var(--font-mono); color: var(--text-secondary); margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .run-metrics { display:flex; justify-content:space-between; gap:8px; font-size:11px; color: var(--text-secondary); margin-top:6px; font-variant-numeric: tabular-nums; }
    .run-metrics b { color: var(--text-primary); }
    .run-metrics.sub { font-size:10px; color: var(--text-muted); margin-top:2px; }
    .run-cost { color: var(--text-primary); }
    .run-cost em { font-style:normal; color: var(--text-muted); font-size:9px; }
    .run-time { font-size:10px; color: var(--text-muted); margin-top:4px; text-align:right; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex: 0 0 auto; }
    .head-actions{display:flex;align-items:center;gap:4px}
    .header h2 { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
    .count { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .legend{display:flex;flex-wrap:wrap;gap:6px 10px;margin:0 0 8px 2px; flex: 0 0 auto;}
    .leg{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-secondary)}
    .leg i{width:8px;height:8px;border-radius:50%;display:inline-block}
    .leg.key i.line{width:14px;height:0;border-radius:0;border-top:2px solid var(--text-muted);background:transparent}
    .leg.key i.line.dashed{border-top-style:dashed;opacity:.8}
    .leg.key i.line.resolved-progress { border-top-style: dotted; opacity: 0.6; border-width: 1px; }
    .timeline{position:relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; padding-bottom: 8px;}
    .graph{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
    .graph .node{pointer-events:auto;cursor:pointer;transition: filter .4s ease}
    .graph .node.active-node{filter: drop-shadow(0 0 4px currentColor) drop-shadow(0 0 8px currentColor); animation: node-breathe 1.4s ease-in-out infinite}
    .edge-path{transition: stroke-dasharray 1.8s ease, stroke-dashoffset 1.8s ease, opacity 1.2s ease, filter .8s ease; opacity: .95}
    .edge-path.spine{opacity:.95}
    .edge-path.dashed{animation: edge-draw 2.6s ease-out forwards, edge-dash-flow 4.5s linear 2.6s infinite}
    .edge-path.solid{stroke-dasharray: 1000; stroke-dashoffset: 0; animation: edge-solidize 3.2s ease forwards}
    .edge-path.active-flow{filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 7px currentColor); opacity: 1}
    @keyframes edge-dash-flow { 0% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -24; } }
    @keyframes edge-draw { from { stroke-dasharray: 1000; stroke-dashoffset: 1000; opacity: .25; } to { stroke-dasharray: 6 6; stroke-dashoffset: 0; opacity: .95; } }
    @keyframes edge-solidize { 0% { stroke-dasharray: 6 6; stroke-dashoffset: 0; opacity: .8; } 45% { stroke-dasharray: 1000; stroke-dashoffset: 220; opacity: .95; } 100% { stroke-dasharray: 1000; stroke-dashoffset: 0; opacity: .98; filter: none; } }
    @keyframes node-breathe { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: .78; } }
    @media (prefers-reduced-motion: reduce){ .edge-path.dashed,.edge-path.solid,.graph .node.active-node{animation:none} .edge-path{transition:none} }
    .rows{position:relative}
    .task-timeline-item { position: relative; padding: 0 0 12px 10px; margin-left: 0; }
    .task-header { display: flex; align-items: center; gap: 6px; flex-wrap:wrap; }
    .flow{font-weight:700;font-size:13px;line-height:1}
    .flow.out{opacity:.9}
    .task-id { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); }
    .depth{font:10px var(--font-mono);color:var(--text-muted);padding:0 4px;border:1px solid var(--border-color);border-radius:8px}
    .ftag{font:10px var(--font-mono);padding:0 5px;border-radius:8px;border:1px dashed #f59e0b;color:#f59e0b;background:rgba(245,158,11,.08)}
    .ftag.final{border-style:solid;border-color:#22c55e;color:#22c55e;background:rgba(34,197,94,.08)}
    .task-route { font-size: 12px; color: var(--text-secondary); margin: 2px 0; font-family: var(--font-mono); }
    .parent { font-size: 10px; color: var(--text-muted); }
    .payload { font-size: 12px; color: var(--text-secondary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 240px; cursor: help; }
    .empty { font-size: 12px; color: var(--text-muted); padding: 8px 0; }
  `],
})
export class SidebarRightComponent implements OnInit, AfterViewInit, OnDestroy {
  activeTab: 'lineage' | 'usage' = 'lineage';
  tasks: ITaskQueue[] = [];
  agents: IAgent[] = [];
  nodes: GraphNode[] = [];
  edges: Edge[] = [];
  cy: number[] = [];
  graphW = 24; graphH = 0;
  usageRuns: RunUsage[] = [];
  usageTotals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costFromProvider: false };
  private agentMap = new Map<string, IAgent>();
  private subs: Subscription[] = [];
  private laneW = 16;
  @ViewChildren('row') rows!: QueryList<ElementRef<HTMLElement>>;

  constructor(private taskService: TaskService, private ws: WebsocketService, private workspace: WorkspaceService, private agentService: AgentService, private cdr: ChangeDetectorRef, private feedback: UiFeedbackService, private tokenUsage: TokenUsageService) {}

  ngOnInit(): void {
    this.load();
    const rel = () => this.load();
    this.subs.push(this.ws.statusChange$.subscribe(rel));
    this.subs.push(this.ws.taskUpdated$.subscribe(rel));
    this.subs.push(this.ws.tasksCleared$.subscribe(rel));
    this.subs.push(this.workspace.active$.subscribe(rel));
    this.subs.push((this.ws as any).transcriptCleared$?.subscribe(rel) || {unsubscribe(){}} as any);
    this.subs.push(this.tokenUsage.runs$.subscribe(r => { this.usageRuns = r; this.cdr.detectChanges(); }));
    this.subs.push(this.tokenUsage.workspaceTotals$.subscribe(t => { this.usageTotals = t; this.cdr.detectChanges(); }));
  }

  setTab(tab: 'lineage' | 'usage') {
    this.activeTab = tab;
    if (tab === 'lineage') setTimeout(() => this.measure(), 0);
  }

  fmtNum(n: any): string { const v = Number(n || 0); return v.toLocaleString('en-US'); }
  fmtCost(n: any): string { const v = Number(n || 0); if (v === 0) return '$0.00'; if (v > 0 && v < 0.01) return '$' + v.toFixed(4); return '$' + v.toFixed(2); }
  fmtTime(ts: any): string { if (!ts) return ''; try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return ''; } }

  ngAfterViewInit(): void { this.subs.push(this.rows.changes.subscribe(() => setTimeout(() => this.measure(), 0))); }

  load(): void {
    const ws = this.workspace.active;
    const tasks$ = (ws ? this.taskService.getByWorkspace(ws.id) : this.taskService.getAll()).pipe(catchError(() => of([] as ITaskQueue[])));
    const agents$ = this.agentService.getAll().pipe(catchError(() => of([] as IAgent[])));
    forkJoin({ list: tasks$, ags: agents$ }).subscribe(({ list, ags }) => {
      this.tasks = (list as ITaskQueue[]) || [];
      this.agents = ((ags as IAgent[]) || []).filter((a: any) => !ws || a.workspace_id === ws.id);
      this.agentMap = new Map(this.agents.map(a => [a.id, a]));
      this.nodes = this.build(this.tasks);
      setTimeout(() => this.measure(), 0);
      this.cdr.detectChanges();
    });
  }

  build(list: ITaskQueue[]): GraphNode[] {
    const byId = new Map(list.map(t => [t.id!, t]));
    const depthOf = (t: ITaskQueue, seen = new Set<number>()): number => {
      if (typeof t.depth === 'number') return t.depth;
      if (!t.parent_task_id) return 0; if (seen.has(t.id!)) return 0; seen.add(t.id!);
      const p = byId.get(t.parent_task_id); return p ? 1 + depthOf(p, seen) : 0;
    };
    const chrono = [...list].sort((a, b) => new Date(a.created_at as any).getTime() - new Date(b.created_at as any).getTime() || (a.id ?? 0) - (b.id ?? 0));
    return chrono.map(t => {
      const depth = depthOf(t);
      const flowName = (t.task_flow || 'direct') as string;
      const isProgress = flowName === 'delegation_progress' || (t.callback_final === false && !!t.parent_task_callback);
      const isResult = flowName === 'delegation_result' || (typeof t.payload === 'string' && t.payload.includes('[DELEGATION RESULT'));
      const isFinal = isResult && (t.callback_final !== false);
      const isReturn = isProgress || isResult || !!t.parent_task_callback;
      const lane = isReturn ? Math.max(0, depth - 1) : depth;
      const actorId = isReturn ? t.sender_agent_id : t.receiver_agent_id;
      const color = this.agentColor(actorId);
      return { ...t, depth, lane, isReturn, isProgress, isFinal, flow: isReturn ? 'out' : 'in', color, agentLabel: this.label(t.receiver_agent_id) } as GraphNode;
    });
  }

  measure(): void {
    const els = this.rows?.toArray().map(r => r.nativeElement) || [];
    if (!els.length || !this.nodes.length) { this.edges = []; this.cy = []; this.graphW = 24; this.graphH = 0; return; }
    const maxLane = Math.max(0, ...this.nodes.map(n => n.lane));
    this.graphW = 18 + maxLane * this.laneW + 14;
    const tl = (els[0].offsetParent as HTMLElement) || els[0].parentElement;
    const tlTop = tl ? tl.getBoundingClientRect().top : 0;
    this.cy = els.map(el => { const r = el.getBoundingClientRect(); return (r.top - tlTop) + 14; });
    this.graphH = els.reduce((s, el) => s + el.offsetHeight, 8);
    this.edges = this.buildEdges();
    this.cdr.detectChanges();
  }

  cx(n: GraphNode): number { return 10 + n.lane * this.laneW; }

  buildEdges(): Edge[] {
    const idx = new Map<number, number>();
    this.nodes.forEach((n, i) => { if (n.id != null) idx.set(n.id, i); });
    const edges: Edge[] = [];
    // precompute which direct/delegation tasks are "closed" by a final result in their subtree
    const hasFinalDesc: Record<number, boolean> = {};
    const children: Record<number, number[]> = {};
    this.nodes.forEach(n => { if (n.parent_task_id) { (children[n.parent_task_id] ||= []).push(n.id!); } });
    const isClosed = (id: number, seen = new Set<number>()): boolean => {
      if (hasFinalDesc[id] !== undefined) return hasFinalDesc[id];
      if (seen.has(id)) return false; seen.add(id);
      for (const cid of (children[id] || [])) {
        const c = this.nodes[idx.get(cid)!];
        if (c?.isFinal) { hasFinalDesc[id] = true; return true; }
        if (isClosed(cid, seen)) { hasFinalDesc[id] = true; return true; }
      }
      hasFinalDesc[id] = false; return false;
    };
    // determine which progress nodes have been resolved (their branch got a final desc)
    const resolvedProgressSet: Set<number> = new Set();
    this.nodes.filter(n => n.isProgress).forEach(p => {
      if (p.parent_task_id && isClosed(p.parent_task_id as any, new Set())) {
        resolvedProgressSet.add(p.id!);
      }
    });

    this.nodes.forEach((n, i) => {
      if (!n.parent_task_id) return;
      const pi = idx.get(n.parent_task_id); if (pi == null) return;
      const parent = this.nodes[pi];
      const x1 = this.cx(parent), y1 = this.cy[pi] || 0;
      const x2 = this.cx(n), y2 = this.cy[i] || 0;
      const my = (y1 + y2) / 2;
      const d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
      // Edge styling rules:
      // - progress with resolved branch → dotted (resolved progress), dashed otherwise
      // - final → solid
      // - direct branch not yet closed → dashed; direct already closed → solid
      let dashed = false;
      if (n.isProgress) {
        dashed = !resolvedProgressSet.has(n.id!);
      } else if (n.isFinal) {
        dashed = false;
      } else {
        dashed = n.task_flow === 'direct' ? !isClosed(n.id!) : false;
      }
      const kind: Edge['kind'] = n.isProgress ? (dashed ? 'return-progress' : 'return-resolved-progress') : (n.isFinal ? 'return-final' : (n.task_flow === 'direct' ? 'down' : 'down'));
      edges.push({ x1, y1, x2, y2, color: n.color, kind, d, dashed, key: `${parent.id}->${n.id}:${kind}:${dashed?'d':'s'}` });
    });
    // outer spine (depth 0 lane) for continuity — always solid, color of origin agent
    if (this.nodes.length) {
      const x = 10; const ys = this.cy; if (ys.length > 1) {
        const originColor = this.nodes[0].color || 'var(--border-color,#334155)';
        const d = `M ${x} ${ys[0]} L ${x} ${ys[ys.length-1]}`;
        edges.unshift({ x1:x,y1:ys[0],x2:x,y2:ys[ys.length-1], color: originColor, kind:'spine', d, dashed:false, key:`spine:${originColor}:${ys.length}` });
      }
    }
    return edges;
  }

  agentColor(id: string): string {
    const a = this.agentMap.get(id); if (a?.color) return a.color; if (id === 'user') return '#9ca3af';
    let h = 0; for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 65% 55%)`;
  }
  label(id: string): string { if (id === 'user') return 'user'; return this.agentMap.get(id)?.nickname || this.short(id); }
  short(id: string): string { return id ? id.slice(0, 8) : ''; }
  preview(p: string): string { if (!p) return ''; const s = p.replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 90) + '…' : s; }

  fullText(n: GraphNode): string {
    const payload = (n.payload || '').toString();
    const response = (n as any).response ? String((n as any).response) : '';
    const state = n.isProgress ? 'en curso (progress)' : (n.isFinal ? 'resuelto (final)' : (n.task_flow || 'direct'));
    return [`#${n.id} ${n.status} · ${n.task_flow || 'direct'} · d${n.depth} · ${state}`, `From: ${this.label(n.sender_agent_id)} → ${this.label(n.receiver_agent_id)}`, `At: ${this.formatDate(n.created_at)}`, payload ? `\nPayload:\n${payload}` : '', response ? `\nResponse:\n${response}` : ''].filter(Boolean).join('\n');
  }

  nodeTitle(n: GraphNode): string {
    const state = n.isProgress ? 'progress (en curso)' : (n.isFinal ? 'final (resuelto)' : (n.task_flow || 'direct'));
    return `#${n.id} · ${this.formatDate(n.created_at)}\n${this.label(n.sender_agent_id)} → ${this.label(n.receiver_agent_id)}\n${n.status} · ${state}`;
  }

  formatDate(d: any): string {
    if (!d) return '';
    try {
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return String(d);
      const pad = (x: number) => x.toString().padStart(2, '0');
      return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    } catch { return String(d); }
  }

  severity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) { case 'COMPLETED': return 'success'; case 'PROCESSING': return 'info'; case 'HOLD': case 'STOPPED': return 'warn'; case 'PENDING': return 'secondary'; default: return 'contrast'; }
  }

  trackEdge = (_: number, e: Edge) => e.key;

  /** Check if a progress node's branch was closed by a final result */
  isResolvedProgress(id: number): boolean {
    const idx = new Map<number, number>();
    this.nodes.forEach((n, i) => { if (n.id != null) idx.set(n.id, i); });
    const children: Record<number, number[]> = {};
    this.nodes.forEach(n => { if (n.parent_task_id) { (children[n.parent_task_id] ||= []).push(n.id!); } });
    const isClosed = (targetId: number, seen = new Set<number>()): boolean => {
      if (seen.has(targetId)) return false;
      seen.add(targetId);
      for (const cid of (children[targetId] || [])) {
        const c = this.nodes[idx.get(cid)!];
        if (c?.isFinal) return true;
        if (isClosed(cid, seen)) return true;
      }
      return false;
    };
    // For progress node, check if its parent chain leads to a closed branch
    const node = this.nodes.find(n => n.id === id);
    if (!node?.parent_task_id) return false;
    return isClosed(node.parent_task_id!, new Set());
  }

  async clearLineage(): Promise<void> {
    const ws = this.workspace.active; if(!ws) return;
    const ok = await this.feedback.confirm({ title: 'Limpiar Task Lineage', message: '¿Limpiar todo el Task Lineage de este workspace?\nSe eliminarán las tareas registradas.', confirmLabel: 'Limpiar', danger: true });
    if(!ok) return;
    const onDone = () => { this.feedback.success('Task Lineage limpiado.'); this.load(); };
    const onErr = () => this.feedback.error('No se pudo limpiar el Task Lineage.');
    if ((this.taskService as any).clearByWorkspace) {
      (this.taskService as any).clearByWorkspace(ws.id).subscribe({ next: onDone, error: onErr });
    } else {
      fetch(`http://localhost:8090/tasks/workspace/${ws.id}/clear`,{method:'DELETE'}).then(onDone).catch(onErr);
    }
  }

  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }
}