import { Injectable } from '@nestjs/common';

import { GenericSequalizeDAO } from '../../../../../../core/infra/database/sequalize/dao/impl/generic-sequalize.dao.js';
import { AgentEntity } from '../entities/agent.schema.js';
import { IAgent } from '../../../../domain/models/agent.interface.js';
import { IAgentDAO, IAgentDAOToken } from '../../../../domain/repositories/agent-dao.interface.js';

@Injectable()
export class AgentDAO extends GenericSequalizeDAO<AgentEntity> implements IAgentDAO {
  constructor() {
    super(AgentEntity);
  }

  async create(agent: IAgent): Promise<IAgent> {
    const entity = await super.create(agent as any);
    return entity.toJSON() as IAgent;
  }

  async read(id: string): Promise<IAgent | null> {
    const entity = await super.read(id);
    return entity ? (entity.toJSON() as IAgent) : null;
  }

  async readAll(): Promise<IAgent[]> {
    const entities = await super.readAll();
    return entities.map((e) => e.toJSON() as IAgent);
  }

  async update(agent: IAgent): Promise<void> {
    await super.update(agent as any);
  }

  async readByCriteria<K>(filter: Partial<K>): Promise<IAgent[]> {
    const entities = await super.readByCriteria(filter);
    return entities.map((e) => e.toJSON() as IAgent);
  }
}