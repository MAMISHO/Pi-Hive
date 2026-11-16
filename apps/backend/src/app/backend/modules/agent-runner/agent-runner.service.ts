import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { Type } from '@sinclair/typebox';
import { createAgentSession, defineTool, SessionManager, DefaultResourceLoader, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { createHash, randomUUID } from 'crypto';

import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IAgentRepository, IAgentRepositoryToken } from '../agent/domain/repositories/agent-repository.interface.js';
import { ITaskQueue } from '../task-queue/domain/models/task-queue.interface.js';
import { ITaskQueueRepository, ITaskQueueRepositoryToken } from '../task-queue/domain/repositories/task-queue-repository.interface.js';
import { IAgentMemoryRepository, IAgentMemoryRepositoryToken } from '../agent-memory/domain/repositories/agent-memory-repository.interface.js';
import { IWorkspaceRepository, IWorkspaceRepositoryToken } from '../workspace/domain/repositories/workspace-repository.interface.js';
import { IdentityResolverService } from './identity-resolver.service.js';
import { PromptBuilderService } from './prompt-builder.service.js';
import { RunTraceService } from './run-trace.service.js';
import { DelegationPlannerService } from './delegation-planner.service.js';
import { DelegationPlanStore } from './delegation-plan.store.js';
import { AppSettingsService } from '../app-settings/app-settings.service.js';
import { NexoPalaceMemoryService } from '../memory-mcp/nexo-palace-memory.service.js';
import { buildReceiverScopedInstruction } from './delegation-instruction.js';
import { detectCopyPasteInstruction } from './delegation-instruction-guard.js';
import { explicitlyRequestsAgent } from './delegation-plan-validation.js';
import { allowedToolsForTaskFlow, buildPlannerRoster, canPlanDelegation, explicitRecipientFromRequest, formatDelegationProgressSummary, selectCallbackInstruction } from './delegation-runtime-policy.js';
import { taskEventEmitter } from '../task-queue/infra/persistence/sequalize/entities/task-queue.schema.js';
import { AgentStatus } from '../agent/domain/models/agent-status.enum.js';
import { AgentSessionHistoryEntity } from '../session-history/infra/persistence/sequalize/entities/agent-session-history.schema.js';
import { AgentChatEventEntity } from '../chat-transcript/infra/persistence/sequalize/entities/agent-chat-event.schema.js';

export const agentEventEmitter = new EventEmitter();

