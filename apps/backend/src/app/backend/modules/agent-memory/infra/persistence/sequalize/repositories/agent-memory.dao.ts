import { Injectable } from '@nestjs/common';

import { GenericSequalizeDAO } from '../../../../../../core/infra/database/sequalize/dao/impl/generic-sequalize.dao.js';
import { AgentMemoryEntity } from '../entities/agent-memory.schema.js';
import { IAgentMemory } from '../../../../domain/models/agent-memory.interface.js';

@Injectable()
export class AgentMemoryDAO extends GenericSequalizeDAO<AgentMemoryEntity> {
  constructor() {
    super(AgentMemoryEntity);
  }

  async create(memory: IAgentMemory): Promise<IAgentMemory> {
    const entity = await super.create(memory as any);
    return entity.toJSON() as IAgentMemory;
  }

  async read(id: number): Promise<IAgentMemory | null> {
    const entity = await super.read(id);
    return entity ? (entity.toJSON() as IAgentMemory) : null;
  }

  async readAll(): Promise<IAgentMemory[]> {
    const entities = await super.readAll();
    return entities.map((e) => e.toJSON() as IAgentMemory);
  }

  async update(memory: IAgentMemory): Promise<void> {
    await super.update(memory as any);
  }

  async readByCriteria<K>(filter: Partial<K>): Promise<IAgentMemory[]> {
    const entities = await super.readByCriteria(filter);
    return entities.map((e) => e.toJSON() as IAgentMemory);
  }
}