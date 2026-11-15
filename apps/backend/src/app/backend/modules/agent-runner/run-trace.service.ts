import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { AgentRunLogEntity } from './infra/persistence/sequalize/entities/agent-run-log.schema.js';

interface LogOptions {
  runId: string;
  agentId: string;
  eventType: string;
  eventData?: Record<string, any>;
  taskId?: number | null;
  workspaceId?: string | null;
}

@Injectable()
export class RunTraceService {
  async record(opts: LogOptions): Promise<void> {
    try {
      await AgentRunLogEntity.create({
        run_id: opts.runId,
        agent_id: opts.agentId,
        workspace_id: opts.workspaceId ?? null,
        task_id: opts.taskId ?? null,
        event_type: opts.eventType,
        event_data: opts.eventData ? JSON.stringify(opts.eventData) : null,
        created_at: new Date(),
      } as any);
    } catch (e: any) {
      console.warn('[RunTrace] insert failed:', e?.message || e);
    }
  }

  async start(runId: string, agentId: string, workspaceId: string | null, taskId: number | null): Promise<void> {
    await this.record({ runId, agentId, eventType: 'run_start', taskId, workspaceId });
  }
  async modelSet(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, provider: string, modelId: string): Promise<void> {
    await this.record({ runId, agentId, eventType: 'model_set', taskId, workspaceId, eventData: { provider, modelId } });
  }
  async modelFallback(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, message: string): Promise<void> {
    await this.record({ runId, agentId, eventType: 'model_fallback', taskId, workspaceId, eventData: { message } });
  }
  async modelNotFound(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, reason: string): Promise<void> {
    await this.record({ runId, agentId, eventType: 'model_not_found', taskId, workspaceId, eventData: { reason } });
  }
  async systemPromptApplied(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, isResumed: boolean): Promise<void> {
    await this.record({ runId, agentId, eventType: 'system_prompt_applied', taskId, workspaceId, eventData: { resumed: isResumed } });
  }
  async turnInput(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, phase: 'system' | 'turn', previewLen: number): Promise<void> {
    await this.record({ runId, agentId, eventType: 'turn_input', taskId, workspaceId, eventData: { phase, previewLen } });
  }
  async toolCall(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, toolName: string, argsSummary?: string): Promise<void> {
    await this.record({ runId, agentId, eventType: 'tool_call', taskId, workspaceId, eventData: { toolName, argsPreview: argsSummary?.slice(0, 200) } });
  }
  async toolResult(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, toolName: string, isError?: boolean, resultLen?: number): Promise<void> {
    await this.record({ runId, agentId, eventType: 'tool_result', taskId, workspaceId, eventData: { toolName, isError, resultLen } });
  }
  async thinking(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, deltaLen: number): Promise<void> {
    await this.record({ runId, agentId, eventType: 'thinking', taskId, workspaceId, eventData: { deltaLen } });
  }
  async textOutput(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, deltaLen: number): Promise<void> {
    await this.record({ runId, agentId, eventType: 'text_output', taskId, workspaceId, eventData: { deltaLen } });
  }
  async sessionCreated(runId: string, agentId: string, workspaceId: string | null, sessionId: string): Promise<void> {
    await this.record({ runId, agentId, eventType: 'session_created', workspaceId, eventData: { sessionId } });
  }
  async sessionResumed(runId: string, agentId: string, workspaceId: string | null, sessionId: string): Promise<void> {
    await this.record({ runId, agentId, eventType: 'session_resumed', workspaceId, eventData: { sessionId } });
  }
  async delegationResult(runId: string, agentId: string, workspaceId: string | null, taskId: number | null): Promise<void> {
    await this.record({ runId, agentId, eventType: 'delegation_result', taskId, workspaceId });
  }
  async identityMismatch(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, issue: string): Promise<void> {
    await this.record({ runId, agentId, eventType: 'identity_mismatch_detected', taskId, workspaceId, eventData: { issue } });
  }
  async close(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, outcome: string, stopReason?: string, durationMs?: number, willRetry?: boolean): Promise<void> {
    await this.record({ runId, agentId, eventType: 'run_complete', taskId, workspaceId, eventData: { outcome, stopReason, durationMs, willRetry } });
  }
  async error(runId: string, agentId: string, workspaceId: string | null, taskId: number | null, code: string, message: string): Promise<void> {
    await this.record({ runId, agentId, eventType: 'error', taskId, workspaceId, eventData: { code, message } });
  }

