import { Module, forwardRef } from '@nestjs/common';

import { AgentApplicationModule } from '../../application/agent-application.module.js';
import { AgentController } from './controllers/agent.controller.js';
import { AgentRunnerModule } from '../../../agent-runner/agent-runner.module.js';
import { AgentPersistenceInfrastructureModule } from '../persistence/agent-persistence-infra.module.js';
import { WorkspaceEntity } from '../../../workspace/infra/persistence/sequalize/entities/workspace.schema.js';
import { WorkspaceDao } from '../../../workspace/infra/persistence/sequalize/daos/workspace.dao.js';
import { WorkspaceRepository } from '../../../workspace/infrastructure/workspace.repository.js';
import { IWorkspaceRepositoryToken } from '../../../workspace/domain/repositories/workspace-repository.interface.js';

@Module({
  imports: [AgentApplicationModule, AgentPersistenceInfrastructureModule, forwardRef(() => AgentRunnerModule)],
  controllers: [AgentController],
  providers: [
    { provide: 'WORKSPACE_MODEL', useValue: WorkspaceEntity },
    WorkspaceDao,
    { provide: IWorkspaceRepositoryToken, useClass: WorkspaceRepository },
  ],
})
export class AgentHttpInfrastructureModule {}
