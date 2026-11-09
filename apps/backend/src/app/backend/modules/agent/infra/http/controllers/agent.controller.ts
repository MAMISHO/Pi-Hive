import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { IAgent } from '../../../domain/models/agent.interface.js';
import { IAgentRepository, IAgentRepositoryToken } from '../../../domain/repositories/agent-repository.interface.js';
import { AgentEntity } from '../../persistence/sequalize/entities/agent.schema.js';
import { agentEventEmitter } from '../../../../agent-runner/agent-runner.service.js';

@Controller('agents')
export class AgentController {
  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
  ) {}

  @Get()
  async getAll(): Promise<IAgent[]> {
    return this.agentRepository.getAll();
  }

  @Get('models')
  async getModels(): Promise<{ provider: string; models: { id: string; name: string }[] }[]> {
    const modelsPath = path.join(os.homedir(), '.pi', 'agent', 'models.json');
    const raw = fs.readFileSync(modelsPath, 'utf-8');
    const parsed = JSON.parse(raw) as { providers?: Record<string, { models?: { id: string; name: string }[] }> };
    const providers = parsed.providers ?? {};
    return Object.entries(providers).map(([provider, value]) => ({
      provider,
      models: (value.models ?? []).map((m) => ({ id: m.id, name: m.name })),
    }));
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

  @Put(':id/stop')
  async stop(@Param('id') id: string): Promise<{ stopped: boolean }> {
    agentEventEmitter.emit('agent:stop', id);
    return { stopped: true };
  }

  @Delete(':id')
  async deactivate(@Param('id') id: string): Promise<void> {
    agentEventEmitter.emit('agent:stop', id);
    await AgentEntity.destroy({ where: { id } as any });
  }

  @Get('admin/list')
  async listAll(): Promise<IAgent[]> {
    return AgentEntity.findAll().then((rows) => rows.map((r) => r.toJSON() as IAgent));
  }
}
// --- session management (appended routes handled via separate endpoints below)
