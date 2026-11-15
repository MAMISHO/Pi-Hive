import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, QueryList, SimpleChanges, ViewChildren } from '@angular/core';
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
  cy: number[] = [];
  graphW = 24; graphH = 0;
  private laneW = 16;
  private agentMap = new Map<string, IAgent>();
  private sub: any;

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
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

    const isProgressTask = (t: ITaskQueue): boolean => {
      const flowName = (t.task_flow || 'direct') as string;
      return flowName === 'delegation_progress' || (t.callback_final === false && !!t.parent_task_callback);
    };
    const isResultTask = (t: ITaskQueue): boolean => {
      const flowName = (t.task_flow || 'direct') as string;
      return flowName === 'delegation_result' || (typeof t.payload === 'string' && t.payload.includes('[DELEGATION RESULT'));
    };
    const isReturnTask = (t: ITaskQueue): boolean => isProgressTask(t) || isResultTask(t) || !!t.parent_task_callback;

    const findFulfilled = (t: ITaskQueue): ITaskQueue | undefined => {
      let cur: ITaskQueue | undefined = t.parent_task_id ? byId.get(t.parent_task_id) : undefined;
      const seen = new Set<number>();
      while (cur && cur.id != null && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.sender_agent_id === t.receiver_agent_id && cur.receiver_agent_id === t.sender_agent_id) return cur;
        cur = cur.parent_task_id ? byId.get(cur.parent_task_id) : undefined;
      }
      return undefined;
    };

    const laneById = new Map<number, number>();
    const getLane = (t: ITaskQueue, seen = new Set<number>()): number => {
      if (t.id != null && laneById.has(t.id)) return laneById.get(t.id)!;
      if (t.id != null) { if (seen.has(t.id)) return 0; seen.add(t.id); }
      let lane = 0;
      if (!t.parent_task_id) {
        lane = 0;
      } else if (isReturnTask(t)) {
        const fulfilled = findFulfilled(t);
        if (fulfilled) {
          const fParent = fulfilled.parent_task_id ? byId.get(fulfilled.parent_task_id) : undefined;
          lane = fParent ? getLane(fParent, seen) : 0;
        } else {
          const p = byId.get(t.parent_task_id);
          lane = p ? getLane(p, seen) : 0;
        }
      } else {
        const p = byId.get(t.parent_task_id);
        lane = (p ? getLane(p, seen) : 0) + 1;
      }
      if (t.id != null) laneById.set(t.id, Math.max(0, lane));
      return Math.max(0, lane);
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
      const isFinal = isResult && (t.callback_final !== false);
      const isReturn = isReturnTask(t);
      const lane = getLane(t);
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

    const resolveAttachParent = (n: GraphNode): GraphNode | null => {
      const start = n.parent_task_id != null ? idx.get(n.parent_task_id) : undefined;
      if (start == null) return null;
      if (n.isReturn || n.parent_task_callback) {
        let curIdx: number | undefined = start;
        const seen = new Set<number>();
        while (curIdx != null && !seen.has(curIdx)) {
          seen.add(curIdx);
          const a = this.nodes[curIdx];
          if (a.sender_agent_id === n.receiver_agent_id && a.receiver_agent_id === n.sender_agent_id) return a;
          curIdx = a.parent_task_id != null ? idx.get(a.parent_task_id) : undefined;
        }
      }
      return this.nodes[start] || null;
    };

    this.nodes.forEach((n, i) => {
      if (!n.parent_task_id) return;
      const parent = resolveAttachParent(n);
      if (!parent) return;
      const pi = idx.get(parent.id as number); if (pi == null) return;
      const x1 = this.cx(parent), y1 = this.cy[pi] || 0;
      const x2 = this.cx(n), y2 = this.cy[i] || 0;
      const my = (y1 + y2) / 2;
      const d = `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
      let dashed = false;
      if (n.isProgress) dashed = !resolvedProgressSet.has(n.id!);
      else if (n.isFinal) dashed = false;
      else dashed = n.task_flow === 'direct' ? !isClosed(n.id!) : false;
      const kind: Edge['kind'] = n.isProgress ? (dashed ? 'return-progress' : 'return-resolved-progress') : (n.isFinal ? 'return-final' : 'down');
      edges.push({ x1, y1, x2, y2, color: n.color, kind, d, dashed, key: `${parent.id}->${n.id}:${kind}:${dashed ? 'd' : 's'}` });
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