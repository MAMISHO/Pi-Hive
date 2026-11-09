import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { IAgent } from '../../../domain/models/agent.interface.js';
import { IAgentRepository, IAgentRepositoryToken } from '../../../domain/repositories/agent-repository.interface.js';

@Controller('agents')
export class AgentController {
  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
  ) {}

  @Get()
  async getAll(): Promise<IAgent[]> {
    return this.agentRepository.getAll();
  }

  @Get(':id')
  async getOne(@Param('id') id: string): Promise<IAgent | null> {
    return this.agentRepository.get(id);
  }

  @Post()
  async create(@Body() agent: IAgent): Promise<IAgent> {
    return this.agentRepository.add(agent);
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body('status') status: string): Promise<void> {
    const agent = await this.agentRepository.get(id);
    if (agent) {
      agent.status = status as any;
      await this.agentRepository.update(agent);
    }
  }
}