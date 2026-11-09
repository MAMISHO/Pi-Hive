import { IAgentMemory } from '../models/agent-memory.interface.js';

export const IAgentMemoryRepositoryToken = 'IAgentMemoryRepository';

export interface IAgentMemoryRepository {
  get(id: number): Promise<IAgentMemory | null>;
  getAll(): Promise<IAgentMemory[]>;
  add(memory: IAgentMemory): Promise<IAgentMemory>;
  update(memory: IAgentMemory): Promise<void>;
  findLatestByAgent(agentId: string): Promise<IAgentMemory | null>;
  findByAgent(agentId: string): Promise<IAgentMemory[]>;
}