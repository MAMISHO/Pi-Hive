import { IAgent } from '../models/agent.interface.js';

export const IAgentRepositoryToken = 'IAgentRepository';

export interface IAgentRepository {
  get(id: string): Promise<IAgent | null>;
  getAll(): Promise<IAgent[]>;
  add(agent: IAgent): Promise<IAgent>;
  update(agent: IAgent): Promise<void>;
  findByStatus(status: string): Promise<IAgent[]>;
}