import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Type } from '@sinclair/typebox';
import { createAgentSession, defineTool, SessionManager, DefaultResourceLoader, ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

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
import { buildReceiverScopedInstruction } from './delegation-instruction.js';
import { detectCopyPasteInstruction } from './delegation-instruction-guard.js';
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
      await this.agentRepository.update(agent);
      this.emitStatus(agent.id, agent.status, (agent as any).workspace_id, currentTaskId ?? null, null, reason);
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
    const availableAgents = (await this.agentRepository.getAll()).filter(a => a.status !== 'PAUSED' && !(a as any).archived_at);
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
    await this.saveChatEvent(workspaceId, agent.id, task, 'INBOUND', 'request', task.payload, groupId).catch(() => {});

    let stopped = false;
    let runId = randomUUID();
    const startedAt = Date.now();
    let finalized = false;
    const finalizeOnce = async (fn: () => Promise<void>) => { if (finalized) return; finalized = true; await fn(); };
    try {
      const workspace = await this.workspaceRepository.get(workspaceId);
      const cwd = (workspace?.path && fs.existsSync(workspace.path)) ? workspace.path : process.cwd();
      const availableAgents = await this.identityResolverService.getAvailableAgents(workspaceId);

      const resolved = await this.resolveAgentModel(agent);
      if (!resolved.ok) {
        const r = resolved as { reason: string; raw?: string };
        const reason = `model_not_found: ${r.reason}`;
        console.warn(`[AgentRunner] ${agent.id} task=${task.id} ${reason}`);
        agentEventEmitter.emit('agent:run:error', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'model_not_found', message: r.reason, emittedAt: Date.now() });
        task.status = 'HOLD' as any;
        (task as any).response = `⚠️ Modelo no resuelto: ${r.reason}. Configura task_state.model (provider/modelId), p.ej. ollama/ornith-1.5:9b-16k-pi.`;
        await this.taskQueueRepository.update(task);
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', (task as any).response, groupId).catch(() => {});
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
      const rosterForPlanner = availableAgents
        .filter((a: any) => a.id !== agent.id)
        .map((a: any) => ({ nickname: a.nickname, role: a.role, id: a.id }));

      let delegatedThisRun = false;
      let delegationPlannedThisRun = false;
      let activePlanRef: number | null = (task as any).plan_ref ?? null;

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
          node.status = 'DONE';
          node.result_ref = Number(task.id);
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
          const target = await identityResolverService.resolveNickname(params.target_agent_nickname, workspaceId);
          if (!target) return { content: [{ type: 'text' as const, text: `Agent not found: "${params.target_agent_nickname}". Usa el nickname EXACTO (solo alias, ej. "Bob") de [EQUIPO].` }], details: { taskId: 0 } };

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
                planDeviation = `El tracking (plan_ref=${p.plan_ref}, nodo ${node.id}) es acción propia de ${agent.nickname} (sin delegación). Ejecuta la acción del nodo y entrega el resultado.`;
                traceService.record({ ...runCtx, eventType: 'plan_deviation', eventData: { plan_ref: p.plan_ref, node_id: node.id, expected: 'local_action', attempted: target.nickname } }).catch(() => {});
                return { content: [{ type: 'text' as const, text: `Delegación bloqueada por tracking: ${planDeviation}` }], details: { taskId: 0, blocked: true } } as any;
              }
              if (norm(node.delegate_to) !== norm(target.nickname)) {
                planDeviation = `El tracking (plan_ref=${p.plan_ref}, nodo ${node.id}) exige delegar a "${node.delegate_to}"; intentaste delegar a "${target.nickname}". Ejecuta el nodo indicado (respeta cadena/intermediarios).`;
                traceService.record({ ...runCtx, eventType: 'plan_deviation', eventData: { plan_ref: p.plan_ref, node_id: node.id, expected: node.delegate_to, attempted: target.nickname } }).catch(() => {});
                return { content: [{ type: 'text' as const, text: `Delegación bloqueada por tracking: ${planDeviation}` }], details: { taskId: 0, blocked: true } } as any;
              }
              plannedNodeForDelegation = node;
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
            created_at: new Date(),
          } as any);
          delegatedThisRun = true;
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
            const planText = String(res.plan).trim();
            const countSteps = res.nodes.length;
            await planStore.create({
              plan_ref: activePlanRef,
              root_task_id: Number(currentTaskId),
              workspace_id: workspaceId ?? null,
              owner_agent_id: agent.id,
              requester: (task as any).sender_agent_id === 'user' ? 'user' : String((task as any).sender_agent_id || 'unknown'),
              raw_text: planText,
              schema: 'v2',
              nodes: res.nodes,
              parada: res.parada ?? null,
              cursor: 0,
              state: 'active',
            });
            activePlan = await loadActivePlan();
            await AgentChatEventEntity.create({
              workspace_id: workspaceId,
              agent_id: agent.id,
              task_id: Number(currentTaskId),
              run_id: runId,
              direction: 'OUTBOUND',
              kind: 'plan',
              group_id: groupId,
              seq: null,
              content: planText,
              meta: { plan_ref: activePlanRef, steps: countSteps, schema: 'v2', plannerMs, firstActivityMs, plannerModel, structured: true, debug },
            } as any).catch(() => {});
            traceService.record({ ...runCtx, eventType: 'delegation_planned', eventData: { ok: true, plannerMs, firstActivityMs, plannerModel, steps: countSteps, schema: 'v2', plan_ref: activePlanRef, structured: true, debug } }).catch(() => {});
            const view = activePlan ? planStore.formatForAgent(activePlan, agent.nickname, Number((task as any).depth ?? 0)) : planText;
            return { content: [{ type: 'text' as const, text: `Delegation tracking (sigue este plan; respeta PARADA; todos los nodos inician PENDING):\n${view}` }], details: { ok: true, plan_ref: activePlanRef, steps: countSteps, schema: 'v2', plannerMs, firstActivityMs, debug } } as any;
          } catch (e: any) {
            traceService.record({ ...runCtx, eventType: 'delegation_planned', eventData: { ok: false, reason: e?.message || String(e), reason_detail: 'tool_exception', plannerModel: agentModelRaw } }).catch(() => {});
            return { content: [{ type: 'text' as const, text: `Fallo al planificar delegación (${e?.message || e}). Continúa con tu propio criterio y delega con nicknames exactos si hace falta.` }], details: { ok: false, reason: e?.message || String(e), reason_detail: 'tool_exception' } } as any;
          }
        },
      });

      let isResumed = false;
      let sessionManager: any;
      if (agent.current_session_id && fs.existsSync(agent.current_session_id)) {
        sessionManager = SessionManager.open(agent.current_session_id);
        isResumed = true;
        console.log(`[AgentRunner] resuming session ${agent.current_session_id}`);
      } else {
        const sessionDir = path.join(process.cwd(), 'data', 'sessions', workspaceId, agent.id);
        if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });
        sessionManager = SessionManager.create(cwd, sessionDir);
        console.log(`[AgentRunner] created session in ${sessionDir}`);
      }

      const isDelegationResult = (task as any).task_flow === 'delegation_result';
      const isDelegationProgress = (task as any).task_flow === 'delegation_progress';
      const isDelegationCallback = isDelegationResult || isDelegationProgress;
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
      activePlan = await loadActivePlan();
      const activePlanBlock = activePlan
        ? (activePlan.schema === 'v2' ? planStore.formatForAgent(activePlan, agent.nickname, Number((task as any).depth ?? 0)) : planStore.formatForPrompt(activePlan))
        : null;
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
      });
      const systemPrompt = await this.promptBuilder.buildSystem({ agent, team: availableAgents });
      this.trace.turnInput(runId, agent.id, workspaceId, task.id, 'turn', promptText.length).catch(() => {});
      this.trace.record({ runId, agentId: agent.id, eventType: 'session', taskId: task.id, workspaceId, eventData: { resumedSession: isResumed, sessionId: agent.current_session_id || null, cwd, depth: (task as any).depth ?? 0, depth_path: (task as any).depth_path ?? null } }).catch(() => {});
      this.trace.record({ runId, agentId: agent.id, eventType: 'model', taskId: task.id, workspaceId, eventData: { provider: resolved.provider, modelId: resolved.modelId, raw: resolved.raw } }).catch(() => {});
      if (isDelegationCallback) this.trace.record({ runId, agentId: agent.id, eventType: 'callback_received', taskId: task.id, workspaceId, eventData: { parent_task_id: task.parent_task_id, depth: (task as any).depth ?? 0, flow: (task as any).task_flow, final: (task as any).callback_final ?? null } }).catch(() => {});
      console.log(`[AgentRunner] system prompt resolved for ${agent.nickname} (resumed=${isResumed}, callback=${(task as any).task_flow}, depth=${(task as any).depth ?? 0})`);
      this.trace.modelSet(runId, agent.id, workspaceId, task.id, resolved.provider, resolved.modelId).catch(() => {});
      agentEventEmitter.emit('agent:run:model', { runId, agentId: agent.id, taskId: task.id, state: 'ready', provider: resolved.provider, modelId: resolved.modelId, emittedAt: Date.now() });
      this.trace.start(runId, agent.id, workspaceId, task.id).catch(() => {});
      if (isDelegationCallback) this.trace.delegationResult(runId, agent.id, workspaceId, task.id).catch(() => {});
      this.trace[isResumed ? 'sessionResumed' : 'sessionCreated'](runId, agent.id, workspaceId, String((sessionManager as any)?.getSessionFile?.() || '')).catch(() => {});
      this.trace.systemPromptApplied(runId, agent.id, workspaceId, task.id, isResumed).catch(() => {});
      this.trace.turnInput(runId, agent.id, workspaceId, task.id, 'turn', promptText.length).catch(() => {});

      const hasInjectedContext = !!String(systemPrompt || '').trim();
      if (isResumed) {
        this.systemPromptInjected.add(agent.id);
      } else if (!this.systemPromptInjected.has(agent.id)) {
        if (hasInjectedContext) {
          const additional = (agent as any).additional_instruction?.trim();
          const ctx = `[SYSTEM CONTEXT · injected by Pi-Hive]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${workspaceId}).\n\n${systemPrompt}` + (additional ? `\n\n[ADDITIONAL INSTRUCTION]\n${additional}` : '');
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'system_prompt', ctx, `system-${agent.id}-${Date.now()}`).catch(() => {});
        }
        this.systemPromptInjected.add(agent.id);
      } else if (!isResumed && !isDelegationCallback) {
        // first task of new session but injection marker missing in-memory (e.g. after restart) - re-inject visibly once
        if (hasInjectedContext) {
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'system_prompt', `[SYSTEM CONTEXT · injected by Pi-Hive]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${workspaceId}).\n\n${systemPrompt}`, `system-${agent.id}-${Date.now()}`).catch(() => {});
        }
        this.systemPromptInjected.add(agent.id);
      }
      let resourceLoader: any = undefined;
      let agentDir = '';
      try { agentDir = await this.appSettings.resolvePiAgentDir(); } catch { agentDir = path.join(process.cwd(), 'data', 'pi-agent'); }
      try { resourceLoader = new (DefaultResourceLoader as any)({ cwd, agentDir, systemPrompt }); } catch (e) { console.warn('[AgentRunner] DefaultResourceLoader unavailable, using prompt injection', e); }
      console.log(`[AgentRunner] prompt built (sys=${systemPrompt.length}, task=${promptText.length}), creating AgentSession model=${resolved.raw}...`);
      const sessionOpts: any = { sessionManager, cwd, customTools: [delegateTaskTool, planDelegationTool], modelRuntime: resolved.runtime, model: resolved.model };
      if (resourceLoader) sessionOpts.resourceLoader = resourceLoader;
      const { session, modelFallbackMessage } = await createAgentSession(sessionOpts) as any;
      if (modelFallbackMessage) {
        console.warn(`[AgentRunner] model fallback agent=${agent.id} task=${task.id}: ${modelFallbackMessage}`);
        agentEventEmitter.emit('agent:run:warning', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'model_fallback', message: modelFallbackMessage, emittedAt: Date.now() });
        agentEventEmitter.emit('agent:run:model', { runId, agentId: agent.id, taskId: task.id, state: 'fallback', provider: resolved.provider, modelId: resolved.modelId, message: modelFallbackMessage, emittedAt: Date.now() });
      }
      this.applySystemPrompt(session, systemPrompt);
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

      const flushThinking = async () => {
        if (!thinkBuf) return;
        const t = thinkBuf; thinkBuf = '';
        thinkPhase += 1;
        const summary = t.replace(/\s+/g, ' ').trim().slice(0, 80);
        const payload = JSON.stringify({ summary, text: t, phase: thinkPhase });
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'thinking', payload, groupId).catch(() => {});
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
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'tool_call', payload, groupId).catch(() => {});
      };

      const pickAssistantMeta = (ev: any) => {
        const msgs = ev?.messages || ev?.result?.messages || [];
        for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m?.role === 'assistant') { if (m.stopReason) lastStopReason = m.stopReason; if (m.errorMessage) lastErrorMessage = m.errorMessage; } }
      };

      const unsubscribe = session.subscribe((event: any) => {
        if (event.type === 'message_update' && event.assistantMessageEvent) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta' && ame.delta) { if (discardStreamingEvents) return; flushThinking().catch(() => {}); assistantText += ame.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: ame.delta, kind: 'text', emittedAt: Date.now() }); this.trace.textOutput(runId, agent.id, workspaceId, task.id, ame.delta.length).catch(() => {}); }
          if (ame.type === 'thinking_delta' && ame.delta) { if (discardStreamingEvents) return; thinkBuf += ame.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: ame.delta, kind: 'thinking', emittedAt: Date.now() }); this.trace.thinking(runId, agent.id, workspaceId, task.id, ame.delta.length).catch(() => {}); }
          if (ame.type === 'toolcall_start') { const tc = ame.toolCall || {}; if (discardStreamingEvents) return; toolCallsTotal++; flushThinking().catch(() => {}); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(tc.name || ''), JSON.stringify(tc.arguments||'')).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'start', toolName: tc.name, toolCallId: tc.id, args: tc.arguments, emittedAt: Date.now() }); saveToolEvent('start', { toolName: tc.name, toolCallId: tc.id, args: tc.arguments }).catch(() => {}); }
          if (ame.type === 'toolcall_end') { const tc = ame.toolCall || {}; if (discardStreamingEvents) return; agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'call', toolName: tc.name, toolCallId: tc.id, args: tc.arguments, emittedAt: Date.now() }); saveToolEvent('call', { toolName: tc.name, toolCallId: tc.id, args: tc.arguments }).catch(() => {}); }
          if (ame.error) { runError = String(ame.error?.message || ame.error); lastErrorMessage = runError; }
        }
        if (event.type === 'text_delta' && event.delta) { if (discardStreamingEvents) return; flushThinking().catch(() => {}); assistantText += event.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: event.delta, kind: 'text', emittedAt: Date.now() }); }
        if (event.type === 'tool_execution_start') { if (discardStreamingEvents) return; toolCallsTotal++; flushThinking().catch(() => {}); const s = JSON.stringify({ tool: event.toolName, args: event.args }); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(event.toolName||''), s).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'start', toolName: event.toolName, toolCallId: event.toolCallId, args: event.args, emittedAt: Date.now() }); saveToolEvent('start', { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args }).catch(() => {}); }
        if (event.type === 'tool_execution_end') { if (discardStreamingEvents) return; const resultSummaryFull = toResultSummary(event.result); this.trace.toolResult(runId, agent.id, workspaceId, task.id, String(event.toolName||''), !!event.isError, resultSummaryFull.length).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: event.isError ? 'error' : 'end', toolName: event.toolName, toolCallId: event.toolCallId, resultSummary: event.isError ? resultSummaryFull.slice(0, 300) : undefined, emittedAt: Date.now() }); saveToolEvent(event.isError ? 'error' : 'end', { toolName: event.toolName, toolCallId: event.toolCallId, resultSummary: resultSummaryFull, isError: !!event.isError }).catch(() => {}); }
        if (event.type === 'tool_call' && event.toolName) { if (discardStreamingEvents) return; toolCallsTotal++; flushThinking().catch(() => {}); const s = JSON.stringify({ tool: event.toolName, args: event.args }); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(event.toolName||''), s).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'call', toolName: event.toolName, toolCallId: event.toolCallId, args: event.args, emittedAt: Date.now() }); saveToolEvent('call', { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args }).catch(() => {}); }
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
        await runPromptOnce(`[SYSTEM NUDGE · reintento automático]\nTu turno anterior se cortó por límite de longitud SIN completar ninguna acción ni respuesta. Responde AHORA de forma concisa y directa, en 1-2 líneas: ejecuta tu primer acto (plan_delegation si la tarea requiere cadena, o delegate_task al responsable directo, o entrega el resultado solicitado). NO repitas razonamiento ni expliques lo que vas a hacer, actúa.`);
        text = assistantText.trim();
        stopped = !this.activeSessions.has(agent.id) || settledAborted;
      }
      console.log(`[AgentRunner] prompt finished task=${task.id} run=${runId} stopReason=${lastStopReason} err=${runError || lastErrorMessage || ''} aborted=${settledAborted} retry=${willRetry} nudged=${retryNudged} delegated=${delegatedThisRun}`);
      this.activeSessions.delete(agent.id);
      unsubscribe();

      await finalizeOnce(async () => {
        const durationMs = Date.now() - startedAt;
        if (stopped) {
          // stopAgent may have already finalized the task; do not create a new PENDING wake-up.
          const freshStop = await this.taskQueueRepository.get(task.id).catch(() => null);
          if (freshStop && freshStop.status !== 'STOPPED') {
            const stopMsg = '⏹️ Solicitud detenida por intervención del usuario (stop).';
            freshStop.status = 'STOPPED' as any;
            (freshStop as any).response = stopMsg;
            await this.taskQueueRepository.update(freshStop);
            try { await this.saveChatEvent(workspaceId, agent.id, freshStop, 'OUTBOUND', 'response', stopMsg, groupId); } catch {}
          }
          this.trace.close(runId, agent.id, workspaceId, task.id, 'stopped', lastStopReason || 'user_stop', durationMs, false).catch(() => {});
          agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId, taskId: task.id, runId, outcome: 'stopped', stopReason: lastStopReason || 'user_stop', aborted: true, willRetry: false, durationMs, emittedAt: Date.now() });
          return;
        }

        const finalErr = runError || lastErrorMessage || (lastStopReason === 'error' ? 'assistant error' : null);
        if (finalErr) {
          task.status = 'HOLD' as any;
          (task as any).response = `⚠️ Error de ejecución: ${String(finalErr).slice(0, 600)}`;
          await this.taskQueueRepository.update(task);
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', (task as any).response, groupId).catch(() => {});
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
          await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', msg, groupId).catch(() => {});
          this.trace.error(runId, agent.id, workspaceId, task.id, 'output_length_exhausted_no_action', JSON.stringify({ stopReason: lastStopReason, delegatedThisRun, toolCallsTotal, nudged: retryNudged })).catch(() => {});
          this.trace.close(runId, agent.id, workspaceId, task.id, 'output_length_no_action', lastStopReason || undefined, durationMs, false).catch(() => {});
          agentEventEmitter.emit('agent:run:warning', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'output_length_exhausted_no_action', message: 'Exhausted length with no action/response after retry', emittedAt: Date.now() });
          agentEventEmitter.emit('agent:run:finished', { agentId: agent.id, workspaceId, taskId: task.id, runId, outcome: 'error', stopReason: lastStopReason, errorMessage: 'output_length_exhausted_no_action', willRetry: false, aborted: false, durationMs, emittedAt: Date.now() });
          agent.current_session_id = sessionFile ? String(sessionFile) : agent.current_session_id;
          return;
        }

        const responseText = text || (delegatedThisRun ? '(delegación en curso; sin texto adicional)' : `(no text output, stopReason=${lastStopReason || 'unknown'})`);
        const outcome = text ? 'completed' : (delegatedThisRun ? 'delegated' : 'completed_empty');
        if (!text && !delegatedThisRun) console.warn(`[AgentRunner] empty response task=${task.id} run=${runId} model=${resolved.raw} stopReason=${lastStopReason}`);
        const summaryText = responseText.slice(0, 500);
        await this.agentMemoryRepository.add({ agent_id: agent.id, session_id: String(sessionFile || ''), compacted_summary: summaryText, created_at: new Date() } as any);
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'response', responseText, groupId).catch(() => {});
        agent.current_session_id = sessionFile ? String(sessionFile) : agent.current_session_id;
        task.status = 'COMPLETED' as any;
        (task as any).response = responseText;
        await this.taskQueueRepository.update(task);
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
                    callback_context: (origin as any)?.callback_context ?? (task as any).callback_context ?? (origin as any)?.payload ?? task.payload,
                    plan_ref: cbPlanRef,
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
                    payload: `[DELEGATION PROGRESS from ${agent.nickname} | state=PROGRESS(intermedio,no-final) | task=#${task.id} | request=#${origin?.id ?? task.id} | origin=#${origin?.id ?? task.id} | parent=#${(task as any).parent_task_id ?? '-'} | depth=${originDepth} | branch=${originPath}/progress]\n${responseText}`,
                    status: 'PENDING' as any,
                    parent_task_id: task.id,
                    workspace_id: workspaceId,
                    task_flow: 'delegation_progress',
                    depth: originDepth,
                    depth_path: `${originPath}/progress`,
                    parent_task_callback: true,
                    callback_final: false,
                    callback_context: (origin as any)?.callback_context ?? (task as any).callback_context ?? task.payload,
                    plan_ref: cbPlanRef,
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
                  payload: `[DELEGATION PROGRESS from ${agent.nickname} | state=PROGRESS(intermedio,no-final) | task=#${task.id} | request=#${task.id} | origin=#${task.id} | parent=#${(task as any).parent_task_id ?? '-'} | depth=${cbDepth} | branch=${parentDepthPath}/progress]\n${responseText}`,
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
        const team = (await this.agentRepository.getAll()).filter((a: any) => a.status !== 'PAUSED' && !a.archived_at);
        const sp = await this.promptBuilder.buildSystem({ agent, team } as any);
        if (String(sp || '').trim()) {
          const additional = (agent as any).additional_instruction?.trim();
          const ctx = `[SYSTEM CONTEXT · injected by Pi-Hive (post-clear)]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${agent.workspace_id}).\n\n${sp}` + (additional ? `\n\n[ADDITIONAL INSTRUCTION]\n${additional}` : '');
          await AgentChatEventEntity.create({ workspace_id: agent.workspace_id, agent_id: agent.id, task_id: null, parent_task_id: null, direction: 'OUTBOUND', kind: 'system_prompt', content: ctx, collapsible_group_id: `system-${agent.id}-${Date.now()}`, created_at: new Date() } as any);
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

  private async saveChatEvent(workspaceId: string, agentId: string, task: ITaskQueue, direction: 'INBOUND' | 'OUTBOUND', kind: string, content: string, groupId: string) {
    try { await AgentChatEventEntity.create({ workspace_id: workspaceId, agent_id: agentId, task_id: task.id, parent_task_id: task.parent_task_id ?? null, direction, kind, content, collapsible_group_id: groupId, created_at: new Date() } as any); } catch {}
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
