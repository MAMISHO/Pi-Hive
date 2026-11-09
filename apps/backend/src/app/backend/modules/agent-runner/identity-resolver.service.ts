import { Inject, Injectable } from '@nestjs/common';

import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IAgentRepository, IAgentRepositoryToken } from '../agent/domain/repositories/agent-repository.interface.js';

@Injectable()
export class IdentityResolverService {
  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
  ) {}

  async resolveNickname(nickname: string, workspaceId?: string): Promise<IAgent | null> {
    const agents = await this.agentRepository.getAll();
    return (
      agents.find((a) => {
        if (a.nickname !== nickname) return false;
        if (workspaceId !== undefined && a.workspace_id !== workspaceId) return false;
        return true;
      }) ?? null
    );
  }

  async getAvailableAgents(workspaceId?: string): Promise<IAgent[]> {
    const agents = await this.agentRepository.getAll();
    if (workspaceId === undefined) return agents;
    return agents.filter((a) => a.workspace_id === workspaceId || a.workspace_id === null);
  }
}
