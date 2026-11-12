import { Injectable } from '@nestjs/common';

import { GenericSequalizeDAO } from '../../../../../../core/infra/database/sequalize/dao/impl/generic-sequalize.dao.js';
import { AgentEntity } from '../entities/agent.schema.js';
import { AgentMapper } from '../mappers/agent.mapper.js';
import { IAgent } from '../../../../domain/models/agent.interface.js';
import { IAgentDAO } from '../../../../domain/repositories/agent-dao.interface.js';

@Injectable()
export class AgentDAO extends GenericSequalizeDAO<AgentEntity> implements IAgentDAO {
  constructor() {
    super(AgentEntity);
  }

  async create(agent: IAgent): Promise<IAgent> {
    const entity = await super.create(AgentMapper.toPersistence(agent) as any);
    return AgentMapper.toDomain(entity as any);
  }

  async read(id: string): Promise<IAgent | null> {
    const entity = await super.read(id);
    return entity ? AgentMapper.toDomain(entity as any) : null;
  }

  async readAll(): Promise<IAgent[]> {
    const entities = await super.readAll();
    return entities.map((e) => AgentMapper.toDomain(e as any));
  }

  async update(agent: IAgent): Promise<void> {
    const persistence = AgentMapper.toPersistence(agent) as any;
    const instance = await (this as any).model.findByPk(agent.id);
    if (!instance) {
      console.warn(`[agent-dao][update] id=${agent.id} not found in DB`);
      return;
    }
    const before = { archived_at: (instance as any).archived_at ?? null, status: (instance as any).status };
    await instance.update(persistence);
    // reload to confirm persisted state
    await instance.reload();
    const after = { archived_at: (instance as any).archived_at ?? null, status: (instance as any).status };
    console.log(`[agent-dao][update] id=${agent.id} before=${JSON.stringify(before)} after=${JSON.stringify(after)} set.archived_at=${persistence.archived_at ?? null}`);
  }

  async readByCriteria<K>(filter: Partial<K>): Promise<IAgent[]> {
    const entities = await super.readByCriteria(filter);
    return entities.map((e) => AgentMapper.toDomain(e as any));
  }

  async getByWorkspace(workspaceId: string): Promise<IAgent[]> {
    return this.readByCriteria({ workspace_id: workspaceId } as any);
  }


  async hardDelete(id: string): Promise<void> {
    await (this as any).model.destroy({ where: { id } });
    console.log(`[agent-dao][hardDelete] id=${id} deleted`);
  }
}
