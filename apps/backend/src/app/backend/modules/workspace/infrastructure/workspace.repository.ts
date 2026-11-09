import { Injectable } from '@nestjs/common';
import { IWorkspaceRepository } from '../domain/repositories/workspace-repository.interface.js';
import { IWorkspace } from '../domain/models/workspace.interface.js';
import { WorkspaceDao } from '../infra/persistence/sequalize/daos/workspace.dao.js';

@Injectable()
export class WorkspaceRepository implements IWorkspaceRepository {
  constructor(private dao: WorkspaceDao) {}

  async add(workspace: IWorkspace): Promise<IWorkspace> {
    const e = await this.dao.create({ ...workspace, created_at: workspace.created_at ?? new Date() });
    return e.get({ plain: true }) as IWorkspace;
  }
  async update(workspace: IWorkspace): Promise<boolean> {
    const [n] = await this.dao.update(workspace.id, workspace);
    return n > 0;
  }
  async getAll(): Promise<IWorkspace[]> {
    return (await this.dao.findAll()).map(e => e.get({ plain: true }) as IWorkspace);
  }
  async get(id: string): Promise<IWorkspace | null> {
    const e = await this.dao.findById(id);
    return e ? (e.get({ plain: true }) as IWorkspace) : null;
  }
  async getActive(): Promise<IWorkspace | null> {
    const e = await this.dao.findActive();
    return e ? (e.get({ plain: true }) as IWorkspace) : null;
  }
  async setActive(id: string): Promise<void> {
    await this.dao.setAllInactive();
    await this.dao.setActive(id);
  }
}
