import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { IWorkspace } from '../../../domain/models/workspace.interface.js';
import { IWorkspaceRepository, IWorkspaceRepositoryToken } from '../../../domain/repositories/workspace-repository.interface.js';
import { DEFAULT_SYSTEM_PROMPT_ID } from '../../../../../core/infra/prompts/default-prompts.js';
import { agentEventEmitter } from '../../../../agent-runner/agent-runner.service.js';
import { AgentEntity } from '../../../../agent/infra/persistence/sequalize/entities/agent.schema.js';
import { TaskQueueEntity } from '../../../../task-queue/infra/persistence/sequalize/entities/task-queue.schema.js';
import { AgentSessionHistoryEntity } from '../../../../session-history/infra/persistence/sequalize/entities/agent-session-history.schema.js';

@Controller('workspaces')
export class WorkspaceController {
  constructor(@Inject(IWorkspaceRepositoryToken) private workspaceRepository: IWorkspaceRepository) {}

  private async deactivateAll() {
    const all = await this.workspaceRepository.getAll();
    for (const w of all) if ((w as any).is_active) { (w as any).is_active = false; await this.workspaceRepository.update(w as any); }
  }

  @Get() async getAll(): Promise<IWorkspace[]> { return await this.workspaceRepository.getAll(); }
  @Get('active') async getActive(): Promise<IWorkspace | null> { return await this.workspaceRepository.getActive(); }

  @Get('browse/dirs')
  browseDirs(@Query('path') dirPath?: string): any {
    const base = dirPath && dirPath.trim() ? path.resolve(dirPath) : process.env.HOME || '/';
    try {
      const entries = fs.readdirSync(base, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => ({ name: e.name, path: path.join(base, e.name) })).sort((a,b)=>a.name.localeCompare(b.name));
      const parent = path.dirname(base);
      return { current: base, parent: parent !== base ? parent : null, dirs };
    } catch (e: any) { return { current: base, parent: null, dirs: [], error: e?.message || 'Cannot read directory' }; }
  }

  @Post()
  async create(@Body() body: { name: string; path: string; hitl_enabled?: boolean }): Promise<IWorkspace> {
    await this.deactivateAll();
    return await this.workspaceRepository.add({ name: body.name, path: body.path, is_active: true, hitl_enabled: body.hitl_enabled ?? false, active_system_prompt_id: DEFAULT_SYSTEM_PROMPT_ID } as any);
  }

  @Get(':id') async getById(@Param('id') id: string): Promise<IWorkspace> { return await this.workspaceRepository.get(id) as IWorkspace; }

  @Put(':id/activate')
  async activate(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.deactivateAll();
    const ws = await this.workspaceRepository.get(id);
    if (!ws) return { ok: false };
    (ws as any).is_active = true; await this.workspaceRepository.update(ws as any);
    return { ok: true };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: Partial<IWorkspace>): Promise<IWorkspace> {
    const ws = await this.workspaceRepository.get(id);
    if (!ws) throw new Error('Workspace not found');
    Object.assign(ws as any, body, { id });
    await this.workspaceRepository.update(ws as any);
    return await this.workspaceRepository.get(id) as IWorkspace;
  }

  @Post(':id/session/reset')
  async resetSession(@Param('id') id: string): Promise<{ ok: boolean; agents: number }> {
    const agents = await AgentEntity.findAll({ where: { workspace_id: id } as any });
    for (const a of agents) {
      agentEventEmitter.emit('agent:session:compact', a.get('id'));
      agentEventEmitter.emit('agent:session:clear', a.get('id'));
      await AgentSessionHistoryEntity.create({ workspace_id: id, agent_id: a.get('id'), session_id: a.get('current_session_id'), event_type: 'WORKSPACE_RESET', summary: 'Workspace session reset', details: null, created_at: new Date() } as any).catch(()=>{});
    }
    return { ok: true, agents: agents.length };
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: boolean }> {
    await TaskQueueEntity.destroy({ where: { workspace_id: id } as any }).catch(()=>{});
    await AgentEntity.destroy({ where: { workspace_id: id } as any }).catch(()=>{});
    await this.workspaceRepository.delete(id);
    return { ok: true };
  }
}