@Injectable()
export class AgentRunnerService implements OnModuleInit {
  private activeSessions = new Map<string, AgentSession>();
  private processingAgents = new Set<string>();
  private pendingByAgent = new Map<string, ITaskQueue[]>();
  private currentTaskByAgent = new Map<string, number>();
  private systemPromptInjected = new Set<string>();
  private systemPromptHashByAgent = new Map<string, string>(); // avoid reapplying unchanged system prompt on resumed sessions
  private cachedRuntime: any = null;
  private cachedRuntimeAgentDir: string | null = null;

  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
    @Inject(ITaskQueueRepositoryToken) private taskQueueRepository: ITaskQueueRepository,
    @Inject(IAgentMemoryRepositoryToken) private agentMemoryRepository: IAgentMemoryRepository,
    @Inject(IWorkspaceRepositoryToken) private workspaceRepository: IWorkspaceRepository,
    @Inject(IdentityResolverService) private identityResolverService: IdentityResolverService,
    @Inject(PromptBuilderService) private promptBuilder: PromptBuilderService,
    @Inject(RunTraceService) private trace: RunTraceService,
    @Inject(DelegationPlannerService) private delegationPlanner: DelegationPlannerService,
    @Inject(DelegationPlanStore) private planStore: DelegationPlanStore,
    private readonly appSettings: AppSettingsService,
    @Optional() @Inject(NexoPalaceMemoryService) private readonly memoryService?: NexoPalaceMemoryService,
  ) {
    console.log('[AgentRunner] constructed');
  }

  private emitQueueState(agentId: string, workspaceId?: string | null) {
    const q = this.pendingByAgent.get(agentId) || [];
    const currentTaskId = this.currentTaskByAgent.get(agentId) ?? null;
    const items = q.map((t: any) => ({
      taskId: t.id,
      sender_agent_id: t.sender_agent_id,
      preview: String(t.payload || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      task_flow: t.task_flow || 'direct',
      callback_final: t.callback_final ?? null,
      created_at: t.created_at,
      parent_task_id: t.parent_task_id ?? null,
      plan_ref: t.plan_ref ?? null,
    }));
    agentEventEmitter.emit('agent:queue:updated', {
      agentId, workspaceId: workspaceId ?? null, currentTaskId,
      pendingCount: q.length, pendingTaskIds: q.map(t => t.id), items, emittedAt: Date.now(),
    });
  }

  private emitStatus(agentId: string, status: string, workspaceId?: string | null, taskId?: number | null, runId?: string | null, reason?: string) {
    agentEventEmitter.emit('agent:status-change', { agentId, workspaceId: workspaceId ?? null, status, taskId: taskId ?? null, runId: runId ?? null, reason, emittedAt: Date.now() });
  }

  private async resolveAgentModel(agent: IAgent): Promise<{ ok: true; provider: string; modelId: string; raw: string; model: any; runtime: any } | { ok: false; raw?: string; provider?: string; modelId?: string; reason: string }> {
    const raw = String((agent as any)?.task_state?.model || '').trim();
    if (!raw) return { ok: false, reason: 'agent.task_state.model is not set' };
    const idx = raw.indexOf('/');
    const provider = idx >= 0 ? raw.slice(0, idx) : '';
    const modelId = idx >= 0 ? raw.slice(idx + 1) : raw;
    if (!provider || !modelId) return { ok: false, raw, provider, modelId, reason: `invalid model '${raw}' (expected provider/modelId)` };
    try {
      let agentDir = '';
      try { agentDir = await this.appSettings.resolvePiAgentDir(); } catch { agentDir = path.join(process.cwd(), 'data', 'pi-agent'); }
      agentDir = path.resolve(agentDir);

      const loadRuntime = async () => {
        const pi = await import('@earendil-works/pi-coding-agent') as any;
        const cwd = process.cwd();
        if (typeof pi.createAgentSessionServices === 'function') {
          const settingsManager = pi.SettingsManager?.create ? pi.SettingsManager.create(cwd, agentDir) : undefined;
          const services = await pi.createAgentSessionServices({ cwd, agentDir, settingsManager });
          return services?.modelRuntime ?? null;
        }
        const opts: any = { refreshOnCreate: false, allowModelNetwork: false, agentDir };
        return await (ModelRuntime as any).create(opts);
      };

      if (!this.cachedRuntime || this.cachedRuntimeAgentDir !== agentDir) {
        this.cachedRuntime = await loadRuntime();
        this.cachedRuntimeAgentDir = agentDir;
      }

      let model = this.cachedRuntime?.getModel?.(provider, modelId) ?? this.cachedRuntime?.getPhysicalModel?.(provider, modelId);
      if (!model) { // retry once with a fresh runtime snapshot (loads packages/extensions/providers like ACP)
        this.cachedRuntime = await loadRuntime();
        this.cachedRuntimeAgentDir = agentDir;
        model = this.cachedRuntime?.getModel?.(provider, modelId) ?? this.cachedRuntime?.getPhysicalModel?.(provider, modelId);
      }
      if (!model) return { ok: false, raw, provider, modelId, reason: `model not found in Pi runtime: ${provider}/${modelId}` };
      return { ok: true, provider, modelId, raw, model, runtime: this.cachedRuntime };
    } catch (e: any) {
      this.cachedRuntime = null;
      this.cachedRuntimeAgentDir = null;
      return { ok: false, raw, provider, modelId, reason: `ModelRuntime error: ${e?.message || e}` };
    }
  }

  async stopAgent(agentId: string, opts?: { reason?: string; notifySender?: boolean }): Promise<boolean> {
    const reason = opts?.reason || 'user_stop';
    const notifySender = opts?.notifySender ?? false; // default: do NOT wake delegator on manual stop
    console.log(`[AgentRunner] stopAgent ${agentId} reason=${reason}`);
    const session = this.activeSessions.get(agentId);
    let stoppedSomething = !!session;
    if (session) {
      try { await session.abort(); } catch (e) { console.error(`[AgentRunner] Error aborting ${agentId}:`, e); }
      this.activeSessions.delete(agentId);
    }

    // Drain in-memory queue so handlePendingTask's finally won't auto-dispatch next
    const queued = this.pendingByAgent.get(agentId) || [];
    this.pendingByAgent.set(agentId, []);
    for (const t of queued) {
      try {
        const fresh = await this.taskQueueRepository.get(t.id);
        if (fresh && fresh.status === 'PENDING') {
          fresh.status = 'STOPPED' as any;
          (fresh as any).response = '⏹️ Detenida por intervención del usuario (cola cancelada).';
          await this.taskQueueRepository.update(fresh);
          stoppedSomething = true;
        }
      } catch {}
    }

    // Mark current in-flight task STOPPED (executeTask will also finalize idempotently; this covers races/no-session cases)
    const currentTaskId = this.currentTaskByAgent.get(agentId);
    if (currentTaskId) {
      try {
        const ct = await this.taskQueueRepository.get(currentTaskId);
        if (ct && (ct.status === 'PROCESSING' || ct.status === 'PENDING')) {
          ct.status = 'STOPPED' as any;
          (ct as any).response = '⏹️ Solicitud detenida por intervención del usuario (stop).';
          await this.taskQueueRepository.update(ct);
          stoppedSomething = true;
          if (notifySender && ct.sender_agent_id && ct.sender_agent_id !== 'user') {
            try { await this.taskQueueRepository.add({ sender_agent_id: agentId, receiver_agent_id: ct.sender_agent_id, payload: `[STOP] tarea #${ct.id} detenida (${reason}).`, status: 'PENDING' as any, parent_task_id: ct.id, workspace_id: (ct as any).workspace_id, created_at: new Date() } as any); } catch {}
          }
        }
      } catch {}
      this.currentTaskByAgent.delete(agentId);
    }

    const agent = await this.agentRepository.get(agentId);
    if (agent) {
      agent.status = AgentStatus.IDLE;
      await this.agentRepository.update(agent); // mapper preserves archived_at
      this.emitStatus(agent.id, AgentStatus.IDLE, (agent as any).workspace_id, currentTaskId ?? null, null, reason);
      this.emitQueueState(agent.id, (agent as any).workspace_id);
      agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId: (agent as any).workspace_id, taskId: currentTaskId ?? null, runId: null, outcome: 'stopped', stopReason: reason, aborted: true, willRetry: false, emittedAt: Date.now() });
    }
    return stoppedSomething || !!agent;
  }

  async onModuleInit() {
    console.log('[AgentRunner] init: listening for task:pending');
    taskEventEmitter.on('task:pending', (task: ITaskQueue) => {
      console.log(`[AgentRunner] event task:pending id=${(task as any).id} -> ${(task as any).receiver_agent_id}`);
      this.handlePendingTask(task).catch((err) => console.error('Error handling pending task:', err));
    });
    agentEventEmitter.on('agent:stop', (payload: any) => { const agentId = typeof payload === 'string' ? payload : payload?.agentId; if (agentId) this.stopAgent(agentId, { reason: payload?.reason || 'user_stop', notifySender: !!payload?.notifySender }).catch(console.error); });
    agentEventEmitter.on('agent:session:clear', (agentId: string) => { this.clearAgentSession(agentId).catch(console.error); });
    agentEventEmitter.on('agent:session:compact', (agentId: string) => { this.compactAgentSession(agentId).catch(console.error); });
    agentEventEmitter.on('agent:session:resume', (agentId: string) => { this.refreshSystemPrompt(agentId).catch(console.error); });
    agentEventEmitter.on('agent:thinking-level:changed', (payload: any) => {
      const agentId = payload?.agentId; const level = payload?.thinkingLevel;
      if (!agentId || !level) return;
      const session = this.activeSessions.get(agentId);
      if (session && typeof (session as any).setThinkingLevel === 'function') {
        try { (session as any).setThinkingLevel(level); } catch (e) { console.warn('[AgentRunner] setThinkingLevel failed', agentId, level, e); }
      }
    });
    try {
      try { const stuck = await this.taskQueueRepository.findByStatus('PROCESSING' as any); for (const t of stuck) { t.status = 'PENDING' as any; await this.taskQueueRepository.update(t); console.log(`[AgentRunner] recovered stuck PROCESSING task ${t.id}`); } } catch (e) { console.warn('[AgentRunner] recover stuck failed', e); }
      const pending = await this.taskQueueRepository.findByStatus('PENDING');
      console.log(`[AgentRunner] startup: ${pending.length} pending tasks`);
      for (const task of pending) this.handlePendingTask(task).catch(console.error);
    } catch (err) { console.error('Error loading pending tasks:', err); }
  }

  private isCallbackFlow(task: any): boolean {
    return task?.task_flow === 'delegation_result' || task?.task_flow === 'delegation_progress';
  }

  private async isCallbackAtUserRoot(task: ITaskQueue, agentId: string): Promise<boolean> {
    let current: any = task;
    const seen = new Set<number>();
    for (let i = 0; i < 16 && current?.parent_task_id; i++) {
      const parentId = Number(current.parent_task_id);
      if (!Number.isFinite(parentId) || seen.has(parentId)) break;
      seen.add(parentId);
      current = await this.taskQueueRepository.get(parentId).catch(() => null);
      if (!current) break;
      if ((current.task_flow || 'direct') === 'direct' && current.receiver_agent_id === agentId) {
        return current.sender_agent_id === 'user';
      }
    }
    return false;
  }

  private async handlePendingTask(task: ITaskQueue): Promise<void> {
    console.log(`[AgentRunner] handlePending id=${task.id} receiver=${task.receiver_agent_id} status=${task.status} flow=${(task as any).task_flow} depth=${(task as any).depth ?? 0}`);
    if (task.status !== 'PENDING') return;
    const agentId = task.receiver_agent_id;
    const workspaceId = (task as any).workspace_id;
    if (this.processingAgents.has(agentId)) {
      const q = this.pendingByAgent.get(agentId) || [];
      if (!q.find((t) => t.id === task.id)) {
        // callback-first priority: delegation callbacks (result/progress) go to the front, others FIFO
        if (this.isCallbackFlow(task as any)) q.unshift(task);
        else q.push(task);
        this.pendingByAgent.set(agentId, q);
      }
      this.emitQueueState(agentId, workspaceId);
      return;
    }
    this.processingAgents.add(agentId);
    try {
      await this.executeTask(task);
    } finally {
      this.processingAgents.delete(agentId);
      const q = this.pendingByAgent.get(agentId) || [];
      // dispatch callback-first
      q.sort((a: any, b: any) => (this.isCallbackFlow(a) ? 0 : 1) - (this.isCallbackFlow(b) ? 0 : 1));
      const next = q.shift();
      this.pendingByAgent.set(agentId, q);
      this.emitQueueState(agentId, workspaceId);
      // only dispatch next if agent wasn't manually stopped (stopAgent drains queue & marks STOPPED)
      const agentNow = await this.agentRepository.get(agentId).catch(() => null);
      if (next && agentNow && agentNow.status !== AgentStatus.PAUSED) {
        const fresh = await this.taskQueueRepository.get(next.id).catch(() => null);
        if (fresh && fresh.status === 'PENDING') this.handlePendingTask(fresh).catch(console.error);
      }
    }
  }

  private applySystemPrompt(session: any, systemPrompt: string): void {
    try {
      const ag = session?.agent;
      if (!ag) return;
      if (typeof ag.setSystemPrompt === 'function') ag.setSystemPrompt(systemPrompt);
      else ag.systemPrompt = systemPrompt;
    } catch (e) { console.warn('[AgentRunner] could not apply systemPrompt', e); }
  }

  async refreshSystemPrompt(agentId: string): Promise<void> {
    const session = this.activeSessions.get(agentId);
    if (!session) return;
    const agent = await this.agentRepository.get(agentId);
    if (!agent) return;
    const availableAgents = await this.identityResolverService.getAvailableAgents(agent.workspace_id || undefined);
    const sp = await this.promptBuilder.buildSystem({ agent, team: availableAgents });
    this.applySystemPrompt(session, sp);
  }

  private async executeTask(task: ITaskQueue): Promise<void> {
    console.log(`[AgentRunner] executeTask task=${task.id}`);
    const agent = await this.agentRepository.get(task.receiver_agent_id);
    if (!agent) return;
    const current = await this.taskQueueRepository.get(task.id);
    if (!current || current.status !== 'PENDING') return;
    task = current;

    if (!agent.workspace_id) {
      task.status = 'HOLD' as any;
      await this.taskQueueRepository.update(task);
      console.warn(`[AgentRunner] Agent ${agent.id} has no workspace; task ${task.id} held.`);
      return;
    }

    const workspaceId = agent.workspace_id;
    task.status = 'PROCESSING' as any;
    (task as any).workspace_id = workspaceId;
    await this.taskQueueRepository.update(task);
    agent.status = AgentStatus.WORKING;
    await this.agentRepository.update(agent);
    this.emitStatus(agent.id, agent.status, workspaceId, task.id, null, 'processing');
    this.currentTaskByAgent.set(agent.id, task.id);
    this.emitQueueState(agent.id, workspaceId);

    const groupId = `task-${task.id}`;
    let currentRequestEventId: number | null = await this.saveChatEvent(workspaceId, agent.id, task, 'INBOUND', 'request', task.payload, groupId).catch(() => null);

    let stopped = false;
    let runId = randomUUID();
    const startedAt = Date.now();
    let finalized = false;
    let sessionForToolLoopAbort: any = null;
    let extensionSessionStarted = false;
    const finalizeOnce = async (fn: () => Promise<void>) => { if (finalized) return; finalized = true; await fn(); };
    try {
      if ((task as any).task_flow === 'delegation_progress') {
        const response = `Progreso registrado para la request #${task.id}; espero el resultado final.`;
        (task as any).response = response;
        task.status = 'COMPLETED' as any;
        await this.taskQueueRepository.update(task);
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', response, groupId, { currentRequestEventId }).catch(() => {});
        agent.status = AgentStatus.IDLE;
        await this.agentRepository.update(agent);
        this.currentTaskByAgent.delete(agent.id);
        this.emitStatus(agent.id, AgentStatus.IDLE, workspaceId, task.id, runId, 'progress_recorded');
        this.emitQueueState(agent.id, workspaceId);
        this.trace.record({ runId, agentId: agent.id, eventType: 'callback_progress_recorded', taskId: task.id, workspaceId,
          eventData: { sender_agent_id: task.sender_agent_id, parent_task_id: task.parent_task_id, depth: (task as any).depth ?? 0 } }).catch(() => {});
        agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId, taskId: task.id, runId, outcome: 'progress_recorded', emittedAt: Date.now() });
        return;
      }
      const workspace = await this.workspaceRepository.get(workspaceId);
      const cwd = (workspace?.path && fs.existsSync(workspace.path)) ? workspace.path : process.cwd();
      const availableAgents = await this.identityResolverService.getAvailableAgents(workspaceId);
      let explicitChiefRecipient = agent.role === 'CHIEF' && task.sender_agent_id === 'user'
        ? explicitRecipientFromRequest(task.payload, availableAgents.filter((a: any) => a.id !== agent.id))
        : null;

      const resolved = await this.resolveAgentModel(agent);
      if (!resolved.ok) {
        const r = resolved as { reason: string; raw?: string };
        const reason = `model_not_found: ${r.reason}`;
        console.warn(`[AgentRunner] ${agent.id} task=${task.id} ${reason}`);
        agentEventEmitter.emit('agent:run:error', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'model_not_found', message: r.reason, emittedAt: Date.now() });
        task.status = 'HOLD' as any;
        (task as any).response = `⚠️ Modelo no resuelto: ${r.reason}. Configura task_state.model (provider/modelId), p.ej. ollama/ornith-1.5:9b-16k-pi.`;
        await this.taskQueueRepository.update(task);
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', (task as any).response, groupId, { currentRequestEventId }).catch(() => {});
        this.trace.modelNotFound(runId, agent.id, workspaceId, task.id, r.reason).catch(() => {});
        this.trace.close(runId, agent.id, workspaceId, task.id, 'model_not_found', r.reason, Date.now() - startedAt, false).catch(() => {});
        agent.status = AgentStatus.IDLE;
        await this.agentRepository.update(agent);
        this.emitStatus(agent.id, agent.status, workspaceId, task.id, runId, 'model_not_found');
        this.currentTaskByAgent.delete(agent.id);
        this.emitQueueState(agent.id, workspaceId);
        return;
      }

      const agentModel = resolved.model;
      const agentRuntime = resolved.runtime;
      const agentModelRaw = resolved.raw;

      const taskQueueRepository = this.taskQueueRepository;
      const workspaceRepository = this.workspaceRepository;
      const agentRepository = this.agentRepository;
      const identityResolverService = this.identityResolverService;
      const delegationPlannerService = this.delegationPlanner;
      const traceService = this.trace;
      const planStore = this.planStore;
      const runCtx = { runId, agentId: agent.id, workspaceId, taskId: task.id };
      const currentTaskId = task.id;
      const senderAgentId = agent.id;
      const parentDepth = Number((task as any).depth ?? 0);
      const parentDepthPath = String((task as any).depth_path || `/root/${agent.nickname}`);
      const flowForTools = (task as any).task_flow || 'direct';
      const isProgressFlowForTools = flowForTools === 'delegation_progress';
      // The planner validates both delegated targets and local step owners; include the caller
      // as an eligible owner while delegate_task itself continues to exclude self-targeting.
      const rosterForPlanner = buildPlannerRoster(agent, availableAgents);

      let delegatedThisRun = false;
      let delegatedProgressSummary = '';
      let delegationPlannedThisRun = false;
      let activePlanRef: number | null = (task as any).plan_ref ?? null;
      let forcedToolLoopStop: string | null = null;
      let lastBlockedDelegationSignature = '';
      let repeatedBlockedDelegationCount = 0;
      const blockPlanDelegation = (signature: string, message: string) => {
        if (signature === lastBlockedDelegationSignature) repeatedBlockedDelegationCount++;
        else { lastBlockedDelegationSignature = signature; repeatedBlockedDelegationCount = 1; }
        if (repeatedBlockedDelegationCount >= 3 && !forcedToolLoopStop) {
          forcedToolLoopStop = `La misma delegación fue bloqueada ${repeatedBlockedDelegationCount} veces. ${message}`;
          traceService.record({ ...runCtx, eventType: 'delegation_tool_loop_stopped', eventData: { target: signature.split('|')[0], repeats: repeatedBlockedDelegationCount, reason: message.slice(0, 240) } }).catch(() => {});
          setTimeout(() => { void sessionForToolLoopAbort?.abort?.().catch?.(() => {}); }, 0);
        }
        return { content: [{ type: 'text' as const, text: repeatedBlockedDelegationCount >= 3 ? `${forcedToolLoopStop} No repitas la llamada; el turno se cerrará en estado HOLD para reintento.` : message }], details: { taskId: 0, blocked: true, repeated: repeatedBlockedDelegationCount } } as any;
      };

      // Resolve delegation plan state for this branch (optional: absent => normal no-plan flow).
      const resolvePlanRefFromChain = async (): Promise<number | null> => {
        if ((task as any).plan_ref != null) return Number((task as any).plan_ref);
        try {
          let cur: any = task;
          const seen = new Set<number>();
          for (let i = 0; i < 12 && cur; i++) {
            if (cur.plan_ref != null) return Number(cur.plan_ref);
            const pid = cur.parent_task_id ?? null;
            if (!pid || seen.has(Number(pid))) break;
            seen.add(Number(pid));
            cur = await taskQueueRepository.get(Number(pid)).catch(() => null);
          }
        } catch {}
        return null;
      };
      if (activePlanRef == null) activePlanRef = await resolvePlanRefFromChain();
      const loadActivePlan = async () => (activePlanRef != null ? await planStore.get(activePlanRef) : null);
      let activePlan = await loadActivePlan();
      const markPlanProgressOnResult = async () => {
        if (!activePlan || activePlan.state !== 'active' || (task as any).task_flow !== 'delegation_result') return;
        const hasPending = (nodes: any[] | undefined): boolean => {
          if (!nodes) return false;
          for (const n of nodes) { const st = String(n.status || 'PENDING').toUpperCase(); if (st === 'PENDING' || st === 'IN_PROGRESS') return true; if (hasPending(n.children)) return true; }
          return false;
        };
        const hasFailure = (nodes: any[] | undefined): boolean => {
          if (!nodes) return false;
          for (const n of nodes) { const st = String(n.status || '').toUpperCase(); if (st === 'FAILED' || st === 'BLOCKED') return true; if (hasFailure(n.children)) return true; }
          return false;
        };
        const senderNick = String((task as any).sender_agent_id === 'user' ? 'user' : ((await identityResolverService.resolveById?.((task as any).sender_agent_id) as any)?.nickname || ''));
        const norm = (s: string) => String(s || '').trim().toLowerCase();
        // v2 (tree): advance only when the delegated node's target actually returned a FINAL result
        const ownedPending = planStore.collectOwnedPending(activePlan.nodes, agent.nickname, []).filter((n: any) => !['DONE','SKIPPED','FAILED','BLOCKED'].includes(String(n.status || '').toUpperCase()));
        let node = ownedPending.find((n: any) => n.delegate_to && senderNick && norm(n.delegate_to) === norm(senderNick));
        // fallback: single pending owned node (conservative)
        if (!node && ownedPending.length === 1) node = ownedPending[0];
        if (node) {
          if (node.delegate_to && senderNick && norm(node.delegate_to) !== norm(senderNick)) return;
          planStore.markDelegatedBranchDone(node, Number(task.id));
          if (!hasPending(activePlan.nodes)) activePlan.state = hasFailure(activePlan.nodes) ? 'failed' : 'done';
          await planStore.save(activePlan);
          traceService.record({ ...runCtx, eventType: (activePlan.state === 'done' || activePlan.state === 'failed') ? 'plan_closed' : 'plan_step_advanced', eventData: { plan_ref: activePlanRef, node_id: node.id, owner: agent.nickname, result_task: task.id, from: senderNick || null, state: activePlan.state } }).catch(() => {});
        }
      };
      await markPlanProgressOnResult();

      const delegateTaskTool = defineTool({
        name: 'delegate_task',
        label: 'Delegate Task',
        description: 'Delega una tarea a otro agente por nickname EXACTO (solo el alias, p.ej. "Bob"; NO uses "Bob (WORKER)"). Asíncrono: NO esperes/pollees; termina tu turno y el resultado llegará como [DELEGATION RESULT]. En "instruction" pasa SOLO el tramo del agente destino, reescrito en segunda persona: su acción concreta, el dato/entrada que necesita y la condición de entrega. NO copies el plan completo ni incluyas pasos de otros agentes; el tracking va aparte en [PLAN_SLICE]. NO le pidas al receptor reportar al usuario final: su respuesta se te entrega a ti automáticamente. NO uses delegate_task para reportar/informar resultados al solicitante o a quien te delegó: devuelve el resultado en tu respuesta y el runtime lo enruta.',
        parameters: Type.Object({
          target_agent_nickname: Type.String({ description: 'Nickname EXACTO del agente destino (solo alias, ej. "Pam"; sin sufijo de rol)' }),
          instruction: Type.String({ description: 'SOLO el tramo del agente destino (acción, entrada y entrega); NO el plan completo ni pasos de otros' }),
        }),
        async execute(_toolCallId, params) {
          const requestedTarget = String(params.target_agent_nickname || '').trim();
          let boundTarget: IAgent | null = null;
          try {
            const ws = await workspaceRepository.get(workspaceId);
            const bindings = JSON.parse(String((ws as any)?.role_bindings || '{}'));
            const boundId = bindings && typeof bindings === 'object' ? bindings[requestedTarget] : null;
            if (boundId) {
              const candidates = await agentRepository.getByWorkspace(workspaceId);
              boundTarget = candidates.find((candidate: any) => candidate.id === boundId && candidate.archived_at == null) || null;
            }
          } catch { /* malformed/missing bindings preserve nickname resolution */ }
          const target = boundTarget || await identityResolverService.resolveNickname(requestedTarget, workspaceId);
          if (!target) return { content: [{ type: 'text' as const, text: `Agent not found: "${params.target_agent_nickname}". Usa el nickname EXACTO (solo alias, ej. "Bob") de [EQUIPO].` }], details: { taskId: 0 } };
          if (explicitChiefRecipient && target.nickname.toLowerCase() !== explicitChiefRecipient.toLowerCase()) {
            const message = `Destinatario explícito: ${explicitChiefRecipient}. Como Chief, delega el objetivo completo a ese agente; no asumas su identidad ni delegues a otro miembro.`;
            traceService.record({ ...runCtx, eventType: 'chief_recipient_enforced', eventData: { expected: explicitChiefRecipient, attempted: target.nickname } }).catch(() => {});
            return { content: [{ type: 'text' as const, text: message }], details: { taskId: 0, blocked: true, reason: 'explicit_recipient_mismatch', expected: explicitChiefRecipient } } as any;
          }

          // Guards de delegación (state-aware, anti-eco, sin romper continuación):
          // - PROGRESS (intermedio): no delegar ni tocar la subcadena; esperar RESULT final de la request.
          // - RESULT/FINAL (request resuelta): se permite avanzar el plan con el siguiente paso (incluso hacia el emisor del callback si corresponde); nunca re-delegar/rebotar el resultado ya entregado.
          // - En tareas no-callback: no delegar al remitente para "reportar" (el runtime enruta el resultado).
          const flowNow = (task as any).task_flow || 'direct';
          const senderOfThisTask = (task as any).sender_agent_id;
          const isProgressCb = flowNow === 'delegation_progress';
          const isFinalResultCb = flowNow === 'delegation_result' || ((task as any).callback_final === true && !isProgressCb);
          if (isProgressCb) {
            return { content: [{ type: 'text' as const, text: `Callback [DELEGATION PROGRESS] (state=PROGRESS, request en curso): registra el avance y espera el [DELEGATION RESULT] final de esa request/branch; no delegues ni crees tareas en esta subcadena.` }], details: { taskId: 0 } };
          }
          if (!isFinalResultCb && target.id === senderOfThisTask && senderOfThisTask !== 'user') {
            const senderNick = sender?.nickname || params.target_agent_nickname;
            const text = `Delegación bloqueada: ${senderNick} es el remitente de esta solicitud y ya te pidió lo que necesita. No delegues al remitente: crearías una orden nueva y un eco. Responde en ESTE turno, de forma directa y concisa, el dato/acción que ${senderNick} espera de ti; el runtime entregará tu respuesta a ${senderNick} como [DELEGATION RESULT]. Si para completar tu parte necesitas la acción de un TERCERO distinto de ${senderNick}, delega solo a ese tercero.`;
            return { content: [{ type: 'text' as const, text }], details: { taskId: 0, blocked: true, reason: 'reply_to_sender_echo', expected: 'answer_directly', deliver_as: 'delegation_result', sender: senderNick } } as any;
          }
          // F5: depth/cycle guard
          const nextDepth = parentDepth + 1;
          if (nextDepth > 8) {
            return { content: [{ type: 'text' as const, text: `Delegación bloqueada: profundidad máxima alcanzada (depth ${nextDepth}). Resuelve localmente y devuelve el resultado.` }], details: { taskId: 0 } };
          }

          // Plan-aware validation (only when an active structured plan exists for this branch)
          let planDeviation: string | null = null;
          let plannedNodeForDelegation: any | null = null;
          if (activePlanRef != null) {
            const p = await loadActivePlan();
            if (p && p.state === 'active' && p.nodes?.length) {
              const norm = (s: string) => String(s || '').trim().toLowerCase();
              const owned = planStore.collectOwnedPending(p.nodes, agent.nickname, []).filter((n: any) => !['DONE','SKIPPED','FAILED','BLOCKED'].includes(String(n.status || '').toUpperCase()));
              const node = owned[0];
              if (!node) {
                planDeviation = `El tracking (plan_ref=${p.plan_ref}) no tiene nodos pendientes para ${agent.nickname} en este tramo.`;
                return { content: [{ type: 'text' as const, text: `Delegación bloqueada por tracking: ${planDeviation}` }], details: { taskId: 0, blocked: true } } as any;
              }
              if (!node.delegate_to) {
                if (explicitlyRequestsAgent(node.action, target.nickname)) {
                  // Repair a persisted malformed plan only when its own action names this
                  // exact roster agent as the required participant and the worker has
                  // supplied a receiver-scoped instruction. Keep the failure auditable.
                  node.status = 'BLOCKED';
                  node.error = `Plan inválido: la acción requiere a ${target.nickname}, pero delegate_to era null.`;
                  p.state = 'aborted';
                  p.raw_text = planStore.formatCanonicalPlan(p.nodes, p.parada);
                  await planStore.save(p);
                  traceService.record({ ...runCtx, eventType: 'delegation_plan_invalidated', eventData: { plan_ref: p.plan_ref, node_id: node.id, expected: target.nickname, reason: 'explicit_agent_action_missing_delegate' } }).catch(() => {});
                  activePlanRef = null;
                  activePlan = null;
                  (task as any).plan_ref = null;
                  await taskQueueRepository.update(task as any).catch(() => {});
                } else {
                  planDeviation = `El tracking (plan_ref=${p.plan_ref}, nodo ${node.id}) es acción propia de ${agent.nickname} (sin delegación). Ejecuta la acción del nodo y entrega el resultado.`;
                  traceService.record({ ...runCtx, eventType: 'plan_deviation', eventData: { plan_ref: p.plan_ref, node_id: node.id, expected: 'local_action', attempted: target.nickname } }).catch(() => {});
                  return blockPlanDelegation(`${target.nickname}|local_action|${node.id}`, `Delegación bloqueada por tracking: ${planDeviation}`);
                }
              } else if (norm(node.delegate_to) !== norm(target.nickname)) {
                planDeviation = `El tracking (plan_ref=${p.plan_ref}, nodo ${node.id}) exige delegar a "${node.delegate_to}"; intentaste delegar a "${target.nickname}". Ejecuta el nodo indicado (respeta cadena/intermediarios).`;
                traceService.record({ ...runCtx, eventType: 'plan_deviation', eventData: { plan_ref: p.plan_ref, node_id: node.id, expected: node.delegate_to, attempted: target.nickname } }).catch(() => {});
                return blockPlanDelegation(`${target.nickname}|${node.delegate_to}|${node.id}`, `Delegación bloqueada por tracking: ${planDeviation}`);
              } else {
                plannedNodeForDelegation = node;
              }
            }
          }

          if (!plannedNodeForDelegation) {
            const guard = detectCopyPasteInstruction({
              instruction: params.instruction,
              delegatorNickname: agent.nickname,
              targetNickname: target.nickname,
            });
            if (guard.blocked) {
              traceService.record({ ...runCtx, eventType: 'delegation_instruction_blocked', eventData: { target: target.nickname, reasons: guard.reasons } }).catch(() => {});
              return { content: [{ type: 'text' as const, text: guard.message || 'Delegación bloqueada: reescribe solo el tramo del receptor.' }], details: { taskId: 0, blocked: true, reason: 'instruction_role_leak', target: target.nickname, patterns: guard.reasons } } as any;
            }
          }

          const effectivePlanRef = activePlanRef != null ? activePlanRef : ((task as any).plan_ref ?? null);
          const nextDepthCapped = Math.min(nextDepth, 8);
          const nextBranch = `${parentDepthPath}/${target.nickname}`;
          const originForHeader = originCtx?.origin;
          const originTag = originForHeader ? `${originForHeader.nickname}${originForHeader.role ? `(${originForHeader.role})` : ''}` : 'unknown';
          const rootTag = originCtx?.rootTaskId ? `origin=#${originCtx.rootTaskId}` : `origin=#${task.id}`;
          const reqTag = originCtx?.requestId ? `request=#${originCtx.requestId}` : `request=#${task.id}`;
          const deterministicInstruction = plannedNodeForDelegation
            ? buildReceiverScopedInstruction({
                delegatorNickname: agent.nickname,
                delegatorRole: agent.role,
                targetNickname: target.nickname,
                targetRole: target.role,
                node: plannedNodeForDelegation,
                requester: originCtx?.origin?.nickname || null,
              })
            : null;
          const instructionForTarget = deterministicInstruction ?? params.instruction;
          traceService.record({ ...runCtx, eventType: 'delegation_instruction_selected', eventData: { target: target.nickname, source: deterministicInstruction ? 'plan_node' : 'free_text', plan_ref: effectivePlanRef, node_id: plannedNodeForDelegation?.id || null } }).catch(() => {});
          // attach the deterministic slice/subplan for the delegated agent (partition by depth)
          let planSlice = '';
          if (effectivePlanRef != null) {
            const pForSlice = await loadActivePlan();
            if (pForSlice && pForSlice.nodes?.length) {
              planSlice = '\n\n[PLAN_SLICE · tu parte asignada, todos PENDING, ejecuta en orden el primero pendiente]\n' + planStore.formatForAgent(pForSlice, target.nickname, nextDepthCapped);
            }
          }
          const delegatedPayload = `[DELEGATION | from=${agent.nickname}(${agent.role}, id=${agent.id}) | to=${target.nickname}(${target.role}) | task->new | ${reqTag} | ${rootTag} | parent=#${currentTaskId} | depth=${nextDepthCapped} | branch=${nextBranch} | chain_origin=${originTag}]\n${instructionForTarget}${planSlice}`;
          const newTask = await taskQueueRepository.add({
            sender_agent_id: senderAgentId,
            receiver_agent_id: target.id,
            payload: delegatedPayload,
            status: 'PENDING' as any,
            parent_task_id: currentTaskId,
            workspace_id: workspaceId,
            task_flow: 'direct',
            depth: nextDepthCapped,
            depth_path: nextBranch,
            parent_task_callback: false,
            callback_context: task.payload, // original instruction so the delegator can resume
            plan_ref: effectivePlanRef,
            origin_request_event_id: currentRequestEventId,
            created_at: new Date(),
          } as any);
          delegatedThisRun = true;
          delegatedProgressSummary = formatDelegationProgressSummary(target.nickname, Number(newTask.id));
          return { content: [{ type: 'text' as const, text: `Delegated task ${newTask.id} to ${target.nickname} (depth ${nextDepth}${effectivePlanRef != null ? `, plan_ref ${effectivePlanRef}` : ''}). Recibirás un [DELEGATION RESULT] — NO esperes/pollees; completa tu turno y continúa cuando llegue.` }], details: { taskId: Number(newTask.id) } };
        },
      });

      const planDelegationTool = defineTool({
        name: 'plan_delegation',
        label: 'Plan Delegation',
        description: 'Genera y fija un tracking de ruta (PLAN/PARADA, vinculante y persistente en la rama) para coordinar delegaciones. Úsala cuando la orden requiera coordinación entre agentes: cadena/secuencia de pasos, 2+ agentes involucrados, intermediarios que deben mediar/reenviar (A→B→C y retorno), ida-vuelta o dependencias entre resultados. Cómo adquirirlo: llámala UNA vez al inicio del turno con user_task = la orden/objetivo original COMPLETO; devuelve el tracking a seguir (o un aviso de fallo, en cuyo caso continúas con tu criterio). No la uses para conversación directa, tareas que resuelves tú solo, o durante [DELEGATION PROGRESS].',
        parameters: Type.Object({
          user_task: Type.String({ description: 'Orden/objetivo original completo a planificar (incluye la cadena, intermediarios y resultado esperado)' }),
        }),
        async execute(_toolCallId, params) {
          if (isProgressFlowForTools) {
            return { content: [{ type: 'text' as const, text: 'plan_delegation no disponible durante [DELEGATION PROGRESS] (state=PROGRESS). Registra el avance y espera el [DELEGATION RESULT] final; no planifiques ni delegues en esta subcadena.' }], details: { ok: false } } as any;
          }
          if (delegationPlannedThisRun) {
            return { content: [{ type: 'text' as const, text: 'plan_delegation ya fue invocada en este turno. Usa el tracking obtenido y ejecútalo paso a paso.' }], details: { ok: false } } as any;
          }
          delegationPlannedThisRun = true;
          if (activePlanRef != null) {
            const existing = await loadActivePlan();
            // Reuse only if it's an active v2 plan for this branch; never reuse terminal/legacy plans
            const reusable = !!(existing && existing.state === 'active' && existing.nodes?.length);
            if (reusable) {
              const normalized = planStore.normalizeEntryOwnership(existing!.nodes, agent.nickname);
              if (normalized.wrapped) {
                existing!.nodes = normalized.nodes;
                existing!.raw_text = planStore.formatCanonicalPlan(existing!.nodes, existing!.parada);
                await planStore.save(existing!);
                activePlan = existing;
                traceService.record({ ...runCtx, eventType: 'delegation_plan_entry_normalized', eventData: { plan_ref: activePlanRef, entryWrappers: normalized.wrapped } }).catch(() => {});
              }
              const view = planStore.formatForAgent(existing!, agent.nickname, Number((task as any).depth ?? 0));
              const count = existing!.nodes.length;
              return { content: [{ type: 'text' as const, text: `Ya existe un tracking activo para esta rama (plan_ref=${activePlanRef}). Síguelo paso a paso:\n${view}` }], details: { ok: true, plan_ref: activePlanRef, steps: count } } as any;
            }
            // incompatible/terminal/legacy plan: drop association and create a fresh plan for this task
            activePlanRef = null;
            (task as any).plan_ref = null;
          }
          const plannerInputTask = String(params.user_task || '').trim() || String((task as any).callback_context || task.payload || '').trim();
          try {
            const requesterLabel = (task as any).sender_agent_id === 'user'
              ? 'user (solicitante, NO es agente del roster)'
              : (sender?.nickname ? `${sender.nickname}${sender.role ? ` (${sender.role})` : ''} (solicitante, NO es agente del roster)` : 'solicitante (NO es agente del roster)');
            const res = await delegationPlannerService.planOneShot({
              model: agentModel,
              runtime: agentRuntime,
              userTask: plannerInputTask,
              roster: rosterForPlanner,
              plannerNickname: agent.nickname,
              requesterLabel,
              cwd,
              idleTimeoutMs: 45_000,
              hardMaxMs: 300_000,
            });
            const plannerMs = res.plannerMs ?? 0;
            const plannerModel = agentModelRaw;
            const firstActivityMs = (res as any).firstActivityMs ?? null;
            const reasonDetail = (res as any).reason_detail ?? null;
            const debug = (res as any).debug ?? null;
            if (!res.ok || res.schema !== 'v2' || !Array.isArray(res.nodes) || res.nodes.length === 0) {
              traceService.record({ ...runCtx, eventType: 'delegation_planned', eventData: { ok: false, reason: (res as any).reason || 'invalid_plan', reason_detail: reasonDetail, plannerMs, firstActivityMs, plannerModel, steps: 0, schema: (res as any).schema || null, debug } }).catch(() => {});
              return { content: [{ type: 'text' as const, text: `No se pudo generar el plan de delegación (${(res as any).reason || 'plan inválido'}). Continúa con tu propio criterio: si la tarea requiere coordinación, delega el siguiente paso concreto con nickname exacto e instrucción del tramo del receptor (no el plan completo).` }], details: { ok: false, reason: (res as any).reason, reason_detail: reasonDetail, plannerMs, firstActivityMs, debug } } as any;
            }
            activePlanRef = Number(currentTaskId);
            (task as any).plan_ref = activePlanRef;
            try { await taskQueueRepository.update(task as any); } catch {}
            const normalized = planStore.normalizeEntryOwnership(res.nodes, agent.nickname);
            const planNodes = normalized.nodes;
            const planText = planStore.formatCanonicalPlan(planNodes, res.parada ?? null);
            const countNodes = (nodes: any[]): number => nodes.reduce((sum, node) => sum + 1 + countNodes(node.children || []), 0);
            const countSteps = countNodes(planNodes);
            await planStore.create({
              plan_ref: activePlanRef,
              root_task_id: Number(currentTaskId),
              workspace_id: workspaceId ?? null,
              owner_agent_id: agent.id,
              requester: (task as any).sender_agent_id === 'user' ? 'user' : String((task as any).sender_agent_id || 'unknown'),
              raw_text: planText,
              schema: 'v2',
              nodes: planNodes,
              parada: res.parada ?? null,
              cursor: 0,
              state: 'active',
            });
            activePlan = await loadActivePlan();
            await AgentChatEventEntity.create({
              workspace_id: workspaceId,
              agent_id: agent.id,
              task_id: Number(currentTaskId),
              parent_task_id: task.parent_task_id ?? null,
              request_id: currentRequestEventId,
              direction: 'OUTBOUND',
              kind: 'plan',
              content: planText,
              collapsible_group_id: groupId,
              created_at: new Date(),
            } as any).catch(() => {});
            traceService.record({ ...runCtx, eventType: 'delegation_planned', eventData: { ok: true, plannerMs, firstActivityMs, plannerModel, steps: countSteps, schema: 'v2', plan_ref: activePlanRef, structured: true, entryWrappers: normalized.wrapped, debug } }).catch(() => {});
            const view = activePlan ? planStore.formatForAgent(activePlan, agent.nickname, Number((task as any).depth ?? 0)) : planText;
            return { content: [{ type: 'text' as const, text: `Delegation tracking (sigue este plan; respeta PARADA; todos los nodos inician PENDING):\n${view}` }], details: { ok: true, plan_ref: activePlanRef, steps: countSteps, schema: 'v2', plannerMs, firstActivityMs, debug } } as any;
          } catch (e: any) {
            traceService.record({ ...runCtx, eventType: 'delegation_planned', eventData: { ok: false, reason: e?.message || String(e), reason_detail: 'tool_exception', plannerModel: agentModelRaw } }).catch(() => {});
            return { content: [{ type: 'text' as const, text: `Fallo al planificar delegación (${e?.message || e}). Continúa con tu propio criterio y delega con nicknames exactos si hace falta.` }], details: { ok: false, reason: e?.message || String(e), reason_detail: 'tool_exception' } } as any;
          }
        },
      });

      const isDelegationResult = (task as any).task_flow === 'delegation_result';
      const isDelegationProgress = (task as any).task_flow === 'delegation_progress';
      const isDelegationCallback = isDelegationResult || isDelegationProgress;
      let isResumed = false;
      let sessionManager: any;
      if (!isDelegationCallback && agent.current_session_id && fs.existsSync(agent.current_session_id)) {
        sessionManager = SessionManager.open(agent.current_session_id);
        isResumed = true;
        console.log(`[AgentRunner] resuming session ${agent.current_session_id}`);
      } else {
        const sessionDir = path.join(process.cwd(), 'data', 'sessions', workspaceId, agent.id);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        sessionManager = SessionManager.create(cwd, sessionDir);
        console.log(`[AgentRunner] created session in ${sessionDir}`);
      }

      if (isDelegationCallback && agent.current_session_id) {
        this.trace.record({ runId, agentId: agent.id, eventType: 'callback_session_rotated', taskId: task.id, workspaceId,
          eventData: { priorSessionDiscardedFromContext: true, flow: (task as any).task_flow } }).catch(() => {});
      }
      const senderAgent = (task as any).sender_agent_id && (task as any).sender_agent_id !== 'user'
        ? await this.identityResolverService.resolveById?.((task as any).sender_agent_id) ?? (await this.identityResolverService.getAvailableAgents(workspaceId)).find((a: any) => a.id === (task as any).sender_agent_id) ?? null
        : null;
      const sender = (task as any).sender_agent_id === 'user'
        ? { nickname: 'user', role: 'USER', id: 'user' }
        : senderAgent ? { nickname: senderAgent.nickname, role: senderAgent.role, id: senderAgent.id } : { nickname: String((task as any).sender_agent_id || 'desconocido'), role: '', id: String((task as any).sender_agent_id || '') };

      // Resolve chain origin (root requester/context) so deep agents know who ultimately requested this.
      const resolveOriginContext = async () => {
        try {
          let cur: any = task;
          const seen = new Set<number>();
          let root: any = task;
          for (let i = 0; i < 20 && cur; i++) {
            root = cur;
            const pid = cur.parent_task_id ?? null;
            if (!pid || seen.has(Number(pid))) break;
            seen.add(Number(pid));
            const p = await taskQueueRepository.get(Number(pid)).catch(() => null);
            if (!p) break;
            cur = p;
          }
          const rootTask: any = root || task;
          const rootSenderId = String(rootTask.sender_agent_id || '');
          let origin: { nickname: string; role?: string; id?: string; rootTaskId?: number | null; rootUserPayload?: string | null };
          if (rootSenderId === 'user') {
            origin = { nickname: 'user', role: 'USER', id: 'user', rootTaskId: Number(rootTask.id), rootUserPayload: String(rootTask.payload || '') };
          } else {
            const oa = await this.identityResolverService.resolveById?.(rootSenderId) ?? (await this.identityResolverService.getAvailableAgents(workspaceId)).find((a: any) => a.id === rootSenderId) ?? null;
            origin = oa
              ? { nickname: oa.nickname, role: oa.role, id: oa.id, rootTaskId: Number(rootTask.id), rootUserPayload: String(rootTask.payload || '') }
              : { nickname: rootSenderId || 'desconocido', role: '', id: rootSenderId, rootTaskId: Number(rootTask.id), rootUserPayload: String(rootTask.payload || '') };
          }
          // request id: nearest "direct" request in this branch (best-effort)
          let reqId: number | null = null;
          try {
            let c: any = task; const s2 = new Set<number>();
            for (let i = 0; i < 20 && c; i++) {
              const flow = (c as any).task_flow || 'direct';
              if (flow === 'direct' && c.receiver_agent_id === agent.id) { reqId = Number(c.id); break; }
              if ((c as any).task_flow === 'direct' && reqId == null) reqId = Number(c.id);
              const pid = c.parent_task_id ?? null; if (!pid || s2.has(Number(pid))) break; s2.add(Number(pid));
              c = await taskQueueRepository.get(Number(pid)).catch(() => null);
            }
          } catch {}
          if (reqId == null) reqId = Number(rootTask.id);
          return { origin, requestId: reqId, rootTaskId: Number(rootTask.id) };
        } catch {
          return { origin: sender, requestId: Number(task.id), rootTaskId: Number(task.id) } as any;
        }
      };
      const originCtx = await resolveOriginContext();
      const callbackAtUserRoot = isDelegationResult ? await this.isCallbackAtUserRoot(task, agent.id) : false;
      activePlan = await loadActivePlan();
      const callbackFinalFlag = (task as any).callback_final;
      const isRootFinalCallback = agent.role === 'CHIEF' && callbackAtUserRoot && isDelegationResult
        && (callbackFinalFlag === true || callbackFinalFlag === 1 || callbackFinalFlag === '1')
        && (!activePlan || activePlan.state !== 'active');
      if (isRootFinalCallback && !explicitChiefRecipient && sender?.role !== 'USER') {
        // A no-plan root result belongs to the agent that just closed this branch.
        // Audits may request a correction there; they must not bypass it to reopen
        // already completed sub-delegations.
        explicitChiefRecipient = sender?.nickname || null;
      }
      const activePlanBlock = activePlan
        ? (activePlan.schema === 'v2' ? planStore.formatForAgent(activePlan, agent.nickname, Number((task as any).depth ?? 0)) : planStore.formatForPrompt(activePlan))
        : null;
      const terminalWorkerResult = agent.role !== 'CHIEF' && isDelegationResult
        && (callbackFinalFlag === true || callbackFinalFlag === 1 || callbackFinalFlag === '1')
        && !!activePlan && activePlan.state !== 'active';
      const memoryWorkspace = await this.workspaceRepository.get(workspaceId);
      const memoryState = this.memoryService ? await this.memoryService.isMemoryEffective(agent, memoryWorkspace as any) : null;
      const memoryEffective = !!memoryState?.effective && !terminalWorkerResult;
      if (memoryState) {
        this.trace.record({ runId, agentId: agent.id, eventType: 'memory_state', taskId: task.id, workspaceId,
          eventData: { effective: memoryState.effective, reason: memoryState.reason, globalEnabled: memoryState.globalEnabled, configured: memoryState.configured, available: memoryState.available, workspaceEnabled: memoryState.workspaceEnabled, agentEnabled: memoryState.agentEnabled } }).catch(() => {});
      }
      const memoryToolNamesSeed = memoryEffective ? ['memory_query', 'memory_trace', 'memory_status', 'memory_path'] : [];
      let memoryToolNames = [...memoryToolNamesSeed];
      let systemPrompt = await this.promptBuilder.buildSystem({ agent, team: availableAgents, memoryEffective, memoryToolNames });
      let systemPromptHash = createHash('sha1').update(String(systemPrompt || '')).digest('hex');
      const hasInjectedContext = !!String(systemPrompt || '').trim();
      // Skip reapplying/persisting an unchanged system prompt on resumed sessions (Pi session already has context).
      const systemChanged = this.systemPromptHashByAgent.get(agent.id) !== systemPromptHash;
      // Abrupt-stop resume with a plain "continue/continúa/..." nudge: ultra-minimal turn, no extra agent orders.
      const continueIntent = isResumed && !isDelegationCallback && !!this.systemPromptInjected.has(agent.id) && !systemChanged
        && typeof (this.promptBuilder as any).isContinuationIntent === 'function'
        && (this.promptBuilder as any).isContinuationIntent(task.payload);
      const promptText = await this.promptBuilder.build({
        agent,
        taskPayload: task.payload,
        team: availableAgents,
        isResumed,
        isDelegationResult,
        isDelegationProgress,
        callbackContext: (task as any).callback_context ?? null,
        sender,
        depth: Number((task as any).depth ?? 0),
        depthPath: (task as any).depth_path ?? null,
        planRef: activePlanRef ?? null,
        planBlock: activePlanBlock,
        origin: originCtx?.origin ?? null,
        taskId: Number(task.id),
        requestId: originCtx?.requestId ?? null,
        // degrade strong reminders in hot routine turns (resumed, direct, no plan/callback change, unchanged system)
        minimalTurn: continueIntent || (isResumed && !isDelegationCallback && !activePlanBlock && !!this.systemPromptInjected.has(agent.id) && !systemChanged),
        continueIntent,
        isRootUserCallback: callbackAtUserRoot,
        isRootFinalCallback,
      });
      const promptSections = {
        system: String(systemPrompt || ''),
        turn: promptText,
        task: String(task.payload || ''),
        callback: isDelegationCallback ? String((task as any).callback_context || '') : '',
        plan: String(activePlanBlock || ''),
      };
      const promptSize = this.promptBuilder.promptStats(promptSections);
      this.trace.record({ runId, agentId: agent.id, eventType: 'prompt_size', taskId: task.id, workspaceId,
        eventData: { estimateMethod: 'ceil(chars/4)', sections: promptSize,
          totalEstimatedTokens: Math.ceil((String(systemPrompt || '').length + promptText.length) / 4) } }).catch(() => {});
      this.trace.record({ runId, agentId: agent.id, eventType: 'session', taskId: task.id, workspaceId, eventData: { resumedSession: isResumed, sessionId: agent.current_session_id || null, cwd, depth: (task as any).depth ?? 0, depth_path: (task as any).depth_path ?? null } }).catch(() => {});
      this.trace.record({ runId, agentId: agent.id, eventType: 'model', taskId: task.id, workspaceId, eventData: { provider: resolved.provider, modelId: resolved.modelId, raw: resolved.raw } }).catch(() => {});
      if (isDelegationCallback) this.trace.record({ runId, agentId: agent.id, eventType: 'callback_received', taskId: task.id, workspaceId, eventData: {
        parent_task_id: task.parent_task_id, depth: (task as any).depth ?? 0, flow: (task as any).task_flow,
        final: (task as any).callback_final ?? null, finalAtUserRoot: isRootFinalCallback, planState: activePlan?.state ?? null,
      } }).catch(() => {});
      console.log(`[AgentRunner] system prompt resolved for ${agent.nickname} (resumed=${isResumed}, callback=${(task as any).task_flow}, depth=${(task as any).depth ?? 0}, sysChanged=${systemChanged})`);
      this.trace.modelSet(runId, agent.id, workspaceId, task.id, resolved.provider, resolved.modelId).catch(() => {});
      agentEventEmitter.emit('agent:run:model', { runId, agentId: agent.id, taskId: task.id, state: 'ready', provider: resolved.provider, modelId: resolved.modelId, emittedAt: Date.now() });
      this.trace.start(runId, agent.id, workspaceId, task.id).catch(() => {});
      if (isDelegationCallback) this.trace.delegationResult(runId, agent.id, workspaceId, task.id).catch(() => {});
      this.trace[isResumed ? 'sessionResumed' : 'sessionCreated'](runId, agent.id, workspaceId, String((sessionManager as any)?.getSessionFile?.() || '')).catch(() => {});
      this.trace.turnInput(runId, agent.id, workspaceId, task.id, 'turn', promptText.length).catch(() => {});

      const skipSystemReapply = isResumed && !!this.systemPromptInjected.has(agent.id) && !systemChanged;
      if (isResumed) {
        this.systemPromptInjected.add(agent.id);
      } else if (!this.systemPromptInjected.has(agent.id)) {
        if (hasInjectedContext) {
          // systemPrompt already includes agent additional_instruction (PromptBuilder.buildSystem); do not append it again.
          const ctx = `[SYSTEM CONTEXT · injected by Pi-Hive]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${workspaceId}).\n\n${systemPrompt}`;
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'system_prompt', ctx, `system-${agent.id}-${Date.now()}`, { currentRequestEventId }).catch(() => {});
        }
        this.systemPromptInjected.add(agent.id);
      } else if (!isResumed && !isDelegationCallback) {
        // first task of new session but injection marker missing in-memory (e.g. after restart) - re-inject visibly once
        if (hasInjectedContext) {
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'system_prompt', `[SYSTEM CONTEXT · injected by Pi-Hive]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${workspaceId}).\n\n${systemPrompt}`, `system-${agent.id}-${Date.now()}`, { currentRequestEventId }).catch(() => {});
        }
        this.systemPromptInjected.add(agent.id);
      }
      if (systemChanged) this.systemPromptHashByAgent.set(agent.id, systemPromptHash);
      this.trace.systemPromptApplied(runId, agent.id, workspaceId, task.id, isResumed).catch(() => {});
      let resourceLoader: any = undefined;
      let agentDir = '';
      try { agentDir = await this.appSettings.resolvePiAgentDir(); } catch { agentDir = path.join(process.cwd(), 'data', 'pi-agent'); }
      try {
        // Pi owns MCP configuration; only include the optional memory server when this
        // agent is effectively enabled. Other Pi MCP servers keep their configured behavior.
        const memoryMcpOptions = this.memoryService
          ? await this.memoryService.resourceLoaderOptions(memoryEffective && !terminalWorkerResult)
          : {};
        resourceLoader = new (DefaultResourceLoader as any)({ cwd, agentDir, systemPrompt, ...memoryMcpOptions });
        // createAgentSession does not reload a caller-supplied ResourceLoader. Load extensions
        // here so Pi's MCP extension can read Pi's mcp.json and register its session tools.
        await resourceLoader.reload();
      } catch (e) {
        console.warn('[AgentRunner] Pi MCP resource loader failed; disabling MCP for this session to preserve memory preferences.', e);
        try {
          resourceLoader = new (DefaultResourceLoader as any)({ cwd, agentDir, systemPrompt, disabledBuiltinExtensions: ['mcp'] });
          await resourceLoader.reload();
        } catch (fallbackError) {
          console.warn('[AgentRunner] DefaultResourceLoader unavailable; using prompt injection', fallbackError);
        }
      }
      console.log(`[AgentRunner] prompt built (sys=${systemPrompt.length}, task=${promptText.length}), creating AgentSession model=${resolved.raw}...`);
      // Expose all Pi tools (built-in + custom + configured MCP/extensions) to every agent/session.
      const planningAllowed = canPlanDelegation({ flow: flowForTools, planState: activePlan?.state, explicitlyAddressedRecipient: !!explicitChiefRecipient });
      const sessionTools = allowedToolsForTaskFlow(flowForTools, agent.role, planningAllowed, terminalWorkerResult);
      const customTools = [delegateTaskTool, planDelegationTool];
      this.trace.record({ runId, agentId: agent.id, eventType: 'session_tools_configured', taskId: task.id, workspaceId,
        eventData: { taskFlow: flowForTools, role: agent.role, tools: sessionTools, customTools: customTools.map((tool: any) => tool.name), planningAllowed, activePlanState: activePlan?.state ?? null, terminalWorkerResult, memoryEffective } }).catch(() => {});
      const sessionOpts: any = { sessionManager, cwd, tools: sessionTools,
        customTools,
        modelRuntime: resolved.runtime, model: resolved.model };
      if (resourceLoader) sessionOpts.resourceLoader = resourceLoader;
      const { session, modelFallbackMessage } = await createAgentSession(sessionOpts) as any;
      sessionForToolLoopAbort = session;
      // SDK-created sessions do not start extensions until the host binds them.
      // Bind in non-interactive RPC mode so Pi's configured MCP servers (including
      // optional memory) connect before the first prompt/tool discovery.
      await session.bindExtensions({ mode: 'rpc' });
      extensionSessionStarted = true;
      if (modelFallbackMessage) {
        console.warn(`[AgentRunner] model fallback agent=${agent.id} task=${task.id}: ${modelFallbackMessage}`);
        agentEventEmitter.emit('agent:run:warning', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'model_fallback', message: modelFallbackMessage, emittedAt: Date.now() });
        agentEventEmitter.emit('agent:run:model', { runId, agentId: agent.id, taskId: task.id, state: 'fallback', provider: resolved.provider, modelId: resolved.modelId, message: modelFallbackMessage, emittedAt: Date.now() });
      }
      if (!skipSystemReapply) this.applySystemPrompt(session, systemPrompt);
      try {
        const desiredEffort = String((agent as any).thinkingLevel || (agent as any)?.task_state?.thinkingLevel || 'low');
        if (desiredEffort && desiredEffort !== 'off' && typeof (session as any).setThinkingLevel === 'function') {
          (session as any).setThinkingLevel(desiredEffort);
        }
      } catch (e) { console.warn('[AgentRunner] failed to set thinking level', e); }
      console.log(`[AgentRunner] session ready (sys applied, team refreshed), prompting task=${task.id} run=${runId}`);
      this.activeSessions.set(agent.id, session);
      agentEventEmitter.emit('agent:run:started', { agentId: agent.id, workspaceId, taskId: task.id, runId, model: { provider: resolved.provider, modelId: resolved.modelId, raw: resolved.raw }, resumedSession: isResumed, emittedAt: Date.now() });
      // immediate "working" signal (even before model output)
      this.emitStatus(agent.id, 'WORKING', workspaceId, task.id, runId, 'running');

      let assistantText = '';
      let thinkBuf = '';
      let seq = 0;
      let willRetry = false;
      let settledAborted = false;
      let runError: string | null = null;
      let lastStopReason: string | null = null;
      let lastErrorMessage: string | null = null;
      let thinkPhase = 0;
      let toolSeq = 0;
      let toolCallsTotal = 0;
      let retryNudged = false;
      let discardStreamingEvents = false;
      const runUsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, costFromProvider: false };
      let usageTurns = 0;
      const accumulateUsage = (u: any) => {
        if (!u) return;
        usageTurns += 1;
        runUsageTotals.input += Number(u.input || 0);
        runUsageTotals.output += Number(u.output || 0);
        runUsageTotals.cacheRead += Number(u.cacheRead || 0);
        runUsageTotals.cacheWrite += Number(u.cacheWrite || 0);
        runUsageTotals.totalTokens += Number(u.totalTokens || 0);
        const c = u.cost || {};
        runUsageTotals.cost.input += Number(c.input || 0);
        runUsageTotals.cost.output += Number(c.output || 0);
        runUsageTotals.cost.cacheRead += Number(c.cacheRead || 0);
        runUsageTotals.cost.cacheWrite += Number(c.cacheWrite || 0);
        runUsageTotals.cost.total += Number(c.total || 0);
        if (c.totalFromProvider) runUsageTotals.costFromProvider = true;
        agentEventEmitter.emit('agent:run:usage', {
          agentId: agent.id, workspaceId, taskId: task.id, runId,
          provider: resolved.provider, modelId: resolved.modelId, model: resolved.raw,
          turn: usageTurns, usage: u, totals: JSON.parse(JSON.stringify(runUsageTotals)), emittedAt: Date.now(),
        });
      };

      const classifyToolName = (name: string): 'memory' | 'filesystem' | 'shell' | 'delegation' | 'other' => {
        const n = String(name || '').trim();
        if (!n) return 'other';
        if (/memory_(query|trace|status|path|map|drift|record_decision)$/i.test(n) || /^mcp__.*__memory_(query|trace|status|path|map|drift|record_decision)$/i.test(n)) return 'memory';
        if (['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(n)) return 'filesystem';
        if (['bash', 'shell', 'exec', 'execute'].includes(n)) return 'shell';
        if (['delegate_task', 'plan_delegation'].includes(n)) return 'delegation';
        return 'other';
      };
      const toolCallKeys = new Set<string>();
      const toolExecIds = new Set<string>();
      const toolCategoryCounts = { memory: 0, filesystem: 0, shell: 0, delegation: 0, other: 0 };
      let toolCallsUnique = 0;
      let toolCallsUnknownName = 0;
      let toolResultCount = 0;
      let toolErrorCount = 0;
      let memoryResultChars = 0;
      let firstExplorationTool: { name: string | null; category: 'memory' | 'filesystem' | 'shell' | 'delegation' | 'other' | 'none' | 'unknown'; source: string } | null = null;
      let memoryResultState: 'not_used' | 'returned' | 'empty' | 'error' = 'not_used';
      const toolNamesSeen = new Set<string>();
      const noteToolCall = (toolNameRaw: any, source: string, toolCallId?: any) => {
        const toolName = String(toolNameRaw || '').trim();
        if (toolName) toolNamesSeen.add(toolName);
        const callId = String(toolCallId || '').trim();
        let key = callId ? `id:${callId}` : `anon:${source}:${toolName || 'unknown'}:${toolSeq + 1}`;
        if (!key || toolCallKeys.has(key)) return;
        toolCallKeys.add(key);
        toolCallsUnique += 1;
        if (!toolName) toolCallsUnknownName += 1;
        const category = toolName ? classifyToolName(toolName) : 'other';
        toolCategoryCounts[category] = (toolCategoryCounts[category] || 0) + 1;
        if (!firstExplorationTool && (category === 'memory' || category === 'filesystem' || category === 'shell')) {
          firstExplorationTool = { name: toolName || null, category: toolName ? category : 'unknown', source };
        }
      };
      const noteToolResult = (toolNameRaw: any, isError: boolean, resultSummary: string) => {
        toolResultCount += 1;
        if (isError) toolErrorCount += 1;
        const toolName = String(toolNameRaw || '').trim();
        const category = classifyToolName(toolName);
        if (category === 'memory') {
          if (isError) memoryResultState = 'error';
          else {
            const len = String(resultSummary || '').trim().length;
            memoryResultState = len > 0 ? 'returned' : 'empty';
          }
          memoryResultChars += String(resultSummary || '').length;
        }
      };

      const flushThinking = async () => {
        if (!thinkBuf) return;
        const t = thinkBuf; thinkBuf = '';
        thinkPhase += 1;
        const summary = t.replace(/\s+/g, ' ').trim().slice(0, 80);
        const payload = JSON.stringify({ summary, text: t, phase: thinkPhase });
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'thinking', payload, groupId, { currentRequestEventId }).catch(() => {});
      };

      const toResultSummary = (v: any): string => {
        if (v == null) return '';
        if (typeof v === 'string') return v.slice(0, 1200);
        try {
          // Prefer readable tool text if present (e.g. {content:[{text:...}], details:{...}})
          const text = Array.isArray(v?.content) ? v.content.map((c: any) => c?.text).filter(Boolean).join('\n') : null;
          const details = v?.details ? ` | details=${JSON.stringify(v.details)}` : '';
          if (text) return `${text}${details}`.slice(0, 1200);
          return JSON.stringify(v).slice(0, 1200);
        } catch {
          return String(v).slice(0, 1200);
        }
      };
      const saveToolEvent = async (phase: 'start'|'call'|'end'|'error', info: { toolName?: string; toolCallId?: string; args?: any; resultSummary?: any; isError?: boolean }) => {
        toolSeq += 1;
        const payload = JSON.stringify({ ...info, phase, order: toolSeq });
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'tool_call', payload, groupId, { currentRequestEventId }).catch(() => {});
      };
      const shouldSkipToolExecEnd = (toolCallId?: any) => {
        const id = String(toolCallId || '').trim();
        if (!id) return false;
        if (toolExecIds.has(id)) return true;
        toolExecIds.add(id);
        return false;
      };

      const pickAssistantMeta = (ev: any) => {
        const msgs = ev?.messages || ev?.result?.messages || [];
        for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m?.role === 'assistant') { if (m.stopReason) lastStopReason = m.stopReason; if (m.errorMessage) lastErrorMessage = m.errorMessage; } }
      };

      let memoryRuntimeChecked = false;
      let mcpToolsActivated = false;
      let systemPromptSyncedWithTools = false;
      const activateLoadedMcpTools = async (force = false): Promise<string[]> => {
        if (typeof (session as any).getAllTools !== 'function') return [] as string[];
        try {
          const allNames: string[] = (session as any).getAllTools().map((tool: any) => String(tool?.name || '')).filter(Boolean);
          if (!allNames.length) return [] as string[];
          const needsActivation = !mcpToolsActivated || force;
          if (needsActivation) {
            // The Pi SDK allowlist set at session creation (_allowedTools from opts.tools) blocks
            // direct MCP tools from activation (_isActivatable), so they never reach the model even
            // when registered by extensions. Clear the allowlist and activate the full registered set
            // so every Pi/MCP tool is exposed to the agent session/model.
            try { if ('_allowedTools' in session) (session as any)._allowedTools = undefined; } catch {}
            if (typeof (session as any)._setActiveTools === 'function') (session as any)._setActiveTools(allNames);
            else if (typeof (session as any).setActiveToolsByName === 'function') (session as any).setActiveToolsByName(allNames);
            mcpToolsActivated = true;
          }
          const activeTools: string[] = typeof (session as any).getActiveToolNames === 'function' ? (session as any).getActiveToolNames() : allNames;
          // If memory is effective, prefer the actual memory MCP tool names exposed by the session
          // (server alias/prefix can vary) and keep the session system prompt in sync once.
          if (memoryEffective && !systemPromptSyncedWithTools) {
            const runtimeMemoryTools = Array.from(new Set(allNames.filter((name: string) => /^mcp__.*__memory_/i.test(name) || /^memory_/i.test(name))));
            if (runtimeMemoryTools.length) {
              memoryToolNames = runtimeMemoryTools;
              try {
                systemPrompt = await this.promptBuilder.buildSystem({ agent, team: availableAgents, memoryEffective, memoryToolNames });
                systemPromptHash = createHash('sha1').update(String(systemPrompt || '')).digest('hex');
              } catch {}
            }
            try { this.applySystemPrompt(session, systemPrompt); } catch {}
            systemPromptSyncedWithTools = true;
          }
          if (needsActivation || force) {
            this.trace.record({ runId, agentId: agent.id, eventType: 'session_tools_activated', taskId: task.id, workspaceId,
              eventData: { activeTools, allTools: allNames } }).catch(() => {});
          }
          return allNames;
        } catch (e) {
          console.warn('[AgentRunner] failed to activate loaded MCP/session tools', e);
          return [] as string[];
        }
      };
      const unsubscribe = session.subscribe((event: any) => {
        // Activate all Pi/MCP tools (clearing SDK allowlist) so direct MCP tools reach the model.
        // Run on early lifecycle events; MCP direct tools can finish registering around these points.
        if (event?.type === 'before_agent_start' || event?.type === 'agent_start' || event?.type === 'turn_start') {
          void activateLoadedMcpTools(event?.type === 'turn_start' || event?.type === 'agent_start');
        }
        // Pi waits for direct MCP tools in before_agent_start. Inspect after that wait, at agent_start,
        // instead of mistaking the initial background connection window for a failure.
        // A session without memory permission intentionally has no Nexo tools. Its empty
        // tool list is not evidence that the shared Pi MCP server is unavailable.
        if (!memoryRuntimeChecked && memoryEffective && !terminalWorkerResult && this.memoryService && event.type === 'agent_start') {
          memoryRuntimeChecked = true;
          void (async () => {
            const toolNames = await activateLoadedMcpTools(true);
            const allToolNames = toolNames.length ? toolNames : (typeof session?.getAllTools === 'function' ? session.getAllTools().map((tool: any) => String(tool?.name || '')) : []);
            const memoryRuntime = this.memoryService.recordPiSessionMemoryTools(allToolNames);
            const observedMemoryTools = Array.from(new Set(allToolNames.filter((name: string) => /^mcp__.*__memory_/i.test(name) || /^memory_/i.test(name))));
            this.trace.record({ runId, agentId: agent.id, eventType: 'memory_pi_session', taskId: task.id, workspaceId,
              eventData: { available: memoryRuntime.available, reason: memoryRuntime.reason, observedToolCount: observedMemoryTools.length, toolNames: observedMemoryTools } }).catch(() => {});
          })();
        }
        if (event.type === 'message_end' && event.message?.role === 'assistant' && event.message?.usage) {
          accumulateUsage(event.message.usage);
        }
        if (event.type === 'message_update' && event.assistantMessageEvent) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta' && ame.delta) { if (discardStreamingEvents) return; flushThinking().catch(() => {}); assistantText += ame.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: ame.delta, kind: 'text', emittedAt: Date.now() }); this.trace.textOutput(runId, agent.id, workspaceId, task.id, ame.delta.length).catch(() => {}); }
          if (ame.type === 'thinking_delta' && ame.delta) { if (discardStreamingEvents) return; thinkBuf += ame.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: ame.delta, kind: 'thinking', emittedAt: Date.now() }); this.trace.thinking(runId, agent.id, workspaceId, task.id, ame.delta.length).catch(() => {}); }
          if (ame.type === 'toolcall_start') { const tc = ame.toolCall || {}; if (discardStreamingEvents) return; flushThinking().catch(() => {}); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(tc.name || ''), JSON.stringify(tc.arguments||'')).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'start', toolName: tc.name, toolCallId: tc.id, args: tc.arguments, emittedAt: Date.now() }); saveToolEvent('start', { toolName: tc.name, toolCallId: tc.id, args: tc.arguments }).catch(() => {}); }
          if (ame.type === 'toolcall_end') { const tc = ame.toolCall || {}; if (discardStreamingEvents) return; agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'call', toolName: tc.name, toolCallId: tc.id, args: tc.arguments, emittedAt: Date.now() }); saveToolEvent('call', { toolName: tc.name, toolCallId: tc.id, args: tc.arguments }).catch(() => {}); }
          if (ame.error) { runError = String(ame.error?.message || ame.error); lastErrorMessage = runError; }
        }
        if (event.type === 'text_delta' && event.delta) { if (discardStreamingEvents) return; flushThinking().catch(() => {}); assistantText += event.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: event.delta, kind: 'text', emittedAt: Date.now() }); }
        if (event.type === 'tool_execution_start') { if (discardStreamingEvents) return; toolCallsTotal++; flushThinking().catch(() => {}); noteToolCall(event.toolName, 'tool_execution_start', event.toolCallId); const s = JSON.stringify({ tool: event.toolName, args: event.args }); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(event.toolName||''), s).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'start', toolName: event.toolName, toolCallId: event.toolCallId, args: event.args, emittedAt: Date.now() }); saveToolEvent('start', { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args }).catch(() => {}); }
        if (event.type === 'tool_execution_end') { if (discardStreamingEvents || shouldSkipToolExecEnd(event.toolCallId)) return; const resultSummaryFull = toResultSummary(event.result); noteToolResult(event.toolName, !!event.isError, resultSummaryFull); this.trace.toolResult(runId, agent.id, workspaceId, task.id, String(event.toolName||''), !!event.isError, resultSummaryFull.length).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: event.isError ? 'error' : 'end', toolName: event.toolName, toolCallId: event.toolCallId, resultSummary: event.isError ? resultSummaryFull.slice(0, 300) : undefined, emittedAt: Date.now() }); saveToolEvent(event.isError ? 'error' : 'end', { toolName: event.toolName, toolCallId: event.toolCallId, resultSummary: resultSummaryFull, isError: !!event.isError }).catch(() => {}); }
        if (event.type === 'tool_call' && event.toolName) { if (discardStreamingEvents) return; flushThinking().catch(() => {}); const s = JSON.stringify({ tool: event.toolName, args: event.args }); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(event.toolName||''), s).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'call', toolName: event.toolName, toolCallId: event.toolCallId, args: event.args, emittedAt: Date.now() }); saveToolEvent('call', { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args }).catch(() => {}); }
        if (event.type === 'agent_end') { willRetry = !!event.willRetry; pickAssistantMeta(event); flushThinking().catch(() => {}); }
        if (event.type === 'agent_settled') { settledAborted = !!event.aborted; }
        if (event.type === 'auto_retry_start') { willRetry = true; agentEventEmitter.emit('agent:run:warning', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'auto_retry', message: `retry ${event.attempt ?? ''}`, emittedAt: Date.now() }); }
        if (event.type === 'auto_retry_end' && !event.success) { runError = runError || String(event.finalError || 'retry failed'); }
      });

      const runPromptOnce = async (text: string) => {
        assistantText = '';
        thinkBuf = '';
        runError = null;
        lastStopReason = null;
        lastErrorMessage = null;
        willRetry = false;
        settledAborted = false;
        try {
          await session.prompt(text);
        } catch (e: any) {
          runError = runError || String(e?.message || e);
          console.error(`[AgentRunner] prompt error task=${task.id} run=${runId}:`, e);
        }
        await flushThinking();
      };

      await runPromptOnce(promptText);
      let text = assistantText.trim();
      stopped = !this.activeSessions.has(agent.id) || settledAborted;
      // Guard: model exhausted output (stopReason=length) with no actionable result and no delegation -> 1 concise nudge retry
      if (!stopped && !runError && !lastErrorMessage && lastStopReason !== 'error' && lastStopReason === 'length' && !text && !delegatedThisRun) {
        retryNudged = true;
        console.warn(`[AgentRunner] output_length_no_action task=${task.id} run=${runId} agent=${agent.nickname} (nudging once)`);
        this.trace.record({ runId, agentId: agent.id, eventType: 'output_length_no_action', taskId: task.id, workspaceId, eventData: { delegatedThisRun, toolCallsTotal, retry: true } }).catch(() => {});
        agentEventEmitter.emit('agent:run:warning', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'output_length_no_action', message: 'Turn hit length limit with no action; retrying once with concise nudge', emittedAt: Date.now() });
        // discard any late straggler events from the truncated turn while we nudge
        discardStreamingEvents = true;
        thinkBuf = '';
        discardStreamingEvents = false;
        await runPromptOnce(this.promptBuilder.buildLengthRetryNudge({
          agent, taskPayload: task.payload, isDelegationResult, isRootUserCallback: callbackAtUserRoot, isRootFinalCallback, callbackContext: (task as any).callback_context ?? null,
        }));
        text = assistantText.trim();
        stopped = !this.activeSessions.has(agent.id) || settledAborted;
      }
      console.log(`[AgentRunner] prompt finished task=${task.id} run=${runId} stopReason=${lastStopReason} err=${runError || lastErrorMessage || ''} aborted=${settledAborted} retry=${willRetry} nudged=${retryNudged} delegated=${delegatedThisRun}`);
      this.activeSessions.delete(agent.id);
      unsubscribe();

      // Observabilidad: persist per-run usage/totals for token audits (provider metrics may be partial per turn).
      const recordRunUsage = (outcome: string) => {
        const uniqueCount = toolCallsUnique;
        this.trace.record({
          runId, agentId: agent.id, eventType: 'run_usage', taskId: task.id, workspaceId,
          eventData: {
            outcome,
            provider: resolved.provider,
            modelId: resolved.modelId,
            model: resolved.raw,
            turns: usageTurns,
            totals: JSON.parse(JSON.stringify(runUsageTotals)),
            providerUsage: {
              totals: JSON.parse(JSON.stringify(runUsageTotals)),
              semantics: { note: 'provider-reported turn usage accumulated; cacheRead/cacheWrite are reported by the provider and may or may not overlap input/totalTokens depending on provider definition' },
            },
            promptEstimate: {
              estimateMethod: promptSize?.estimateMethod || 'ceil(chars/4)',
              sections: promptSize?.sections || {},
              totalEstimatedTokens: promptSize?.totalEstimatedTokens ?? Math.ceil((String(systemPrompt || '').length + promptText.length) / 4),
              note: 'character-based estimate; separate from provider usage',
            },
            nudged: retryNudged,
            toolCallsTotal: uniqueCount,
            toolCallsUnique: uniqueCount,
            toolCallsUnknownName,
            toolCategories: { ...toolCategoryCounts },
            firstExplorationTool: firstExplorationTool || { name: null, category: 'none', source: 'none' },
            toolResults: { count: toolResultCount, errors: toolErrorCount, memoryResultChars, memoryResultLengthLimit: 1200 },
            memory: {
              effective: memoryEffective,
              reason: memoryState?.reason ?? null,
              observedToolCount: Array.from(toolNamesSeen).filter((n) => /^mcp__.*__memory_/i.test(n) || /^memory_/i.test(n)).length,
              observedToolNames: Array.from(toolNamesSeen).filter((n) => /^mcp__.*__memory_/i.test(n) || /^memory_/i.test(n)),
              resultState: memoryResultState,
            },
            delegated: delegatedThisRun,
            stopReason: lastStopReason,
          },
        }).catch(() => {});
      };

      await finalizeOnce(async () => {
        const durationMs = Date.now() - startedAt;
        if (forcedToolLoopStop) {
          const message = `⚠️ ${forcedToolLoopStop}`;
          task.status = 'HOLD' as any;
          (task as any).response = message;
          await this.taskQueueRepository.update(task);
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', message, groupId, { currentRequestEventId }).catch(() => {});
          recordRunUsage('delegation_tool_loop_stopped');
          this.trace.close(runId, agent.id, workspaceId, task.id, 'delegation_tool_loop_stopped', lastStopReason || undefined, durationMs, false).catch(() => {});
          return;
        }
        if (stopped) {
          // stopAgent may have already finalized the task; do not create a new PENDING wake-up.
          const freshStop = await this.taskQueueRepository.get(task.id).catch(() => null);
          if (freshStop && freshStop.status !== 'STOPPED') {
            const stopMsg = '⏹️ Solicitud detenida por intervención del usuario (stop).';
            freshStop.status = 'STOPPED' as any;
            (freshStop as any).response = stopMsg;
            await this.taskQueueRepository.update(freshStop);
            try { await this.saveChatEvent(workspaceId, agent.id, freshStop, 'OUTBOUND', 'response', stopMsg, groupId, { currentRequestEventId }); } catch {}
          }
          recordRunUsage('stopped');
          this.trace.close(runId, agent.id, workspaceId, task.id, 'stopped', lastStopReason || 'user_stop', durationMs, false).catch(() => {});
          agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId, taskId: task.id, runId, outcome: 'stopped', stopReason: lastStopReason || 'user_stop', aborted: true, willRetry: false, durationMs, emittedAt: Date.now() });
          return;
        }

        const finalErr = runError || lastErrorMessage || (lastStopReason === 'error' ? 'assistant error' : null);
        if (finalErr) {
          task.status = 'HOLD' as any;
          (task as any).response = `⚠️ Error de ejecución: ${String(finalErr).slice(0, 600)}`;
          await this.taskQueueRepository.update(task);
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', (task as any).response, groupId, { currentRequestEventId }).catch(() => {});
          recordRunUsage('error');
          this.trace.error(runId, agent.id, workspaceId, task.id, 'prompt_failed', String(finalErr)).catch(() => {});
          this.trace.close(runId, agent.id, workspaceId, task.id, 'error', lastStopReason || undefined, durationMs, false).catch(() => {});
          agentEventEmitter.emit('agent:run:error', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'prompt_failed', message: finalErr, emittedAt: Date.now() });
          agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId, taskId: task.id, runId, outcome: 'error', stopReason: lastStopReason, errorMessage: finalErr, willRetry: false, aborted: false, durationMs, emittedAt: Date.now() });
          return;
        }

        const sessionFile = (session as any).sessionManager?.getSessionFile?.() ?? agent.current_session_id;
        const lengthNoAction = lastStopReason === 'length' && !text && !delegatedThisRun;
        if (lengthNoAction) {
          // exhausted output without any actionable result even after nudge: don't route/pretend success, don't poison memory
          const msg = '⚠️ El turno se cortó por límite de longitud sin completar acción ni respuesta (posible bucle de razonamiento). Tarea en espera para reintento; considera limpiar/reiniciar la sesión del agente si persiste.';
          task.status = 'HOLD' as any;
          (task as any).response = msg;
          await this.taskQueueRepository.update(task);
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', msg, groupId, { currentRequestEventId }).catch(() => {});
          recordRunUsage('output_length_no_action');
          this.trace.error(runId, agent.id, workspaceId, task.id, 'output_length_exhausted_no_action', JSON.stringify({ stopReason: lastStopReason, delegatedThisRun, toolCallsTotal, nudged: retryNudged })).catch(() => {});
          this.trace.close(runId, agent.id, workspaceId, task.id, 'output_length_no_action', lastStopReason || undefined, durationMs, false).catch(() => {});
          agentEventEmitter.emit('agent:run:warning', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'output_length_exhausted_no_action', message: 'Exhausted length with no action/response after retry', emittedAt: Date.now() });
          agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId, taskId: task.id, runId, outcome: 'error', stopReason: lastStopReason, errorMessage: 'output_length_exhausted_no_action', willRetry: false, aborted: false, durationMs, emittedAt: Date.now() });
          agent.current_session_id = sessionFile ? String(sessionFile) : agent.current_session_id;
          return;
        }

        const responseText = text || (delegatedThisRun ? '(delegación en curso; sin texto adicional)' : `(no text output, stopReason=${lastStopReason || 'unknown'})`);
        const progressText = delegatedThisRun ? (delegatedProgressSummary || formatDelegationProgressSummary()) : responseText;
        const outcome = text ? 'completed' : (delegatedThisRun ? 'delegated' : 'completed_empty');
        if (!text && !delegatedThisRun) console.warn(`[AgentRunner] empty response task=${task.id} run=${runId} model=${resolved.raw} stopReason=${lastStopReason}`);
        const summaryText = responseText.slice(0, 500);
        await this.agentMemoryRepository.add({ agent_id: agent.id, session_id: String(sessionFile || ''), compacted_summary: summaryText, created_at: new Date() } as any);
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', responseText, groupId, { currentRequestEventId }).catch(() => {});
        agent.current_session_id = sessionFile ? String(sessionFile) : agent.current_session_id;
        task.status = 'COMPLETED' as any;
        (task as any).response = responseText;
        await this.taskQueueRepository.update(task);
        recordRunUsage(outcome);
        this.trace.close(runId, agent.id, workspaceId, task.id, outcome, lastStopReason || undefined, durationMs, false).catch(() => {});
        agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId, taskId: task.id, runId, outcome, stopReason: lastStopReason, willRetry: false, aborted: false, durationMs, emittedAt: Date.now() });
        // Delegation return (progress vs final):
        // - If this turn delegated: send a DELEGATION PROGRESS ack to the immediate sender (wakes them; not final), then wait for callback chain.
        // - If consuming a callback/progress and did NOT delegate further: this is the final synthesis for the branch -> send DELEGATION RESULT (final) to the origin delegator.
        // - If consuming and delegated further: send progress and wait for sub-chain (to origin delegator, never down to leaf sender).
        // - If direct task and did NOT delegate: send DELEGATION RESULT (final) to immediate sender.
        if (task.sender_agent_id && task.sender_agent_id !== 'user') {
          const incomingCallback = isDelegationCallback;
          const resolveOrigin = async (skipIds: Set<number> = new Set()) => {
            let origin: any = null;
            try {
              let cur: any = task;
              const seen = new Set<number>();
              while (cur && cur.parent_task_id && !seen.has(cur.id)) {
                seen.add(cur.id);
                const p = await this.taskQueueRepository.get(cur.parent_task_id);
                if (!p) break;
                const pFlow = (p as any).task_flow || 'direct';
                if (pFlow === 'direct' && p.receiver_agent_id === agent.id && !skipIds.has(p.id)) { origin = p; break; }
                cur = p;
              }
            } catch {}
            return origin;
          };

          // idempotency guard for callback enqueues (avoids duplicates/echo races)
          const recentCallbackKeys = (this as any)._recentCallbackKeys || ((this as any)._recentCallbackKeys = new Map<string, number>());
          const shouldEnqueueCallback = (key: string) => {
            const now = Date.now();
            for (const [k, ts] of recentCallbackKeys) { if (now - ts > 30000) recentCallbackKeys.delete(k); }
            if (recentCallbackKeys.has(key)) return false;
            recentCallbackKeys.set(key, now);
            return true;
          };

          const resolvePlanRefForCallback = async (originTask: any): Promise<number | null> => {
            const direct = (originTask as any)?.plan_ref ?? (task as any)?.plan_ref ?? activePlanRef ?? null;
            if (direct != null) return Number(direct);
            try {
              let cur: any = originTask || task;
              const seen = new Set<number>();
              for (let i = 0; i < 12 && cur; i++) {
                if (cur.plan_ref != null) return Number(cur.plan_ref);
                const pid = cur.parent_task_id ?? null;
                if (!pid || seen.has(Number(pid))) break;
                seen.add(Number(pid));
                cur = await this.taskQueueRepository.get(Number(pid)).catch(() => null);
              }
            } catch {}
            return null;
          };

          if (incomingCallback) {
            this.trace.record({ runId, agentId: agent.id, eventType: 'callback_processed', taskId: task.id, workspaceId, eventData: { depth: (task as any).depth ?? 0, delegatedThisRun, flow: (task as any).task_flow } }).catch(() => {});
            let origin = await resolveOrigin();
            let targetSender = origin?.sender_agent_id || task.sender_agent_id;

            // Anti-echo: a synthesized RESULT must not bounce back to the immediate callback sender (ping-pong). Climb to higher origin; if none, close (response already produced).
            if (!delegatedThisRun && targetSender && targetSender === (task as any).sender_agent_id && (task as any).sender_agent_id !== 'user') {
              const skip = new Set<number>();
              if (origin?.id) skip.add(origin.id);
              const higher = await resolveOrigin(skip);
              if (higher?.sender_agent_id && higher.sender_agent_id !== (task as any).sender_agent_id) {
                origin = higher; targetSender = higher.sender_agent_id;
              } else {
                console.log(`[AgentRunner][${agent.nickname}] Anti-echo: suppressed result bounce to ${task.sender_agent_id} for callback task #${task.id}`);
                targetSender = null;
              }
            }

            const originDepth = Math.max(0, Number((origin as any)?.depth ?? (task as any).depth ?? 0));
            const originPath = String((origin as any)?.depth_path || (task as any).depth_path || `/root/${agent.nickname}`);

            if (!delegatedThisRun) {
              // final synthesis for this branch -> report to origin delegator
              if (targetSender && targetSender !== 'user') {
                const key = `${workspaceId}|${targetSender}|${origin?.id ?? task.id}|delegation_result|1`;
                if (shouldEnqueueCallback(key)) {
                  const cbPlanRef = await resolvePlanRefForCallback(origin || task);
                  await this.taskQueueRepository.add({
                    sender_agent_id: agent.id,
                    receiver_agent_id: targetSender,
                    payload: `[DELEGATION RESULT from ${agent.nickname} | state=FINAL | task=#${task.id} | request=#${origin?.id ?? task.id} | origin=#${origin?.id ?? task.id} | parent=#${(task as any).parent_task_id ?? '-'} | depth=${originDepth} | branch=${originPath}/result]\n${responseText}`,
                    status: 'PENDING' as any,
                    parent_task_id: task.id,
                    workspace_id: workspaceId,
                    task_flow: 'delegation_result',
                    depth: originDepth,
                    depth_path: `${originPath}/result`,
                    parent_task_callback: true,
                    callback_final: true,
                    callback_context: selectCallbackInstruction(origin, task),
                    plan_ref: cbPlanRef,
                    origin_request_event_id: currentRequestEventId,
                    created_at: new Date(),
                  } as any);
                  this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_result_final_enqueued', taskId: task.id, workspaceId, eventData: { to: targetSender, depth: originDepth, originTaskId: origin?.id ?? null, plan_ref: cbPlanRef } }).catch(() => {});
                }
              } else {
                this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_result_consumed', taskId: task.id, workspaceId, eventData: { returnedTo: targetSender || 'closed' } }).catch(() => {});
              }
            } else {
              // delegated further while consuming; intermediate progress must bubble UP to origin delegator (F3), never down to leaf
              if (targetSender && targetSender !== 'user') {
                const key = `${workspaceId}|${targetSender}|${origin?.id ?? task.id}|delegation_progress|0`;
                if (shouldEnqueueCallback(key)) {
                  const cbPlanRef = await resolvePlanRefForCallback(origin || task);
                  await this.taskQueueRepository.add({
                    sender_agent_id: agent.id,
                    receiver_agent_id: targetSender,
                    payload: `[DELEGATION PROGRESS from ${agent.nickname} | state=PROGRESS(intermedio,no-final) | task=#${task.id} | request=#${origin?.id ?? task.id} | origin=#${origin?.id ?? task.id} | parent=#${(task as any).parent_task_id ?? '-'} | depth=${originDepth} | branch=${originPath}/progress]\n${progressText}`,
                    status: 'PENDING' as any,
                    parent_task_id: task.id,
                    workspace_id: workspaceId,
                    task_flow: 'delegation_progress',
                    depth: originDepth,
                    depth_path: `${originPath}/progress`,
                    parent_task_callback: true,
                    callback_final: false,
                    callback_context: selectCallbackInstruction(origin, task),
                    plan_ref: cbPlanRef,
                    origin_request_event_id: currentRequestEventId,
                    created_at: new Date(),
                  } as any);
                  this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_progress_enqueued', taskId: task.id, workspaceId, eventData: { to: targetSender, depth: originDepth, plan_ref: cbPlanRef } }).catch(() => {});
                }
              }
              this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_waiting_subchain', taskId: task.id, workspaceId, eventData: { depth: (task as any).depth ?? 0 } }).catch(() => {});
            }
          } else {
            const cbDepth = Math.max(0, parentDepth);
            if (!delegatedThisRun) {
              const key = `${workspaceId}|${task.sender_agent_id}|${task.id}|delegation_result|1|direct`;
              if (shouldEnqueueCallback(key)) {
                const cbPlanRef = await resolvePlanRefForCallback(task);
                await this.taskQueueRepository.add({
                  sender_agent_id: agent.id,
                  receiver_agent_id: task.sender_agent_id,
                  payload: `[DELEGATION RESULT from ${agent.nickname} | state=FINAL | task=#${task.id} | request=#${task.id} | origin=#${task.id} | parent=#${(task as any).parent_task_id ?? '-'} | depth=${cbDepth} | branch=${parentDepthPath}/result]\n${responseText}`,
                  status: 'PENDING' as any,
                  parent_task_id: task.id,
                  workspace_id: workspaceId,
                  task_flow: 'delegation_result',
                  depth: cbDepth,
                  depth_path: `${parentDepthPath}/result`,
                  parent_task_callback: true,
                  callback_final: true,
                  callback_context: (task as any).callback_context ?? task.payload,
                  plan_ref: cbPlanRef,
                  origin_request_event_id: currentRequestEventId,
                  created_at: new Date(),
                } as any);
                this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_result_final_enqueued', taskId: task.id, workspaceId, eventData: { to: task.sender_agent_id, depth: cbDepth, plan_ref: cbPlanRef } }).catch(() => {});
              }
            } else {
              // delegated during this turn: send intermediate progress (wakes delegator) but not final
              const key = `${workspaceId}|${task.sender_agent_id}|${task.id}|delegation_progress|0|direct`;
              if (shouldEnqueueCallback(key)) {
                const cbPlanRef = await resolvePlanRefForCallback(task);
                await this.taskQueueRepository.add({
                  sender_agent_id: agent.id,
                  receiver_agent_id: task.sender_agent_id,
                  payload: `[DELEGATION PROGRESS from ${agent.nickname} | state=PROGRESS(intermedio,no-final) | task=#${task.id} | request=#${task.id} | origin=#${task.id} | parent=#${(task as any).parent_task_id ?? '-'} | depth=${cbDepth} | branch=${parentDepthPath}/progress]\n${progressText}`,
                  status: 'PENDING' as any,
                  parent_task_id: task.id,
                  workspace_id: workspaceId,
                  task_flow: 'delegation_progress',
                  depth: cbDepth,
                  depth_path: `${parentDepthPath}/progress`,
                  parent_task_callback: true,
                  callback_final: false,
                  callback_context: (task as any).callback_context ?? task.payload,
                  plan_ref: cbPlanRef,
                  origin_request_event_id: currentRequestEventId,
                  created_at: new Date(),
                } as any);
                this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_progress_enqueued', taskId: task.id, workspaceId, eventData: { to: task.sender_agent_id, depth: cbDepth, plan_ref: cbPlanRef } }).catch(() => {});
              }
            }
          }
        }
      });
    } catch (error: any) {
      console.error(`Error running agent ${agent.id}:`, error);
      this.activeSessions.delete(agent.id);
      task.status = 'HOLD' as any;
      (task as any).response = `⚠️ Runner error: ${String(error?.message || error).slice(0, 400)}`;
      try { await this.taskQueueRepository.update(task); } catch {}
      this.trace.error(runId, agent.id, workspaceId, task.id, 'runner_error', String(error?.message || error)).catch(() => {});
      this.trace.close(runId, agent.id, workspaceId, task.id, 'error', undefined, undefined, false).catch(() => {});
      agentEventEmitter.emit('agent:run:error', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'runner_error', message: String(error?.message || error), emittedAt: Date.now() });
      agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId, taskId: task.id, runId, outcome: 'error', errorMessage: String(error?.message || error), willRetry: false, aborted: false, emittedAt: Date.now() });
    } finally {
      // AgentRunner owns a short-lived SDK session per task. Shut down extension
      // handlers even when prompt setup or execution fails, then release listeners.
      try {
        const session = sessionForToolLoopAbort;
        if (session) {
          const extensionRunner = (session as any).extensionRunner;
          if (extensionSessionStarted && extensionRunner?.hasHandlers?.('session_shutdown')) {
            await extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
          }
          session.dispose?.();
        }
      } catch (e) {
        console.warn('[AgentRunner] failed to close Pi session extensions', e);
      }
      this.currentTaskByAgent.delete(agent.id);
      const a = await this.agentRepository.get(agent.id).catch(() => null);
      if (a) { a.status = AgentStatus.IDLE; await this.agentRepository.update(a).catch(() => {}); }
      this.emitStatus(agent.id, 'IDLE', workspaceId, task.id, runId, 'idle');
      this.emitQueueState(agent.id, workspaceId);
    }
  }

  private resolveSessionManager(agent: IAgent, cwd: string): { sessionManager: SessionManager; isResumed: boolean } {
    const sessionPath = agent.current_session_id;
    if (sessionPath && typeof sessionPath === 'string' && fs.existsSync(sessionPath)) {
      try { return { sessionManager: SessionManager.open(sessionPath), isResumed: true }; } catch (e) { console.warn(`[AgentRunner] open session failed for ${agent.id}`, e); }
    }
    const sessionDir = path.join(process.cwd(), 'data', 'sessions', agent.workspace_id || 'default', agent.id);
    try { fs.mkdirSync(sessionDir, { recursive: true }); } catch {}
    return { sessionManager: SessionManager.create(cwd, sessionDir), isResumed: false };
  }

  async clearAgentSession(agentId: string): Promise<void> {
    const agent = await this.agentRepository.get(agentId);
    if (!agent) return;
    await this.compactAgentSession(agentId, 'SESSION_CLEARED').catch(() => {});

    // Drop live/in-memory session and runner state so cleared agents never reuse old context/tools/prompts
    const live = this.activeSessions.get(agentId);
    if (live) {
      try { if (typeof (live as any).abort === 'function') await (live as any).abort().catch(() => {}); } catch {}
      try { if (typeof (live as any).dispose === 'function') (live as any).dispose(); } catch {}
    }
    this.activeSessions.delete(agentId);
    this.systemPromptInjected.delete(agentId);
    this.systemPromptHashByAgent.delete(agentId);
    this.currentTaskByAgent.delete(agentId);
    this.pendingByAgent.delete(agentId);
    this.processingAgents.delete(agentId);

    if (agent.workspace_id) {
      const events = await AgentChatEventEntity.findAll({ where: { workspace_id: agent.workspace_id, agent_id: agent.id } as any, order: [['id', 'ASC']] }).catch(() => [] as any[]);
      const { TaskQueueEntity } = await import('../task-queue/infra/persistence/sequalize/entities/task-queue.schema.js');
      const { Op } = await import('sequelize');
      const taskWhere = { workspace_id: agent.workspace_id, [Op.or]: [{ receiver_agent_id: agent.id }, { sender_agent_id: agent.id }] } as any;
      const tasks = await TaskQueueEntity.findAll({ where: taskWhere, order: [['id', 'ASC']] }).catch(() => [] as any[]);
      const details = {
        transcript: (events as any[]).map((e: any) => ({ id: e.id, kind: e.kind, direction: e.direction, content: e.content, task_id: e.task_id, created_at: e.created_at })),
        tasks: (tasks as any[]).map((t: any) => ({ id: t.id, sender_agent_id: t.sender_agent_id, receiver_agent_id: t.receiver_agent_id, payload: t.payload, status: t.status, response: t.response, parent_task_id: t.parent_task_id, created_at: t.created_at })),
      };
      await TaskQueueEntity.destroy({ where: taskWhere }).catch(() => {});
      await AgentSessionHistoryEntity.create({ workspace_id: agent.workspace_id, agent_id: agent.id, session_id: agent.current_session_id, event_type: 'SESSION_CLEARED', summary: `Chat/sesión archivada (${(events as any[]).length} eventos) — ${agent.nickname}`, details: JSON.stringify(details), created_at: new Date() } as any).catch(() => {});
      await AgentChatEventEntity.destroy({ where: { workspace_id: agent.workspace_id, agent_id: agent.id } as any }).catch(() => {});
      try {
        const team = await this.identityResolverService.getAvailableAgents(agent.workspace_id);
        const sp = await this.promptBuilder.buildSystem({ agent, team } as any);
        if (String(sp || '').trim()) {
          // sp already includes agent additional_instruction (PromptBuilder.buildSystem); do not append it again.
          const ctx = `[SYSTEM CONTEXT · injected by Pi-Hive (post-clear)]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${agent.workspace_id}).\n\n${sp}`;
          await AgentChatEventEntity.create({ workspace_id: agent.workspace_id, agent_id: agent.id, task_id: null, parent_task_id: null, request_id: null, request_parent_id: null, direction: 'OUTBOUND', kind: 'system_prompt', content: ctx, collapsible_group_id: `system-${agent.id}-${Date.now()}`, created_at: new Date() } as any);
          this.systemPromptHashByAgent.set(agentId, createHash('sha1').update(String(sp)).digest('hex'));
        }
      } catch {}
    }

    this.systemPromptInjected.add(agentId); // mark post-clear context as injected; next run starts fresh session (no current_session_id)
    await this.agentRepository.update({ ...agent, status: 'IDLE', current_session_id: null } as any);
    this.emitStatus(agentId, 'IDLE', (agent as any).workspace_id, null, null, 'session_clear');
    this.emitQueueState(agentId, (agent as any).workspace_id);
    agentEventEmitter.emit('agent:transcript:cleared', { agentId, workspaceId: agent.workspace_id });
  }

  async compactAgentSession(agentId: string, eventType: 'COMPACTION_SUMMARY' | 'SESSION_CLEARED' | 'WORKSPACE_RESET' = 'COMPACTION_SUMMARY'): Promise<void> {
    const session = this.activeSessions.get(agentId);
    if (session && typeof (session as any).compact === 'function') {
      try { await (session as any).compact('Preserva: identidad (nickname/rol/workspace), contexto multiagente, decisiones clave, delegaciones y estado de tareas. Sé conciso.'); } catch (e) { console.warn('[AgentRunner] compact failed', e); }
      try { await this.refreshSystemPrompt(agentId); } catch {}
    }
    const agent = await this.agentRepository.get(agentId);
    if (agent?.workspace_id) {
      await AgentSessionHistoryEntity.create({ workspace_id: agent.workspace_id, agent_id: agent.id, session_id: agent.current_session_id, event_type: eventType, summary: `Compaction requested (${eventType}) for ${agent.nickname}`, details: null, created_at: new Date() } as any).catch(() => {});
    }
  }

  // Self-referencing request tracing:
  // - kind='request': creates the request node; request_id points to the originating request event (origin_request_event_id), null for roots.
  //   Returns the created event id so it becomes the parent for all events of this request.
  // - other kinds: children of this request; request_id points to the request event id (currentRequestEventId).
  private async saveChatEvent(
    workspaceId: string,
    agentId: string,
    task: ITaskQueue,
    direction: 'INBOUND' | 'OUTBOUND',
    kind: string,
    content: string,
    groupId: string,
    opts?: { currentRequestEventId?: number | null },
  ): Promise<number | null> {
    try {
      let parentRequestId: number | null = null;
      if (kind === 'request') {
        const origin = (task as any).origin_request_event_id;
        parentRequestId = origin != null && Number.isFinite(Number(origin)) ? Number(origin) : null;
      } else {
        const cur = opts?.currentRequestEventId;
        parentRequestId = cur != null && Number.isFinite(Number(cur)) ? Number(cur) : null;
      }
      const created = await AgentChatEventEntity.create({
        workspace_id: workspaceId,
        agent_id: agentId,
        task_id: task?.id ?? null,
        parent_task_id: task?.parent_task_id ?? null,
        request_id: parentRequestId,
        direction,
        kind,
        content,
        collapsible_group_id: groupId,
        created_at: new Date(),
      } as any);
      return created?.id != null ? Number(created.id) : null;
    } catch {
      return null;
    }
  }

  async refreshWorkspaceSystemPrompts(workspaceId: string): Promise<void> {
    if (!workspaceId) return;
    try {
      const all = await this.agentRepository.getAll();
      const wsAgents = all.filter((a: any) => a.workspace_id === workspaceId && !a.archived_at);
      for (const a of wsAgents) {
        try { await this.refreshSystemPrompt(a.id); } catch {}
      }
    } catch (e) { console.warn('[AgentRunner] refreshWorkspaceSystemPrompts failed', e); }
  }

  async stopWorkspaceAgents(workspaceId: string): Promise<{ ok: boolean; stopped: number }> {
    const agents = await this.agentRepository.getAll();
    const wsAgents = agents.filter((a: any) => a.workspace_id === workspaceId && !(a as any).archived_at);
    let stopped = 0;
    for (const a of wsAgents) {
      const busy = this.processingAgents.has(a.id) || this.currentTaskByAgent.has(a.id) || a.status === 'WORKING';
      if (busy) { await this.stopAgent(a.id, { reason: 'workspace_stop_all', notifySender: false }).catch(() => {}); stopped++; }
    }
    return { ok: true, stopped };
  }

  async clearWorkspaceSessions(workspaceId: string): Promise<{ ok: boolean; cleared: number; busy?: string[] }> {
    const agents = await this.agentRepository.getAll();
    const wsAgents = agents.filter((a: any) => a.workspace_id === workspaceId && !(a as any).archived_at);
    const busy = wsAgents.filter(a => this.processingAgents.has(a.id) || this.currentTaskByAgent.has(a.id) || a.status === 'WORKING').map(a => a.nickname || a.id);
    if (busy.length) return { ok: false, cleared: 0, busy };
    wsAgents.sort((a: any, b: any) => (a.role === 'CHIEF' ? 0 : 1) - (b.role === 'CHIEF' ? 0 : 1) || String(a.nickname||a.id).localeCompare(String(b.nickname||b.id)));
    for (const a of wsAgents) { await this.clearAgentSession(a.id).catch(() => {}); }
    return { ok: true, cleared: wsAgents.length };
  }
}
