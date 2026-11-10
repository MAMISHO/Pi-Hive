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

  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
    @Inject(ITaskQueueRepositoryToken) private taskQueueRepository: ITaskQueueRepository,
    @Inject(IAgentMemoryRepositoryToken) private agentMemoryRepository: IAgentMemoryRepository,
    @Inject(IWorkspaceRepositoryToken) private workspaceRepository: IWorkspaceRepository,
    @Inject(IdentityResolverService) private identityResolverService: IdentityResolverService,
    @Inject(PromptBuilderService) private promptBuilder: PromptBuilderService,
    @Inject(RunTraceService) private trace: RunTraceService,
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
      if (!this.cachedRuntime) this.cachedRuntime = await (ModelRuntime as any).create({ refreshOnCreate: false, allowModelNetwork: false });
      let model = this.cachedRuntime.getModel?.(provider, modelId) ?? this.cachedRuntime.getPhysicalModel?.(provider, modelId);
      if (!model) { // retry once with a fresh runtime snapshot
        this.cachedRuntime = await (ModelRuntime as any).create({ refreshOnCreate: false, allowModelNetwork: false });
        model = this.cachedRuntime.getModel?.(provider, modelId) ?? this.cachedRuntime.getPhysicalModel?.(provider, modelId);
      }
      if (!model) return { ok: false, raw, provider, modelId, reason: `model not found in Pi runtime: ${provider}/${modelId}` };
      return { ok: true, provider, modelId, raw, model, runtime: this.cachedRuntime };
    } catch (e: any) {
      this.cachedRuntime = null;
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

      const taskQueueRepository = this.taskQueueRepository;
      const identityResolverService = this.identityResolverService;
      const currentTaskId = task.id;
      const senderAgentId = agent.id;
      const parentDepth = Number((task as any).depth ?? 0);
      const parentDepthPath = String((task as any).depth_path || `/root/${agent.nickname}`);

      let delegatedThisRun = false;
      const delegateTaskTool = defineTool({
        name: 'delegate_task',
        label: 'Delegate Task',
        description: 'Delega una tarea a otro agente por nickname EXACTO (solo el alias, p.ej. "Bob"; NO uses "Bob (WORKER)"). Asíncrono: NO esperes/pollees; termina tu turno y el resultado llegará como [DELEGATION RESULT]. En "instruction" pasa el PLAN COMPLETO para el agente (sub-objetivos, qué debe hacer con su resultado y a quién devolverlo). NO uses delegate_task para reportar/informar resultados al solicitante o a quien te delegó: devuelve el resultado en tu respuesta y el runtime lo enruta.',
        parameters: Type.Object({
          target_agent_nickname: Type.String({ description: 'Nickname EXACTO del agente destino (solo alias, ej. "Pam"; sin sufijo de rol)' }),
          instruction: Type.String({ description: 'Instrucción/plan completo para el agente destino' }),
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
            return { content: [{ type: 'text' as const, text: `No delegues al remitente (${params.target_agent_nickname}) para reportar. Devuelve el resultado en tu respuesta; el runtime lo enruta.` }], details: { taskId: 0 } };
          }
          // F5: depth/cycle guard
          const nextDepth = parentDepth + 1;
          if (nextDepth > 8) {
            return { content: [{ type: 'text' as const, text: `Delegación bloqueada: profundidad máxima alcanzada (depth ${nextDepth}). Resuelve localmente y devuelve el resultado.` }], details: { taskId: 0 } };
          }

          const newTask = await taskQueueRepository.add({
            sender_agent_id: senderAgentId,
            receiver_agent_id: target.id,
            payload: params.instruction,
            status: 'PENDING' as any,
            parent_task_id: currentTaskId,
            workspace_id: workspaceId,
            task_flow: 'direct',
            depth: Math.min(nextDepth, 8),
            depth_path: `${parentDepthPath}/${target.nickname}`,
            parent_task_callback: false,
            callback_context: task.payload, // original instruction so the delegator can resume
            created_at: new Date(),
          } as any);
          delegatedThisRun = true;
          return { content: [{ type: 'text' as const, text: `Delegated task ${newTask.id} to ${target.nickname} (depth ${nextDepth}). Recibirás un [DELEGATION RESULT] — NO esperes/pollees; completa tu turno y continúa cuando llegue.` }], details: { taskId: Number(newTask.id) } };
        },
      });

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

      if (isResumed) {
        this.systemPromptInjected.add(agent.id);
      } else if (!this.systemPromptInjected.has(agent.id)) {
        const additional = (agent as any).additional_instruction?.trim();
        const ctx = `[SYSTEM CONTEXT · injected by Pi-Hive]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${workspaceId}).\n\n${systemPrompt}` + (additional ? `\n\n[ADDITIONAL INSTRUCTION]\n${additional}` : '');
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'system_prompt', ctx, `system-${agent.id}-${Date.now()}`).catch(() => {});
        this.systemPromptInjected.add(agent.id);
      } else if (!isResumed && !isDelegationCallback) {
        // first task of new session but injection marker missing in-memory (e.g. after restart) - re-inject visibly once
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'system_prompt', `[SYSTEM CONTEXT · injected by Pi-Hive]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${workspaceId}).\n\n${systemPrompt}`, `system-${agent.id}-${Date.now()}`).catch(() => {});
        this.systemPromptInjected.add(agent.id);
      }
      let resourceLoader: any = undefined;
      try { resourceLoader = new (DefaultResourceLoader as any)({ cwd, agentDir: path.join(process.cwd(), 'data', 'pi-agent'), systemPrompt }); } catch (e) { console.warn('[AgentRunner] DefaultResourceLoader unavailable, using prompt injection', e); }
      console.log(`[AgentRunner] prompt built (sys=${systemPrompt.length}, task=${promptText.length}), creating AgentSession model=${resolved.raw}...`);
      const sessionOpts: any = { sessionManager, cwd, customTools: [delegateTaskTool], modelRuntime: resolved.runtime, model: resolved.model };
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

      const flushThinking = async () => {
        if (!thinkBuf) return;
        const t = thinkBuf; thinkBuf = '';
        thinkPhase += 1;
        const summary = t.replace(/\s+/g, ' ').trim().slice(0, 80);
        const payload = JSON.stringify({ summary, text: t, phase: thinkPhase });
        await this.saveChatEvent(workspaceId, agent.id, task, 'OUTBOUND', 'thinking', payload, groupId).catch(() => {});
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
          if (ame.type === 'text_delta' && ame.delta) { flushThinking().catch(() => {}); assistantText += ame.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: ame.delta, kind: 'text', emittedAt: Date.now() }); this.trace.textOutput(runId, agent.id, workspaceId, task.id, ame.delta.length).catch(() => {}); }
          if (ame.type === 'thinking_delta' && ame.delta) { thinkBuf += ame.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: ame.delta, kind: 'thinking', emittedAt: Date.now() }); this.trace.thinking(runId, agent.id, workspaceId, task.id, ame.delta.length).catch(() => {}); }
          if (ame.type === 'toolcall_start') { const tc = ame.toolCall || {}; flushThinking().catch(() => {}); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(tc.name || ''), JSON.stringify(tc.arguments||'')).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'start', toolName: tc.name, toolCallId: tc.id, args: tc.arguments, emittedAt: Date.now() }); saveToolEvent('start', { toolName: tc.name, toolCallId: tc.id, args: tc.arguments }).catch(() => {}); }
          if (ame.type === 'toolcall_end') { const tc = ame.toolCall || {}; agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'call', toolName: tc.name, toolCallId: tc.id, args: tc.arguments, emittedAt: Date.now() }); saveToolEvent('call', { toolName: tc.name, toolCallId: tc.id, args: tc.arguments }).catch(() => {}); }
          if (ame.error) { runError = String(ame.error?.message || ame.error); lastErrorMessage = runError; }
        }
        if (event.type === 'text_delta' && event.delta) { flushThinking().catch(() => {}); assistantText += event.delta; agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, delta: event.delta, kind: 'text', emittedAt: Date.now() }); }
        if (event.type === 'tool_execution_start') { flushThinking().catch(() => {}); const s = JSON.stringify({ tool: event.toolName, args: event.args }); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(event.toolName||''), s).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'start', toolName: event.toolName, toolCallId: event.toolCallId, args: event.args, emittedAt: Date.now() }); saveToolEvent('start', { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args }).catch(() => {}); }
        if (event.type === 'tool_execution_end') { this.trace.toolResult(runId, agent.id, workspaceId, task.id, String(event.toolName||''), !!event.isError, JSON.stringify(event.result||'').length).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: event.isError ? 'error' : 'end', toolName: event.toolName, toolCallId: event.toolCallId, resultSummary: event.isError ? String(event.result || 'error').slice(0, 300) : undefined, emittedAt: Date.now() }); saveToolEvent(event.isError ? 'error' : 'end', { toolName: event.toolName, toolCallId: event.toolCallId, resultSummary: event.isError ? String(event.result || 'error').slice(0, 800) : String(event.result ?? '').slice(0, 800), isError: !!event.isError }).catch(() => {}); }
        if (event.type === 'tool_call' && event.toolName) { flushThinking().catch(() => {}); const s = JSON.stringify({ tool: event.toolName, args: event.args }); this.trace.toolCall(runId, agent.id, workspaceId, task.id, String(event.toolName||''), s).catch(() => {}); agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, workspaceId, taskId: task.id, runId, seq: ++seq, phase: 'call', toolName: event.toolName, toolCallId: event.toolCallId, args: event.args, emittedAt: Date.now() }); saveToolEvent('call', { toolName: event.toolName, toolCallId: event.toolCallId, args: event.args }).catch(() => {}); }
        if (event.type === 'agent_end') { willRetry = !!event.willRetry; pickAssistantMeta(event); flushThinking().catch(() => {}); }
        if (event.type === 'agent_settled') { settledAborted = !!event.aborted; }
        if (event.type === 'auto_retry_start') { willRetry = true; agentEventEmitter.emit('agent:run:warning', { agentId: agent.id, workspaceId, taskId: task.id, runId, code: 'auto_retry', message: `retry ${event.attempt ?? ''}`, emittedAt: Date.now() }); }
        if (event.type === 'auto_retry_end' && !event.success) { runError = runError || String(event.finalError || 'retry failed'); }
      });

      try {
        await session.prompt(promptText);
      } catch (e: any) {
        runError = runError || String(e?.message || e);
        console.error(`[AgentRunner] prompt error task=${task.id} run=${runId}:`, e);
      }
      console.log(`[AgentRunner] prompt finished task=${task.id} run=${runId} stopReason=${lastStopReason} err=${runError || lastErrorMessage || ''} aborted=${settledAborted} retry=${willRetry}`);
      await flushThinking();
      stopped = !this.activeSessions.has(agent.id) || settledAborted;
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
        const text = assistantText.trim();
        const responseText = text || `(no text output, stopReason=${lastStopReason || 'unknown'})`;
        const outcome = text ? 'completed' : 'completed_empty';
        if (!text) console.warn(`[AgentRunner] empty response task=${task.id} run=${runId} model=${resolved.raw} stopReason=${lastStopReason}`);
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
                    created_at: new Date(),
                  } as any);
                  this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_result_final_enqueued', taskId: task.id, workspaceId, eventData: { to: targetSender, depth: originDepth, originTaskId: origin?.id ?? null } }).catch(() => {});
                }
              } else {
                this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_result_consumed', taskId: task.id, workspaceId, eventData: { returnedTo: targetSender || 'closed' } }).catch(() => {});
              }
            } else {
              // delegated further while consuming; intermediate progress must bubble UP to origin delegator (F3), never down to leaf
              if (targetSender && targetSender !== 'user') {
                const key = `${workspaceId}|${targetSender}|${origin?.id ?? task.id}|delegation_progress|0`;
                if (shouldEnqueueCallback(key)) {
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
                    created_at: new Date(),
                  } as any);
                  this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_progress_enqueued', taskId: task.id, workspaceId, eventData: { to: targetSender, depth: originDepth } }).catch(() => {});
                }
              }
              this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_waiting_subchain', taskId: task.id, workspaceId, eventData: { depth: (task as any).depth ?? 0 } }).catch(() => {});
            }
          } else {
            const cbDepth = Math.max(0, parentDepth);
            if (!delegatedThisRun) {
              const key = `${workspaceId}|${task.sender_agent_id}|${task.id}|delegation_result|1|direct`;
              if (shouldEnqueueCallback(key)) {
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
                  created_at: new Date(),
                } as any);
                this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_result_final_enqueued', taskId: task.id, workspaceId, eventData: { to: task.sender_agent_id, depth: cbDepth } }).catch(() => {});
              }
            } else {
              // delegated during this turn: send intermediate progress (wakes delegator) but not final
              const key = `${workspaceId}|${task.sender_agent_id}|${task.id}|delegation_progress|0|direct`;
              if (shouldEnqueueCallback(key)) {
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
                  created_at: new Date(),
                } as any);
                this.trace.record({ runId, agentId: agent.id, eventType: 'delegation_progress_enqueued', taskId: task.id, workspaceId, eventData: { to: task.sender_agent_id, depth: cbDepth } }).catch(() => {});
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
        const additional = (agent as any).additional_instruction?.trim();
        const ctx = `[SYSTEM CONTEXT · injected by Pi-Hive (post-clear)]\nEres ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${agent.workspace_id}).\n\n${sp}` + (additional ? `\n\n[ADDITIONAL INSTRUCTION]\n${additional}` : '');
        await AgentChatEventEntity.create({ workspace_id: agent.workspace_id, agent_id: agent.id, task_id: null, parent_task_id: null, direction: 'OUTBOUND', kind: 'system_prompt', content: ctx, collapsible_group_id: `system-${agent.id}-${Date.now()}`, created_at: new Date() } as any);
        this.systemPromptInjected.add(agentId);
      } catch {}
    }
    this.systemPromptInjected.add(agentId);
    this.activeSessions.delete(agentId);
    await this.agentRepository.update({ ...agent, status: 'IDLE', current_session_id: null } as any);
    this.emitStatus(agentId, 'IDLE', (agent as any).workspace_id, null, null, 'session_clear');
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
