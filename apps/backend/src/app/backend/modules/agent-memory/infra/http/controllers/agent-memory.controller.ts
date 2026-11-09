import { Controller, Get, Param } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { IAgentMemory } from '../../../domain/models/agent-memory.interface.js';
import { IAgentMemoryRepository, IAgentMemoryRepositoryToken } from '../../../domain/repositories/agent-memory-repository.interface.js';

@Controller('memories')
export class AgentMemoryController {
  constructor(
    @Inject(IAgentMemoryRepositoryToken) private agentMemoryRepository: IAgentMemoryRepository,
  ) {}

  @Get('agent/:agentId')
  async getByAgent(@Param('agentId') agentId: string): Promise<IAgentMemory[]> {
    return this.agentMemoryRepository.findByAgent(agentId);
  }

  @Get('agent/:agentId/latest')
  async getLatestByAgent(@Param('agentId') agentId: string): Promise<IAgentMemory | null> {
    return this.agentMemoryRepository.findLatestByAgent(agentId);
  }
}