import { Injectable } from '@angular/core';
import { StreamTextEvent, StreamToolEvent } from '../models/stream.model';

export interface AgentLiveBuffer {
  runId?: string | null;
  text: string;
  thinking: string;
  tools: Array<{ toolName?: string; toolCallId?: string; args?: any; resultSummary?: string; phase?: string }>;
  seq: number;
}

@Injectable({ providedIn: 'root' })
export class LiveStreamCacheService {
  private buffers = new Map<string, AgentLiveBuffer>();

  get(agentId?: string | null): AgentLiveBuffer {
    if (!agentId) return { text: '', thinking: '', tools: [], seq: 0 };
    let b = this.buffers.get(agentId);
    if (!b) { b = { text: '', thinking: '', tools: [], seq: 0 }; this.buffers.set(agentId, b); }
    return b;
  }

  resetRun(agentId: string, runId?: string | null) {
    this.buffers.set(agentId, { runId, text: '', thinking: '', tools: [], seq: 0 });
  }

  clear(agentId?: string | null) {
    if (agentId) this.buffers.delete(agentId);
  }

  clearRun(agentId: string, runId?: string | null) {
    if (!agentId) return;
    const b = this.buffers.get(agentId);
    if (!b) return;
    if (runId && b.runId && runId !== b.runId) return; // stale finished/error
    this.buffers.delete(agentId);
  }

  applyText(ev: StreamTextEvent) {
    if (!ev?.agentId) return;
    const b = this.get(ev.agentId);
    if (ev.runId && b.runId && ev.runId !== b.runId) return; // stale
    if (ev.runId && !b.runId) b.runId = ev.runId;
    if (ev.seq && ev.seq <= b.seq) return;
    if (ev.seq) b.seq = ev.seq;
    if (ev.kind === 'thinking') b.thinking += ev.delta || ''; else b.text += ev.delta || '';
  }

  applyTool(ev: StreamToolEvent) {
    if (!ev?.agentId) return;
    const b = this.get(ev.agentId);
    if (ev.runId && b.runId && ev.runId !== b.runId) return;
    if (ev.runId && !b.runId) b.runId = ev.runId;
    if (ev.seq && ev.seq <= b.seq) return;
    if (ev.seq) b.seq = ev.seq;
    b.tools = [...b.tools, { toolName: ev.toolName, toolCallId: ev.toolCallId, args: ev.args, resultSummary: ev.resultSummary, phase: ev.phase }];
  }
}