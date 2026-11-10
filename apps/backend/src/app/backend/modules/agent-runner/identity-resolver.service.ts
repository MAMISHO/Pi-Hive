import { Inject, Injectable } from '@nestjs/common';

import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IAgentRepository, IAgentRepositoryToken } from '../agent/domain/repositories/agent-repository.interface.js';

@Injectable()
export class IdentityResolverService {
  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
  ) {}

  async resolveNickname(nickname: string, workspaceId?: string): Promise<IAgent | null> {
    if (!nickname) return null;
    const raw = String(nickname).trim();
    if (!raw) return null;

    const normalize = (s: string) =>
      s
        .replace(/\s*\(.*?\)\s*/g, '')
        .replace(/\s*\[.*?\]\s*/g, '')
        .trim()
        .toLowerCase();

    const normalized = normalize(raw);
    const agents = await this.agentRepository.getAll();

    // Try exact match first
    let match = agents.find((a) => {
      if (a.nickname === raw) {
        if (workspaceId !== undefined && a.workspace_id !== workspaceId) return false;
        return true;
      }
      return false;
    });

    if (!match) {
      // Try normalized match
      match = agents.find((a) => {
        if (normalize(a.nickname) !== normalized) return false;
        if (workspaceId !== undefined && a.workspace_id !== workspaceId) return false;
        return true;
      });
    }

    return match ?? null;
  }

  async resolveById(id: string): Promise<IAgent | null> {
    if (!id) return null;
    const agents = await this.agentRepository.getAll();
    return agents.find((a) => a.id === id) ?? null;
  }

  async getAvailableAgents(workspaceId?: string): Promise<IAgent[]> {
    const agents = await this.agentRepository.getAll();
    if (workspaceId === undefined) return agents;
    return agents.filter((a) => a.workspace_id === workspaceId || a.workspace_id === null);
  }
}
