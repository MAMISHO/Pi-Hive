import { Inject, Injectable } from '@nestjs/common';

import { IAgent } from '../../models/agent.interface.js';
import { IAgentDAO, IAgentDAOToken } from '../agent-dao.interface.js';
import { IAgentRepository, IAgentRepositoryToken } from '../agent-repository.interface.js';

@Injectable()
export class AgentRepositoryImpl implements IAgentRepository {
  constructor(@Inject(IAgentDAOToken) private agentDAO: IAgentDAO) {}

  async get(id: string): Promise<IAgent | null> {
    return this.agentDAO.read(id);
  }

  async getAll(): Promise<IAgent[]> {
    return this.agentDAO.readAll();
  }

  async add(agent: IAgent): Promise<IAgent> {
    return this.agentDAO.create(agent);
  }

  async update(agent: IAgent): Promise<void> {
    await this.agentDAO.update(agent);
  }

  async findByStatus(status: string): Promise<IAgent[]> {
    return this.agentDAO.readByCriteria({ status });
  }
}