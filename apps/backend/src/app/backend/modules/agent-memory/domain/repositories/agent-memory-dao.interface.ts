import { IAgentMemory } from '../models/agent-memory.interface.js';

export const IAgentMemoryDAOToken = 'IAgentMemoryDAO';

export interface IAgentMemoryDAO {
  create(memory: IAgentMemory): Promise<IAgentMemory>;
  read(id: number): Promise<IAgentMemory | null>;
  readAll(): Promise<IAgentMemory[]>;
  update(memory: IAgentMemory): Promise<void>;
  readByCriteria<K>(filter: Partial<K>): Promise<IAgentMemory[]>;
}