  async listTraces(agentId?: string, taskId?: number, runId?: string, limit = 50): Promise<any[]> {
    const where: any = {};
    if (agentId) where.agent_id = agentId;
    if (taskId !== undefined) where.task_id = taskId;
    if (runId) where.run_id = runId;
    return AgentRunLogEntity.findAll({ where, order: [['id', 'DESC']], limit }).then(r => r.map(x => x.toJSON())) as any;
  }
  async getTrace(runId: string): Promise<any[]> {
    return AgentRunLogEntity.findAll({ where: { run_id: runId }, order: [['id', 'ASC']] }).then(r => r.map(x => x.toJSON())) as any;
  }
  async getStats(workspaceId?: string, agentId?: string): Promise<any> {
    const where: any = {};
    if (workspaceId) where.workspace_id = workspaceId;
    if (agentId) where.agent_id = agentId;
    const rows = await AgentRunLogEntity.findAll({
      attributes: ['event_type', [AgentRunLogEntity.sequelize!.literal('COUNT(*)'), 'count']],
      where: Object.keys(where).length ? where : undefined,
      group: ['event_type'],
    } as any);
    return { byEventType: rows.map((r: any) => ({ event_type: r.get('event_type'), count: parseInt(String(r.get('count')), 10) })) };
  }

  private emptyUsageTotals() {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costFromProvider: false };
  }
  private addUsageTotals(dst: any, src: any) {
    if (!src) return;
    dst.input += Number(src.input || 0);
    dst.output += Number(src.output || 0);
    dst.cacheRead += Number(src.cacheRead || 0);
    dst.cacheWrite += Number(src.cacheWrite || 0);
    dst.totalTokens += Number(src.totalTokens || 0);
    const c = src.cost || {};
    dst.cost.input += Number(c.input || 0);
    dst.cost.output += Number(c.output || 0);
    dst.cost.cacheRead += Number(c.cacheRead || 0);
    dst.cost.cacheWrite += Number(c.cacheWrite || 0);
    dst.cost.total += Number(c.total || 0);
    if (src.costFromProvider || c.totalFromProvider) dst.costFromProvider = true;
  }

  async clearWorkspaceUsage(workspaceId: string): Promise<number> {
    return AgentRunLogEntity.destroy({ where: { workspace_id: workspaceId, event_type: 'run_usage' } as any });
  }

  async getWorkspaceUsage(workspaceId: string): Promise<any> {
    const rows = await AgentRunLogEntity.findAll({
      where: { workspace_id: workspaceId, event_type: 'run_usage' } as any,
      order: [['created_at', 'ASC'], ['id', 'ASC']],
    } as any);
    const overall = this.emptyUsageTotals();
    const byAgent: Record<string, any> = {};
    const byDay: Record<string, any> = {};
    const runs: any[] = [];
    for (const row of rows.map((r: any) => r.toJSON())) {
      let data: any = {};
      try { data = row.event_data ? JSON.parse(row.event_data) : {}; } catch { data = {}; }
      const totals = data.totals || {};
      const agentId = String(row.agent_id || 'unknown');
      const createdAt = row.created_at ? new Date(row.created_at).toISOString() : null;
      const day = createdAt ? createdAt.slice(0, 10) : 'unknown';
      this.addUsageTotals(overall, totals);
      if (!byAgent[agentId]) byAgent[agentId] = { agentId, totals: this.emptyUsageTotals(), runs: 0, turns: 0, lastAt: null, providers: {} as Record<string, boolean> };
      this.addUsageTotals(byAgent[agentId].totals, totals);
      byAgent[agentId].runs += 1;
      byAgent[agentId].turns += Number(data.turns || 0);
      byAgent[agentId].lastAt = createdAt || byAgent[agentId].lastAt;
      if (data.provider) byAgent[agentId].providers[data.provider] = true;
      if (!byDay[day]) byDay[day] = { day, totals: this.emptyUsageTotals(), runs: 0 };
      this.addUsageTotals(byDay[day].totals, totals);
      byDay[day].runs += 1;
      runs.push({
        runId: row.run_id, agentId, workspaceId: row.workspace_id, taskId: row.task_id,
        provider: data.provider, modelId: data.modelId, model: data.model,
        turns: Number(data.turns || 0), outcome: data.outcome || null, stopReason: data.stopReason || null,
        totals, createdAt,
      });
    }
    const agents = Object.values(byAgent).map((a: any) => ({ ...a, providers: Object.keys(a.providers || {}) })).sort((a: any, b: any) => Number(b.totals?.totalTokens || 0) - Number(a.totals?.totalTokens || 0));
    const timeline = Object.values(byDay).sort((a: any, b: any) => String(a.day).localeCompare(String(b.day)));
    return { workspaceId, overall, agents, timeline, runs: runs.slice(-500) };
  }
}
