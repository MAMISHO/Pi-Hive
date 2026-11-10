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
}
