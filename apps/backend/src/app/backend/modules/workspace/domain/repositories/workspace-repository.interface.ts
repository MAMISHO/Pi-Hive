import { IWorkspace } from '../models/workspace.interface.js';

export interface IWorkspaceRepository {
  add(workspace: IWorkspace): Promise<IWorkspace>;
  update(workspace: IWorkspace): Promise<boolean>;
  getAll(): Promise<IWorkspace[]>;
  get(id: string): Promise<IWorkspace | null>;
  getActive(): Promise<IWorkspace | null>;
  setActive(id: string): Promise<void>;
  delete(id: string): Promise<void>;
}
export const IWorkspaceRepositoryToken = 'IWorkspaceRepository';
