import { Injectable } from '@angular/core';
import { StreamTextEvent, StreamToolEvent } from '../models/stream.model';

export interface AgentLiveBuffer {
  runId?: string | null;
  text: string;
  thinking: string;
  tools: Array<{ toolName?: string; toolCallId?: string; args?: any; resultSummary?: string; phase?: string }>;
  seq: number;
  active?: boolean;
}

@Injectable({ providedIn: 'root' })
export class LiveStreamCacheService {
  private buffers = new Map<string, AgentLiveBuffer>();
  private lastFinishedRunId = new Map<string, string>();

  get(agentId?: string | null): AgentLiveBuffer {
    if (!agentId) return { text: '', thinking: '', tools: [], seq: 0, active: false };
    let b = this.buffers.get(agentId);
    if (!b) { b = { text: '', thinking: '', tools: [], seq: 0, active: false }; this.buffers.set(agentId, b); }
    return b;
  }

  resetRun(agentId: string, runId?: string | null) {
    if (runId) this.lastFinishedRunId.delete(agentId);
    this.buffers.set(agentId, { runId, text: '', thinking: '', tools: [], seq: 0, active: true });
  }

  clear(agentId?: string | null) {
    if (agentId) { this.buffers.delete(agentId); this.lastFinishedRunId.delete(agentId); }
  }

  clearRun(agentId: string, runId?: string | null) {
    if (!agentId) return;
    const b = this.buffers.get(agentId);
    const rid = runId || b?.runId || null;
    if (runId && b?.runId && runId !== b.runId) return; // stale finished/error
    if (rid) this.lastFinishedRunId.set(agentId, String(rid));
    this.buffers.set(agentId, { runId: rid, text: '', thinking: '', tools: [], seq: 0, active: false });
  }

  private isStale(agentId: string, runId?: string | null): boolean {
    if (!runId) return false;
    const finished = this.lastFinishedRunId.get(agentId);
    if (finished && finished === runId) return true;
    const b = this.buffers.get(agentId);
    if (b && b.runId && b.runId !== runId) return true;
    if (b && b.active === false && b.runId === runId) return true;
    return false;
  }

  applyText(ev: StreamTextEvent) {
    if (!ev?.agentId) return;
    if (this.isStale(ev.agentId, ev.runId)) return;
    const b = this.get(ev.agentId);
    if (ev.runId && b.runId && b.runId !== ev.runId) {
      // different active run id in buffer but not marked finished: treat as stale for this buffer context
      if (b.active) return;
    }
    if (ev.runId && !b.runId) b.runId = ev.runId;
    if (ev.seq && ev.seq <= b.seq) return;
    if (ev.seq) b.seq = ev.seq;
    b.active = true;
    if (ev.kind === 'thinking') b.thinking += ev.delta || ''; else b.text += ev.delta || '';
  }

  applyTool(ev: StreamToolEvent) {
    if (!ev?.agentId) return;
    if (this.isStale(ev.agentId, ev.runId)) return;
    const b = this.get(ev.agentId);
    if (ev.runId && b.runId && b.runId !== ev.runId) { if (b.active) return; }
    if (ev.runId && !b.runId) b.runId = ev.runId;
    if (ev.seq && ev.seq <= b.seq) return;
    if (ev.seq) b.seq = ev.seq;
    b.active = true;
    b.tools = [...b.tools, { toolName: ev.toolName, toolCallId: ev.toolCallId, args: ev.args, resultSummary: ev.resultSummary, phase: ev.phase }];
  }
}