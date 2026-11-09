import { IAgent } from '../models/agent.interface.js';

export const IAgentDAOToken = 'IAgentDAO';

export interface IAgentDAO {
  create(agent: IAgent): Promise<IAgent>;
  read(id: string): Promise<IAgent | null>;
  readAll(): Promise<IAgent[]>;
  update(agent: IAgent): Promise<void>;
  readByCriteria<K>(filter: Partial<K>): Promise<IAgent[]>;
}