import { Inject, Injectable } from '@nestjs/common';
import { WorkspaceEntity } from '../entities/workspace.schema.js';
import { IWorkspace } from '../../../../domain/models/workspace.interface.js';

@Injectable()
export class WorkspaceDao {
  constructor(@Inject('WORKSPACE_MODEL') private model: typeof WorkspaceEntity) {}

  async create(workspace: IWorkspace): Promise<WorkspaceEntity> {
    return this.model.create(workspace as any);
  }
  async update(id: string, workspace: IWorkspace): Promise<[number]> {
    return this.model.update(workspace as any, { where: { id } });
  }
  async findAll(): Promise<WorkspaceEntity[]> {
    return this.model.findAll({ order: [['created_at', 'DESC']] });
  }
  async findById(id: string): Promise<WorkspaceEntity | null> {
    return this.model.findByPk(id);
  }
  async findActive(): Promise<WorkspaceEntity | null> {
    return this.model.findOne({ where: { is_active: true } });
  }
  async setAllInactive(): Promise<void> {
    await this.model.update({ is_active: false } as any, { where: { is_active: true } });
  }
  async setActive(id: string): Promise<void> {
    await this.model.update({ is_active: true } as any, { where: { id } });
  }
}
