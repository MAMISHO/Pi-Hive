import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, QueryList, ViewChildren } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { ITaskQueue } from '../../../core/models/task.model';
import { IAgent } from '../../../core/models/agent.model';

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

interface Edge { x1: number; y1: number; x2: number; y2: number; color: string; kind: 'down' | 'return-progress' | 'return-resolved-progress' | 'return-final' | 'spine'; d: string; dashed: boolean; key: string; }
interface LifelineSegment { y1: number; y2: number; waiting: boolean; key: string; }
interface Lifeline { id: string; lane: number; x: number; color: string; label: string; segments: LifelineSegment[]; }

@Component({
  selector: 'app-lineage',
  standalone: true,
  imports: [CommonModule, TagModule, ButtonModule],
  templateUrl: './lineage.component.html',
  styleUrl: './lineage.component.scss',
})
export class LineageComponent implements OnChanges, AfterViewInit, OnDestroy {
  @Input() tasks: ITaskQueue[] = [];
  @Input() agents: IAgent[] = [];
  @Output() clearRequested = new EventEmitter<void>();

  @ViewChildren('row') rows!: QueryList<ElementRef<HTMLElement>>;

  nodes: GraphNode[] = [];
  edges: Edge[] = [];
  lifelines: Lifeline[] = [];
  cy: number[] = [];
  graphW = 24; graphH = 0;
  private laneW = 20;
  private agentMap = new Map<string, IAgent>();
  private agentLane = new Map<string, number>(); // agent lanes only (user excluded), left-to-right by delegation/appearance
  private sub: any;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: any): void {
    if (changes['agents']) {
      this.agentMap = new Map((this.agents || []).map(a => [a.id, a]));
    }
    if (changes['tasks'] || changes['agents']) {
      this.nodes = this.build(this.tasks || []);
      setTimeout(() => this.measure(), 0);
    }
  }

  ngAfterViewInit(): void {
    this.sub = this.rows.changes.subscribe(() => setTimeout(() => this.measure(), 0));
  }
  ngOnDestroy(): void { this.sub?.unsubscribe?.(); }

  build(list: ITaskQueue[]): GraphNode[] {
    const byId = new Map(list.map(t => [t.id!, t]));
    const chrono = [...list].sort((a, b) => new Date(a.created_at as any).getTime() - new Date(b.created_at as any).getTime() || (a.id ?? 0) - (b.id ?? 0));

    // Independent lane per agent (excluding user), left-to-right by delegation/appearance.
    // e.g. Chief-ugy -> x=10, Bob -> x=30, Pam -> x=50
    this.agentLane = new Map<string, number>();
    const ensureLane = (id: string | undefined | null) => {
      if (!id || id === 'user' || this.agentLane.has(id)) return;
      this.agentLane.set(id, this.agentLane.size);
    };
    for (const t of chrono) {
      ensureLane(t.sender_agent_id);
      ensureLane(t.receiver_agent_id);
    }

    const isProgressTask = (t: ITaskQueue): boolean => {
      const flowName = (t.task_flow || 'direct') as string;
      return flowName === 'delegation_progress' || (t.callback_final === false && !!t.parent_task_callback);
    };
    const isResultTask = (t: ITaskQueue): boolean => {
      const flowName = (t.task_flow || 'direct') as string;
      return flowName === 'delegation_result' || (typeof t.payload === 'string' && t.payload.includes('[DELEGATION RESULT'));
    };
    const findFulfilled = (t: ITaskQueue): ITaskQueue | undefined => {
      let cur: ITaskQueue | undefined = t.parent_task_id ? byId.get(t.parent_task_id) : undefined;
      const seen = new Set<number>();
      while (cur && cur.id != null && !seen.has(cur.id)) {
        seen.add(cur.id);
        // request: sender=requester, receiver=executor -> response: sender=executor, receiver=requester
        if (cur.sender_agent_id === t.receiver_agent_id && cur.receiver_agent_id === t.sender_agent_id) return cur;
        cur = cur.parent_task_id ? byId.get(cur.parent_task_id) : undefined;
      }
      return undefined;
    };

    const depthOf = (t: ITaskQueue, seen = new Set<number>()): number => {
      if (typeof t.depth === 'number') return t.depth;
      if (!t.parent_task_id) return 0; if (t.id != null && seen.has(t.id)) return 0; if (t.id != null) seen.add(t.id);
      const p = byId.get(t.parent_task_id); return p ? 1 + depthOf(p, seen) : 0;
    };

    return chrono.map(t => {
      const depth = depthOf(t);
      const isProgress = isProgressTask(t);
      const isResult = isResultTask(t);
      const fulfilled = findFulfilled(t);
      // Response edge only when this event fulfills a prior request (inverse requester/executor pair).
      const isResponseEdge = !!fulfilled;
      const isFinal = isResponseEdge && isResult && (t.callback_final !== false);
      // Vertex sits on the receiver's agent lane (executor for requests, requester for responses).
      const lane = this.agentLane.get(t.receiver_agent_id || 'user') ?? 0;
      // Lane/node color follows the receiver's lane; edge color follows the sender.
      const color = this.agentColor(t.receiver_agent_id || 'user');
      return { ...t, depth, lane, isReturn: isResponseEdge, isProgress: isResponseEdge && isProgress, isFinal, flow: isResponseEdge ? 'out' : 'in', color, agentLabel: this.label(t.receiver_agent_id) } as GraphNode;
    });
  }

  measure(): void {
    const els = this.rows?.toArray().map(r => r.nativeElement) || [];
    if (!els.length || !this.nodes.length) { this.edges = []; this.lifelines = []; this.cy = []; this.graphW = 24; this.graphH = 0; return; }
    const laneCount = Math.max(1, this.agentLane.size || 1);
    this.graphW = 10 + (laneCount - 1) * this.laneW + 22;
    const tl = (els[0].offsetParent as HTMLElement) || els[0].parentElement;
    const tlTop = tl ? tl.getBoundingClientRect().top : 0;
    this.cy = els.map(el => { const r = el.getBoundingClientRect(); return (r.top - tlTop) + 14; });
    this.graphH = els.reduce((s, el) => s + el.offsetHeight, 8);
    this.edges = this.buildEdges();
    this.lifelines = this.buildLifelines();
    this.cdr.detectChanges();
  }

  cx(n: GraphNode): number { return this.xOf(n.receiver_agent_id || 'user'); }
  private xOf(id: string): number {
    if (!id || id === 'user') return 10; // align user-origin with first agent lane
    return 10 + (this.agentLane.get(id) ?? 0) * this.laneW;
  }

  private buildLifelines(): Lifeline[] {
    const idx = new Map<number, number>();
    this.nodes.forEach((n, i) => { if (n.id != null) idx.set(n.id, i); });
    const findFulfilledNode = (n: GraphNode): GraphNode | null => {
      let curIdx = n.parent_task_id != null ? idx.get(n.parent_task_id) : undefined;
      const seen = new Set<number>();
      while (curIdx != null && !seen.has(curIdx)) {
        seen.add(curIdx);
        const a = this.nodes[curIdx];
        if (a.sender_agent_id === n.receiver_agent_id && a.receiver_agent_id === n.sender_agent_id) return a;
        curIdx = a.parent_task_id != null ? idx.get(a.parent_task_id) : undefined;
      }
      return null;
    };

    const agents = Array.from(this.agentLane.entries()).map(([id, lane]) => ({ id, lane, x: this.xOf(id), color: this.agentColor(id), label: this.label(id) }));
    return agents.map(agent => {
      // Lifeline spans only the agent's actual vertex/activity rows (ends at last participation, e.g. Pam at her final response).
      const indices: number[] = [];
      this.nodes.forEach((n, i) => {
        const actor = n.sender_agent_id === 'user' ? n.receiver_agent_id : n.sender_agent_id; // root user->agent counts at agent
        if (n.receiver_agent_id === agent.id || actor === agent.id) indices.push(i);
      });
      if (!indices.length) return { ...agent, segments: [] as LifelineSegment[] };
      const yStart = this.cy[Math.min(...indices)] || 0;
      const yEnd = this.cy[Math.max(...indices)] || yStart;

      // waiting intervals: agent delegates (request out) until the fulfilling response comes back
      const waits: Array<{ a: number; b: number }> = [];
      this.nodes.forEach((n, i) => {
        if (n.sender_agent_id !== agent.id) return; // request sent by agent
        if (n.receiver_agent_id === agent.id) return;
        const fulfilled = findFulfilledNode(n); // not a response fulfilling a prior request => delegation/request
        if (fulfilled) return;
        // find response that fulfills this request
        for (let j = i + 1; j < this.nodes.length; j++) {
          const r = this.nodes[j];
          if (r.receiver_agent_id !== agent.id) continue;
          const f = findFulfilledNode(r);
          if (f && f.id === n.id) { waits.push({ a: this.cy[i] || 0, b: this.cy[j] || 0 }); break; }
        }
      });

      const boundaries = new Set<number>([yStart, yEnd]);
      waits.forEach(w => { if (w.a >= yStart && w.a <= yEnd) boundaries.add(w.a); if (w.b >= yStart && w.b <= yEnd) boundaries.add(w.b); });
      const ys = Array.from(boundaries).sort((a, b) => a - b);
      const segments: LifelineSegment[] = [];
      for (let k = 0; k < ys.length - 1; k++) {
        const a = ys[k], b = ys[k + 1];
        if (b <= a) continue;
        const mid = (a + b) / 2;
        const waiting = waits.some(w => mid > w.a && mid < w.b);
        segments.push({ y1: a, y2: b, waiting, key: `${agent.id}:${a}-${b}:${waiting ? 'w' : 's'}` });
      }
      if (!segments.length) segments.push({ y1: yStart, y2: yEnd, waiting: false, key: `${agent.id}:solid` });
      return { ...agent, segments };
    }).filter(l => l.segments.length > 0);
  }

  buildEdges(): Edge[] {
    const idx = new Map<number, number>();
    this.nodes.forEach((n, i) => { if (n.id != null) idx.set(n.id, i); });
    const edges: Edge[] = [];
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
    const resolvedProgressSet: Set<number> = new Set();
    this.nodes.filter(n => n.isProgress).forEach(p => {
      if (p.parent_task_id && isClosed(p.parent_task_id as any, new Set())) {
        resolvedProgressSet.add(p.id!);
      }
    });

    const findFulfilledNode = (n: GraphNode): GraphNode | null => {
      let curIdx = n.parent_task_id != null ? idx.get(n.parent_task_id) : undefined;
      const seen = new Set<number>();
      while (curIdx != null && !seen.has(curIdx)) {
        seen.add(curIdx);
        const a = this.nodes[curIdx];
        // request: sender=requester, receiver=executor -> response: sender=executor, receiver=requester
        if (a.sender_agent_id === n.receiver_agent_id && a.receiver_agent_id === n.sender_agent_id) return a;
        curIdx = a.parent_task_id != null ? idx.get(a.parent_task_id) : undefined;
      }
      return null;
    };

    this.nodes.forEach((n, i) => {
      if (n.parent_task_id == null) return;
      const fulfilled = findFulfilledNode(n);
      const isResponseEdge = !!fulfilled;
      let x1: number, y1: number, x2: number, y2: number;
      if (isResponseEdge && fulfilled) {
        const fi = idx.get(fulfilled.id as number); if (fi == null) return;
        // response/progress/final: default fulfilled request vertex -> response vertex
        x1 = this.cx(fulfilled); y1 = this.cy[fi] || 0;
        x2 = this.cx(n); y2 = this.cy[i] || 0;
        // continuity: if this responder received a sub-response after the fulfilled request, chain from that last reception vertex
        // (e.g. Bob final #6 chains from Pam's response #5, not from #2)
        for (let j = i - 1; j > fi; j--) {
          const prev = this.nodes[j];
          if (prev.receiver_agent_id === n.sender_agent_id) {
            const prevFulfilled = findFulfilledNode(prev);
            if (prevFulfilled) { x1 = this.cx(prev); y1 = this.cy[j] || 0; }
            break;
          }
        }
      } else {
        // delegation/request: requester(sender) at parent row -> executor(receiver) at this row
        const pi = idx.get(n.parent_task_id as number);
        if (pi == null) return;
        x1 = this.xOf(n.sender_agent_id || 'user'); y1 = this.cy[pi] || 0;
        x2 = this.xOf(n.receiver_agent_id || 'user'); y2 = this.cy[i] || 0;
      }
      const my = (y1 + y2) / 2;
      const d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
      let dashed = false;
      if (n.isProgress) dashed = !resolvedProgressSet.has(n.id!);
      else if (n.isFinal) dashed = false;
      else dashed = n.task_flow === 'direct' ? !isClosed(n.id!) : false;
      const kind: Edge['kind'] = n.isProgress ? (dashed ? 'return-progress' : 'return-resolved-progress') : (n.isFinal ? 'return-final' : 'down');
      const edgeColor = this.agentColor(n.sender_agent_id || 'user');
      edges.push({ x1, y1, x2, y2, color: edgeColor, kind, d, dashed, key: `${n.parent_task_id}->${n.id}:${kind}:${dashed ? 'd' : 's'}` });
    });

    if (this.nodes.length > 1) {
      const x = 10; const ys = this.cy;
      const idToIndex = new Map<number, number>();
      this.nodes.forEach((n, i) => { if (n.id != null) idToIndex.set(n.id, i); });
      const rootOf = (n: GraphNode): number => {
        let cur = n;
        const seen = new Set<number>();
        while (cur.parent_task_id && idToIndex.has(cur.parent_task_id)) {
          if (seen.has(cur.id as any)) break; seen.add(cur.id as any);
          cur = this.nodes[idToIndex.get(cur.parent_task_id)!];
        }
        return idToIndex.get(cur.id as any) ?? 0;
      };
      const rootEnd = new Map<number, number>();
      this.nodes.forEach((n, i) => {
        const r = rootOf(n);
        const prev = rootEnd.get(r) ?? r;
        rootEnd.set(r, Math.max(prev, i));
      });
      const spineColorAt = (i: number): string => {
        let active: number | null = null;
        for (const [r, end] of rootEnd.entries()) {
          if (r <= i && i <= end) { if (active == null || r > active) active = r; }
        }
        if (active == null) return 'var(--border-color,#334155)';
        const rootNode = this.nodes[active];
        return this.agentColor(rootNode?.receiver_agent_id || '');
      };
      for (let i = ys.length - 2; i >= 0; i--) {
        const color = spineColorAt(i);
        const d = `M ${x} ${ys[i]} L ${x} ${ys[i + 1]}`;
        edges.unshift({ x1: x, y1: ys[i], x2: x, y2: ys[i + 1], color, kind: 'spine', d, dashed: false, key: `spine:${i}:${color}` });
      }
    }
    return edges;
  }

  agentColor(id: string): string {
    const a = this.agentMap.get(id); if ((a as any)?.archived_at) return 'var(--text-muted,#6b7280)'; if (a?.color) return a.color; if (id === 'user') return '#9ca3af';
    let h = 0; for (let i = 0; i < (id || '').length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return `hsl(${h % 360} 65% 55%)`;
  }
  label(id: string): string { if (id === 'user') return 'user'; const a = this.agentMap.get(id); if ((a as any)?.archived_at) return 'Deshabilitado'; return a?.nickname || this.short(id); }
  short(id: string): string { return id ? id.slice(0, 8) : ''; }
  preview(p: string): string { if (!p) return ''; const s = String(p).replace(/\s+/g, ' ').trim(); return s.length > 90 ? s.slice(0, 90) + '…' : s; }

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
      return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
    } catch { return String(d); }
  }

  severity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) { case 'COMPLETED': return 'success'; case 'PROCESSING': return 'info'; case 'HOLD': case 'STOPPED': return 'warn'; case 'PENDING': return 'secondary'; default: return 'contrast'; }
  }

  trackEdge = (_: number, e: Edge) => e.key;

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
    const node = this.nodes.find(n => n.id === id);
    if (!node?.parent_task_id) return false;
    return isClosed(node.parent_task_id, new Set());
  }

  clearLineage(): void { this.clearRequested.emit(); }
}