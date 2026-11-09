import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Type } from '@sinclair/typebox';
import { createAgentSession, defineTool, SessionManager } from '@earendil-works/pi-coding-agent';
import type { AgentSession } from '@earendil-works/pi-coding-agent';

import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IAgentRepository, IAgentRepositoryToken } from '../agent/domain/repositories/agent-repository.interface.js';
import { ITaskQueue } from '../task-queue/domain/models/task-queue.interface.js';
import { ITaskQueueRepository, ITaskQueueRepositoryToken } from '../task-queue/domain/repositories/task-queue-repository.interface.js';
import { IAgentMemory } from '../agent-memory/domain/models/agent-memory.interface.js';
import { IAgentMemoryRepository, IAgentMemoryRepositoryToken } from '../agent-memory/domain/repositories/agent-memory-repository.interface.js';
import { IdentityResolverService } from './identity-resolver.service.js';
import { taskEventEmitter } from '../task-queue/infra/persistence/sequalize/entities/task-queue.schema.js';
import { EventEmitter } from 'events';
import { AgentStatus } from '../agent/domain/models/agent-status.enum.js';
export const agentEventEmitter = new EventEmitter();

@Injectable()
export class AgentRunnerService implements OnModuleInit {
  private activeSessions = new Map<string, AgentSession>();
  private processingAgents = new Set<string>();
  private pendingByAgent = new Map<string, ITaskQueue[]>();

  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
    @Inject(ITaskQueueRepositoryToken) private taskQueueRepository: ITaskQueueRepository,
    @Inject(IAgentMemoryRepositoryToken) private agentMemoryRepository: IAgentMemoryRepository,
    @Inject(IdentityResolverService) private identityResolverService: IdentityResolverService,
  ) {}

  async stopAgent(agentId: string): Promise<boolean> {
    const session = this.activeSessions.get(agentId);
    if (session) {
      try {
        await session.abort();
      } catch (e) {
        console.error(`[AgentRunner] Error aborting session for ${agentId}:`, e);
      }
      this.activeSessions.delete(agentId);
      const agent = await this.agentRepository.get(agentId);
      if (agent) {
        agent.status = AgentStatus.IDLE;
        await this.agentRepository.update(agent);
        agentEventEmitter.emit('agent:status-change', { agentId: agent.id, status: agent.status });
      }
      return true;
    }
    return false;
  }

  async onModuleInit() {
    console.log('[AgentRunner] Initializing...');
    taskEventEmitter.on('task:pending', (task: ITaskQueue) => {
      console.log(`[AgentRunner] Received task:pending event for task ${task.id} -> ${task.receiver_agent_id}`);
      this.handlePendingTask(task).catch((err) => {
        console.error('Error handling pending task:', err);
      });
    });
    agentEventEmitter.on('agent:stop', (agentId: string) => {
      this.stopAgent(agentId).catch((err) => console.error('Error stopping agent:', err));
    });
    try {
      const pending = await this.taskQueueRepository.findByStatus('PENDING');
      console.log(`[AgentRunner] Found ${pending.length} pending tasks on init`);
      for (const task of pending) {
        console.log(`[AgentRunner] Processing pending task ${task.id} -> ${task.receiver_agent_id}`);
        this.handlePendingTask(task).catch((err) => {
          console.error('Error handling pending task:', err);
        });
      }
    } catch (err) {
      console.error('Error loading pending tasks on init:', err);
    }
  }

  private async handlePendingTask(task: ITaskQueue): Promise<void> {
    console.log(`[AgentRunner] handlePendingTask: task=${task.id} receiver=${task.receiver_agent_id} status=${task.status}`);
    if (task.status !== 'PENDING') {
      console.log(`[AgentRunner] Skipping task ${task.id} — status is ${task.status}, not PENDING`);
      return;
    }

    const agentId = task.receiver_agent_id;
    if (this.processingAgents.has(agentId)) {
      console.log(`[AgentRunner] Agent ${agentId} busy — queuing task ${task.id}`);
      const q = this.pendingByAgent.get(agentId) || [];
      if (!q.find((t) => t.id === task.id)) q.push(task);
      this.pendingByAgent.set(agentId, q);
      return;
    }
    this.processingAgents.add(agentId);

    try {
      await this.executeTask(task);
    } finally {
      this.processingAgents.delete(agentId);
      // Drain next queued task for this agent
      const q = this.pendingByAgent.get(agentId) || [];
      const next = q.shift();
      this.pendingByAgent.set(agentId, q);
      if (next) {
        const fresh = await this.taskQueueRepository.get(next.id).catch(() => null);
        if (fresh && fresh.status === 'PENDING') {
          this.handlePendingTask(fresh).catch((err) => console.error('Error draining queued task:', err));
        } else if (q.length) {
          const n2 = q.shift();
          this.pendingByAgent.set(agentId, q);
          if (n2) {
            const f2 = await this.taskQueueRepository.get(n2.id).catch(() => null);
            if (f2 && f2.status === 'PENDING') this.handlePendingTask(f2).catch(() => {});
          }
        }
      }
    }
  }

  private async executeTask(task: ITaskQueue): Promise<void> {
    const agent = await this.agentRepository.get(task.receiver_agent_id);
    if (!agent) {
      console.error(`Agent not found: ${task.receiver_agent_id}`);
      return;
    }
    const current = await this.taskQueueRepository.get(task.id);
    if (!current || current.status !== 'PENDING') {
      console.log(`[AgentRunner] Task ${task.id} no longer PENDING, skipping`);
      return;
    }
    task = current;
    console.log(`[AgentRunner] Agent found: ${agent.id} status=${agent.status}`);

    // Mark task PROCESSING and agent WORKING
    task.status = 'PROCESSING' as any;
    await this.taskQueueRepository.update(task);
    agent.status = AgentStatus.WORKING;
    await this.agentRepository.update(agent);
    agentEventEmitter.emit('agent:status-change', { agentId: agent.id, status: agent.status });
    console.log(`[AgentRunner] Agent ${agent.id} set to WORKING, starting execution...`);

    let stopped = false;

    try {
      const availableAgents = await this.identityResolverService.getAvailableAgents(agent.workspace_id ?? undefined);
      const promptText = await this.buildTaskPrompt(task.payload, agent, availableAgents);

      const agentRepository = this.agentRepository;
      const taskQueueRepository = this.taskQueueRepository;
      const identityResolverService = this.identityResolverService;
      const currentTaskId = task.id;
      const senderAgentId = agent.id;
      const workspaceId = agent.workspace_id ?? undefined;

      const delegateTaskTool = defineTool({
        name: 'delegate_task',
        label: 'Delegate Task',
        description: 'Delegate a task to another agent by nickname',
        parameters: Type.Object({
          target_agent_nickname: Type.String({ description: 'Nickname of the target agent' }),
          instruction: Type.String({ description: 'Instruction for the target agent' }),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
          const target = await identityResolverService.resolveNickname(params.target_agent_nickname, workspaceId);
          const newTask = await taskQueueRepository.add({
            sender_agent_id: senderAgentId,
            receiver_agent_id: target ? target.id : params.target_agent_nickname,
            payload: params.instruction,
            status: 'PENDING' as any,
            parent_task_id: currentTaskId,
            created_at: new Date(),
          } as any);
          return {
            content: [{ type: 'text', text: `Delegated task ${newTask.id}` }],
            details: { taskId: newTask.id },
          };
        },
      });

      const { session } = await createAgentSession({
        sessionManager: this.resolveSessionManager(agent),
        cwd: process.cwd(),
        customTools: [delegateTaskTool],
      });
      this.activeSessions.set(agent.id, session);

      let assistantText = '';
      const unsubscribe = session.subscribe((event: any) => {
        // Pi SDK emits message_update with assistantMessageEvent
        if (event.type === 'message_update' && event.assistantMessageEvent) {
          const ame = event.assistantMessageEvent;
          if (ame.type === 'text_delta' && ame.delta) {
            assistantText += ame.delta;
            agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, delta: ame.delta });
          }
          if (ame.type === 'thinking_delta' && ame.delta) {
            agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, delta: ame.delta, kind: 'thinking' });
          }
          if (ame.type === 'toolcall_end' && ame.toolCall) {
            agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, toolName: ame.toolCall.name, args: ame.toolCall.arguments });
          }
        }
        // Also handle direct event shapes
        if (event.type === 'text_delta' && event.delta) {
          assistantText += event.delta;
          agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, delta: event.delta });
        }
        if (event.type === 'tool_execution_start') {
          agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, toolName: event.toolName, args: event.args });
        }
        if (event.type === 'tool_call' && event.toolName) {
          agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, toolName: event.toolName, args: event.args });
        }
      });

      await session.prompt(promptText);

      // Check if stopped externally
      if (!this.activeSessions.has(agent.id)) {
        stopped = true;
      }
      this.activeSessions.delete(agent.id);
      unsubscribe();

      if (stopped) {
        task.status = 'HOLD' as any;
        await this.taskQueueRepository.update(task);
        return;
      }

      const sessionFile = (session as any).sessionManager?.getSessionFile?.() ?? (session as any).sessionId;
      const summaryText = assistantText.trim().slice(0, 500) || `Task: ${task.payload.substring(0, 100)}`;
      await this.agentMemoryRepository.add({
        agent_id: agent.id,
        session_id: String(sessionFile),
        compacted_summary: summaryText,
        created_at: new Date(),
      } as any);

      agent.current_session_id = sessionFile ? String(sessionFile) : null;
      agent.status = AgentStatus.IDLE;
      await this.agentRepository.update(agent);
      agentEventEmitter.emit('agent:status-change', { agentId: agent.id, status: agent.status });

      task.status = 'COMPLETED' as any;
      (task as any).response = assistantText.trim() || summaryText;
      await this.taskQueueRepository.update(task);

      // Auto-reply to sender (usual communication mechanism) — sender gets ONLY the final response
      if (task.sender_agent_id && task.sender_agent_id !== 'user') {
        await this.taskQueueRepository.add({
          sender_agent_id: agent.id,
          receiver_agent_id: task.sender_agent_id,
          payload: assistantText.trim() || '(no response text)',
          status: 'PENDING' as any,
          parent_task_id: task.id,
          created_at: new Date(),
        } as any);
      }
    } catch (error) {
      console.error(`Error running agent ${agent.id}:`, error);
      this.activeSessions.delete(agent.id);
      agent.status = AgentStatus.IDLE;
      await this.agentRepository.update(agent);
      agentEventEmitter.emit('agent:status-change', { agentId: agent.id, status: agent.status });
      task.status = 'HOLD' as any;
      await this.taskQueueRepository.update(task);
    }
  }

  private resolveSessionManager(agent: IAgent): SessionManager {
    const fs = require('fs');
    const sessionPath = agent.current_session_id;
    if (sessionPath && typeof sessionPath === 'string' && fs.existsSync(sessionPath)) {
      try {
        console.log(`[AgentRunner] Resuming session for ${agent.id}: ${sessionPath}`);
        return SessionManager.open(sessionPath);
      } catch (e) {
        console.warn(`[AgentRunner] Could not open session for ${agent.id}, creating new:`, e);
      }
    }
    const sessionDir = `${process.cwd()}/data/sessions/${agent.id}`;
    try { fs.mkdirSync(sessionDir, { recursive: true }); } catch {}
    console.log(`[AgentRunner] Creating new session for ${agent.id} in ${sessionDir}`);
    return SessionManager.create(process.cwd(), sessionDir);
  }

  async clearAgentSession(agentId: string): Promise<void> {
    const agent = await this.agentRepository.get(agentId);
    if (!agent) return;
    await this.stopAgent(agentId).catch(() => {});
    agent.current_session_id = null;
    agent.status = AgentStatus.IDLE;
    await this.agentRepository.update(agent);
    agentEventEmitter.emit('agent:status-change', { agentId: agent.id, status: agent.status });
  }

  private async buildTaskPrompt(taskPayload: string, agent: IAgent, availableAgents: IAgent[] = []): Promise<string> {
    const agentDir = availableAgents
      .filter((a) => a.nickname && a.id !== agent.id)
      .map((a) => `- ${a.nickname} (role: ${a.role})`)
      .join('\n') || 'None';

    return `# INSTRUCCIONES DEL ENJAMBRE
Eres un agente especializado de Pi-Hive.
Tu nickname es "${agent.nickname}". Rol: ${agent.role}.
Para delegar tareas a otros agentes, usa la herramienta delegate_task(target_agent_nickname, instruction).
Mantén el contexto de la conversación previa en esta sesión. Si el usuario hace referencia a algo anterior, usa el historial.
Responde de forma clara y concisa con el resultado final de la tarea.

# AGENTES DISPONIBLES EN EL WORKSPACE
${agentDir}

# TAREA / SOLICITUD
${taskPayload}`;
  }
}
