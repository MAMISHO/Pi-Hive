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

interface Edge { x1:number; y1:number; x2:number; y2:number; color:string; kind:'down'|'return-progress'|'return-final'; d:string; dashed:boolean; }

@Component({
  selector: 'app-sidebar-right',
  standalone: true,
  imports: [CommonModule, TagModule, ButtonModule],
  template: `
    <div class="sidebar-right">
      <div class="header">
        <h2>Task Lineage</h2>
        <div class="head-actions"><span class="count">{{ tasks.length }}</span><button pButton icon="pi pi-trash" severity="danger" [text]="true" class="p-button-sm" title="Limpiar Task Lineage" (click)="clearLineage()"></button></div>
      </div>
      <div class="legend" *ngIf="agents.length">
        <span class="leg" *ngFor="let a of agents"><i [style.background]="agentColor(a.id)"></i>{{a.nickname}}</span>
        <span class="leg key"><i class="line solid"></i>resuelto</span>
        <span class="leg key"><i class="line dashed"></i>en curso/pendiente</span>
      </div>
      <div class="timeline" #timeline>
        <svg class="graph" *ngIf="edges.length" [attr.width]="graphW" [attr.height]="graphH">
          <path *ngFor="let e of edges" [attr.d]="e.d" [attr.stroke]="e.color" fill="none" stroke-width="2" stroke-linecap="round" [attr.stroke-dasharray]="e.dashed ? '4 3' : null" [attr.opacity]="e.dashed ? 0.75 : 0.9"/>
          <circle class="node" *ngFor="let n of nodes; let i = index" [attr.cx]="cx(n)" [attr.cy]="cy[i]||0" r="5" [attr.fill]="n.color" [attr.stroke]="'var(--bg-secondary,#111827)'" stroke-width="1.5">
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
              @if (n.parent_task_id) { <div class="parent">parent: #{{ n.parent_task_id }} · {{ n.task_flow || 'direct' }}<ng-container *ngIf="n.isProgress"> (en curso)</ng-container><ng-container *ngIf="n.isFinal"> (resuelto)</ng-container></div> }
              <div class="payload" [title]="fullText(n)">{{ preview(n.payload) }}</div>
            </div>
          } @empty {
            <div class="empty">No tasks yet</div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .head-actions{display:flex;align-items:center;gap:4px}
    .header h2 { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .count { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .legend{display:flex;flex-wrap:wrap;gap:6px 10px;margin:0 0 8px 2px}
    .leg{display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--text-secondary)}
    .leg i{width:8px;height:8px;border-radius:50%;display:inline-block}
    .leg.key i.line{width:14px;height:0;border-radius:0;border-top:2px solid var(--text-muted);background:transparent}
    .leg.key i.line.dashed{border-top-style:dashed;opacity:.8}
    .timeline{position:relative}
    .graph{position:absolute;left:0;top:0;pointer-events:none;overflow:visible}
    .graph .node{pointer-events:auto;cursor:pointer}
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
  tasks: ITaskQueue[] = [];
  agents: IAgent[] = [];
  nodes: GraphNode[] = [];
  edges: Edge[] = [];
  cy: number[] = [];
  graphW = 24; graphH = 0;
  private agentMap = new Map<string, IAgent>();
  private subs: Subscription[] = [];
  private laneW = 16;
  @ViewChildren('row') rows!: QueryList<ElementRef<HTMLElement>>;

  constructor(private taskService: TaskService, private ws: WebsocketService, private workspace: WorkspaceService, private agentService: AgentService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.load();
    const rel = () => this.load();
    this.subs.push(this.ws.statusChange$.subscribe(rel));
    this.subs.push(this.ws.taskUpdated$.subscribe(rel));
    this.subs.push(this.ws.tasksCleared$.subscribe(rel));
    this.subs.push(this.workspace.active$.subscribe(rel));
    this.subs.push((this.ws as any).transcriptCleared$?.subscribe(rel) || {unsubscribe(){}} as any);
  }

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

    this.nodes.forEach((n, i) => {
      if (!n.parent_task_id) return;
      const pi = idx.get(n.parent_task_id); if (pi == null) return;
      const parent = this.nodes[pi];
      const x1 = this.cx(parent), y1 = this.cy[pi] || 0;
      const x2 = this.cx(n), y2 = this.cy[i] || 0;
      const my = (y1 + y2) / 2;
      const d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
      const isReturn = n.isReturn;
      const dashed = n.isProgress || (!n.isProgress && !n.isFinal && isReturn ? false : (!n.isReturn && n.task_flow === 'direct' && !isClosed(n.id!) && parent));
      // clearer: direct branch dashed if not yet closed by a final in its subtree; progress always dashed; final solid
      const finalDashed = n.isProgress ? true : (n.isFinal ? false : (n.task_flow === 'direct' ? !isClosed(n.id!) : false));
      const kind: Edge['kind'] = n.isProgress ? 'return-progress' : (n.isFinal ? 'return-final' : (n.task_flow === 'direct' ? 'down' : 'down'));
      edges.push({ x1, y1, x2, y2, color: n.color, kind, d, dashed: finalDashed });
    });
    // outer spine (depth 0 lane) for continuity
    if (this.nodes.length) {
      const x = 10; const ys = this.cy; if (ys.length > 1) edges.unshift({ x1:x,y1:ys[0],x2:x,y2:ys[ys.length-1],color:'var(--border-color,#334155)',kind:'down', d:`M ${x} ${ys[0]} L ${x} ${ys[ys.length-1]}`, dashed:false });
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

  clearLineage(): void {
    const ws = this.workspace.active; if(!ws) return;
    if(!confirm('¿Limpiar todo el Task Lineage de este workspace? (se eliminan las tareas registradas)')) return;
    ((this.taskService as any).clearByWorkspace ? (this.taskService as any).clearByWorkspace(ws.id) : fetch(`http://localhost:8090/tasks/workspace/${ws.id}/clear`,{method:'DELETE'})).subscribe?.(()=>this.load());
    if(!(this.taskService as any).clearByWorkspace) fetch(`http://localhost:8090/tasks/workspace/${ws.id}/clear`,{method:'DELETE'}).then(()=>this.load());
  }

  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }
}