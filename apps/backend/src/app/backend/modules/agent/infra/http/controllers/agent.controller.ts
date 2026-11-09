import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { IAgent } from '../../../domain/models/agent.interface.js';
import { AgentStatus } from '../../../domain/models/agent-status.enum.js';
import { IAgentRepository, IAgentRepositoryToken } from '../../../domain/repositories/agent-repository.interface.js';
import { agentEventEmitter } from '../../../../agent-runner/agent-runner.service.js';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

function normalizeModels(raw: any): Array<{ provider: string; models: string[] }> {
  const map = new Map<string, Set<string>>();
  const add = (provider: string | undefined, m: any) => {
    const id = m?.id || m?.model || m?.modelId;
    if (!id) return;
    let prov = provider;
    let mid = String(id);
    if (!prov && mid.includes('/')) { const i=mid.indexOf('/'); prov=mid.slice(0,i); mid=mid.slice(i+1); }
    prov = prov || 'unknown';
    if (!map.has(prov)) map.set(prov, new Set());
    map.get(prov)!.add(mid);
  };
  const walk = (x:any) => {
    if (Array.isArray(x)) { for (const item of x) walk(item); return; }
    if (x && typeof x === 'object') {
      if (Array.isArray(x.models)) { const prov=x.provider||x.id||x.name; for (const m of x.models) add(prov,m); return; }
      if (Array.isArray(x.providers)) { walk(x.providers); return; }
      if (x.id && (x.provider || !x.models)) { add(x.provider, x); return; }
      for (const k of Object.keys(x)) { if (Array.isArray((x as any)[k])) walk((x as any)[k]); }
    } else if (typeof x === 'string') add(undefined, x);
  };
  walk(raw);
  return Array.from(map.entries()).map(([provider, models]) => ({ provider, models: Array.from(models).sort() })).sort((a,b)=>a.provider.localeCompare(b.provider));
}
async function getPiModels(): Promise<Array<{provider:string;models:string[]}>> {
  try {
    const { ModelRuntime } = await import('@earendil-works/pi-coding-agent');
    const rt = await (ModelRuntime as any).create({ refreshOnCreate: false, allowModelNetwork: false });
    const avail = rt.getAvailableSnapshot?.() || [];
    const all = avail.length ? avail : (rt.getAllModels?.() || rt.getModels?.() || []);
    return normalizeModels(all);
  } catch (e) { console.warn('[agents/models] Pi SDK model discovery failed', e); }
  return [];
}

function randomColor(existing: Set<string>): string {
  const palette = ['#22c55e','#3b82f6','#a855f7','#f59e0b','#06b6d4','#ec4899','#84cc16','#f97316','#14b8a6','#eab308','#8b5cf6','#ef4444','#10b981','#6366f1','#f43f5e'];
  for (const c of palette) if (!existing.has(c)) return c;
  for (let i=0;i<50;i++) { const c = `#${Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')}`; if (!existing.has(c)) return c; }
  return '#3b82f6';
}

@Controller('agents')
export class AgentController {
  constructor(@Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository) {}

  @Get() async findAll(): Promise<IAgent[]> { return (await this.agentRepository.getAll()).filter((a: any) => !a.archived_at); }
  @Get('admin/all') async findAllAdmin(): Promise<IAgent[]> { return await this.agentRepository.getAll(); }
  @Get('models') async listModels(): Promise<Array<{provider:string;models:string[]}>> { return await getPiModels(); }

  @Post()
  async create(@Body() agentData: IAgent): Promise<IAgent> {
    const all = await this.agentRepository.getAll();
    const ws = agentData.workspace_id;
    if (!ws) throw new Error('workspace_id is required (no hive without workspace)');
    const inWs = all.filter((a: any) => a.workspace_id === ws && !a.archived_at);
    if (agentData.role === 'CHIEF' && inWs.some((a: any) => a.role === 'CHIEF')) throw new Error('Workspace already has a chief agent');
    const used = new Set(inWs.map((a:any)=>a.color).filter(Boolean));
    if (!agentData.color || used.has(agentData.color)) agentData.color = randomColor(used);
    else agentData.color = randomColor(new Set(inWs.map((a:any)=>a.color).filter(Boolean)));
    if (!agentData.nickname) agentData.nickname = agentData.name || agentData.id;
    agentData.status = agentData.status || AgentStatus.IDLE;
    return await this.agentRepository.add(agentData);
  }

  @Put(':id/stop') async stop(@Param('id') id: string) { agentEventEmitter.emit('agent:stop', { agentId: id, reason: 'user_stop', notifySender: false }); return { stopped: true }; }
  @Put(':id/session/clear') async clearSession(@Param('id') id: string) { agentEventEmitter.emit('agent:session:clear', id); return { ok: true }; }
  @Put(':id/session/compact') async compactSession(@Param('id') id: string) { agentEventEmitter.emit('agent:session:compact', id); return { ok: true }; }
  @Put(':id/session/resume') async resumeSession(@Param('id') id: string) { agentEventEmitter.emit('agent:session:resume', id); return { ok: true }; }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const agent = await this.agentRepository.get(id); if (!agent) return { ok: false };
    (agent as any).archived_at = new Date(); agent.status = AgentStatus.IDLE;
    agentEventEmitter.emit('agent:stop', id); await this.agentRepository.update(agent); return { ok: true };
  }

  @Get(':id') async findOne(@Param('id') id: string) { return await this.agentRepository.get(id); }

  @Put(':id')
  async update(@Param('id') id: string, @Body() agentData: IAgent): Promise<IAgent> {
    const all = await this.agentRepository.getAll();
    const existing = all.find((a:any)=>a.id===id);
    if (existing?.workspace_id) {
      const used = new Set(all.filter((a:any)=>a.workspace_id===existing.workspace_id && a.id!==id && !a.archived_at).map((a:any)=>a.color).filter(Boolean));
      if (!agentData.color || used.has(agentData.color)) agentData.color = randomColor(used);
    }
    await this.agentRepository.update({ ...agentData, id } as any);
    return await this.agentRepository.get(id);
  }
}
