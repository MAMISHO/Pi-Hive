import { Module } from '@nestjs/common';
import { WorkspaceEntity } from './infra/persistence/sequalize/entities/workspace.schema.js';
import { WorkspaceDao } from './infra/persistence/sequalize/daos/workspace.dao.js';
import { WorkspaceRepository } from './infrastructure/workspace.repository.js';
import { IWorkspaceRepositoryToken } from './domain/repositories/workspace-repository.interface.js';
import { WorkspaceController } from './infra/http/controllers/workspace.controller.js';

@Module({
  controllers: [WorkspaceController],
  providers: [
    { provide: 'WORKSPACE_MODEL', useValue: WorkspaceEntity },
    WorkspaceDao,
    { provide: IWorkspaceRepositoryToken, useClass: WorkspaceRepository },
  ],
  exports: [IWorkspaceRepositoryToken],
})
export class WorkspaceModule {}
