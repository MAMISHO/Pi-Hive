import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { createAgentSession, SessionManager } from '@earendil-works/pi-coding-agent';

import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IAgentRepository, IAgentRepositoryToken } from '../agent/domain/repositories/agent-repository.interface.js';
import { ITaskQueue } from '../task-queue/domain/models/task-queue.interface.js';
import { ITaskQueueRepository, ITaskQueueRepositoryToken } from '../task-queue/domain/repositories/task-queue-repository.interface.js';
import { IAgentMemory } from '../agent-memory/domain/models/agent-memory.interface.js';
import { IAgentMemoryRepository, IAgentMemoryRepositoryToken } from '../agent-memory/domain/repositories/agent-memory-repository.interface.js';
import { taskEventEmitter } from '../task-queue/infra/persistence/sequalize/entities/task-queue.schema.js';
import { EventEmitter } from 'events';
import { AgentStatus } from '../agent/domain/models/agent-status.enum.js';
export const agentEventEmitter = new EventEmitter();

@Injectable()
export class AgentRunnerService implements OnModuleInit {
  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
    @Inject(ITaskQueueRepositoryToken) private taskQueueRepository: ITaskQueueRepository,
    @Inject(IAgentMemoryRepositoryToken) private agentMemoryRepository: IAgentMemoryRepository,
  ) {}

  onModuleInit() {
    taskEventEmitter.on('task:pending', (task: ITaskQueue) => {
      this.handlePendingTask(task).catch((err) => {
        console.error('Error handling pending task:', err);
      });
    });
  }

  private async handlePendingTask(task: ITaskQueue): Promise<void> {
    const agent = await this.agentRepository.get(task.receiver_agent_id);
    if (!agent) {
      console.error(`Agent not found: ${task.receiver_agent_id}`);
      return;
    }

    // If agent is paused, skip
    if (agent.status === AgentStatus.PAUSED) {
      return;
    }

    // Set status to WORKING
    agent.status = AgentStatus.WORKING;
    await this.agentRepository.update(agent);

    try {
      // 1. Hydrate memory: read latest agent_memories
      const latestMemory = await this.agentMemoryRepository.findLatestByAgent(agent.id);
      const compactedSummary = latestMemory?.compacted_summary ?? 'No previous memory.';

      // 2. Collect deterministic context
      const oneShotPrompt = this.buildOneShotPrompt(compactedSummary, task.payload, agent);

      // 3. Switch Engram env vars
      const prevEngramDir = process.env.ENGRAM_DATA_DIR;
      const prevEngramPort = process.env.ENGRAM_PORT;
      process.env.ENGRAM_DATA_DIR = `${process.env.ENGRAM_BASE_DIR ?? './data/memories'}/${agent.id}`;
      process.env.ENGRAM_PORT = process.env.ENGRAM_PORT ?? '3001';
      process.env.ENGRAM_STARTUP_POLICY = 'passive';

      // 4. Initialize Pi SDK session in-memory
      const { session } = await createAgentSession({
        sessionManager: SessionManager.inMemory(),
        cwd: process.cwd(),
      });

      // 5. Subscribe to events for streaming
      const unsubscribe = session.subscribe((event: any) => {
        if (event.type === 'text_delta') {
          // Emit via WebSocket (placeholder - will be wired to gateway)
          agentEventEmitter.emit('agent:stream:text', { agentId: agent.id, delta: event.delta });
        }
        if (event.type === 'tool_call') {
          agentEventEmitter.emit('agent:stream:tool', { agentId: agent.id, toolName: event.toolName, args: event.args });
        }
      });

      // 6. Execute prompt
      await session.prompt(oneShotPrompt);

      // 7. On completion: read engram, persist memory, update session
      const sessionId = session.sessionId;
      // Read latest engram summary (placeholder - would read from engram DB)
      const newSummary = `Session ${sessionId} completed. Task: ${task.payload.substring(0, 100)}`;

      await this.agentMemoryRepository.add({
        id: 0,
        agent_id: agent.id,
        session_id: sessionId,
        compacted_summary: newSummary,
        created_at: new Date(),
      });

      // Update agent session id
      agent.current_session_id = sessionId;
      agent.status = AgentStatus.IDLE;
      await this.agentRepository.update(agent);

      // Mark task as completed
      task.status = 'COMPLETED' as any;
      await this.taskQueueRepository.update(task);

      // Cleanup
      unsubscribe();
      // Destroy session (in-memory, auto-cleaned)

      // Reset env vars
      if (prevEngramDir) process.env.ENGRAM_DATA_DIR = prevEngramDir;
      if (prevEngramPort) process.env.ENGRAM_PORT = prevEngramPort;

      // Parse SDK output for inter-agent message (placeholder)
      // If found, insert new PENDING task with parent_task_id = task.id
    } catch (error) {
      console.error(`Error running agent ${agent.id}:`, error);
      agent.status = AgentStatus.IDLE;
      await this.agentRepository.update(agent);
      task.status = 'HOLD' as any;
      await this.taskQueueRepository.update(task);
    }
  }

  private buildOneShotPrompt(compactedSummary: string, taskPayload: string, agent: IAgent): string {
    return `# PI-HIVE AGENT CONTEXT

## Agent Identity
- ID: ${agent.id}
- Name: ${agent.name}
- Role: ${agent.role}

## Compacted Memory (Engram)
${compactedSummary}

## Current Task
${taskPayload}

## Instructions
Execute the task described above. When finished, summarize your work concisely.`;
  }
}