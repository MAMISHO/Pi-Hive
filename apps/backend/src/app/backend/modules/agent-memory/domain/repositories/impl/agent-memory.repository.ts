import { Inject, Injectable } from '@nestjs/common';

import { IAgentMemory } from '../../models/agent-memory.interface.js';
import { IAgentMemoryDAO, IAgentMemoryDAOToken } from '../agent-memory-dao.interface.js';
import { IAgentMemoryRepository, IAgentMemoryRepositoryToken } from '../agent-memory-repository.interface.js';

@Injectable()
export class AgentMemoryRepositoryImpl implements IAgentMemoryRepository {
  constructor(@Inject(IAgentMemoryDAOToken) private agentMemoryDAO: IAgentMemoryDAO) {}

  async get(id: number): Promise<IAgentMemory | null> {
    return this.agentMemoryDAO.read(id);
  }

  async getAll(): Promise<IAgentMemory[]> {
    return this.agentMemoryDAO.readAll();
  }

  async add(memory: IAgentMemory): Promise<IAgentMemory> {
    return this.agentMemoryDAO.create(memory);
  }

  async update(memory: IAgentMemory): Promise<void> {
    await this.agentMemoryDAO.update(memory);
  }

  async findLatestByAgent(agentId: string): Promise<IAgentMemory | null> {
    const memories = await this.agentMemoryDAO.readByCriteria({ agent_id: agentId });
    if (memories.length === 0) return null;
    return memories.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  }

  async findByAgent(agentId: string): Promise<IAgentMemory[]> {
    return this.agentMemoryDAO.readByCriteria({ agent_id: agentId });
  }
}