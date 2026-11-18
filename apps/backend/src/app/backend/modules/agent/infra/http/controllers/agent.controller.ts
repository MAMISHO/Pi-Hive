import { Body, Controller, Delete, Get, Inject, Optional, Param, Post, Put, Query } from '@nestjs/common';
import { IAgent } from '../../../domain/models/agent.interface.js';
import { AgentStatus } from '../../../domain/models/agent-status.enum.js';
import { IAgentRepository, IAgentRepositoryToken } from '../../../domain/repositories/agent-repository.interface.js';
import { IWorkspaceRepository, IWorkspaceRepositoryToken } from '../../../../workspace/domain/repositories/workspace-repository.interface.js';
import { agentEventEmitter, AgentRunnerService } from '../../../../agent-runner/agent-runner.service.js';
import { AppSettingsService } from '../../../../app-settings/app-settings.service.js';
import { NexoPalaceMemoryService } from '../../../../memory-mcp/nexo-palace-memory.service.js';
import * as path from 'path';

function normalizeModels(raw: any): Array<{ provider: string; models: string[] }> {
  const map = new Map<string, Set<string>>();
  const add = (provider: string | undefined, m: any) => {
    const id = m?.id || m?.model || m?.modelId;
    if (!id) return;
    let prov = provider;
    let mid = String(id);
    if (!prov && mid.includes('/')) { const i = mid.indexOf('/'); prov = mid.slice(0, i); mid = mid.slice(i + 1); }
    prov = prov || 'unknown';
    if (!map.has(prov)) map.set(prov, new Set());
    map.get(prov)!.add(mid);
  };
  const walk = (x: any) => {
    if (Array.isArray(x)) { for (const item of x) walk(item); return; }
    if (x && typeof x === 'object') {
      if (Array.isArray(x.models)) { const prov = x.provider || x.id || x.name; for (const m of x.models) add(prov, m); return; }
      if (Array.isArray(x.providers)) { walk(x.providers); return; }
      if (x.id && (x.provider || !x.models)) { add(x.provider, x); return; }
      for (const k of Object.keys(x)) { if (Array.isArray((x as any)[k])) walk((x as any)[k]); }
    } else if (typeof x === 'string') add(undefined, x);
  };
  walk(raw);
  return Array.from(map.entries()).map(([provider, models]) => ({ provider, models: Array.from(models).sort() })).sort((a, b) => a.provider.localeCompare(b.provider));
}
async function getPiModels(agentDir?: string): Promise<Array<{ provider: string; models: string[] }>> {
  try {
    const pi = await import('@earendil-works/pi-coding-agent') as any;
    const cwd = process.cwd();
    const dir = agentDir ? path.resolve(agentDir) : path.resolve(cwd);

    // Prefer full service/runtime creation so packages/extensions (e.g. antigravity-acp) register providers/models
    if (typeof pi.createAgentSessionServices === 'function') {
      const SettingsManager = pi.SettingsManager;
      const settingsManager = SettingsManager?.create ? SettingsManager.create(cwd, dir) : undefined;
      const services = await pi.createAgentSessionServices({
        cwd,
        agentDir: dir,
        settingsManager,
      });
      const rt = services?.modelRuntime;
      const avail = rt?.getAvailableSnapshot?.() || [];
      const all = avail.length ? avail : (rt?.getAllModels?.() || rt?.getModels?.() || []);
      return normalizeModels(all);
    }

    const ModelRuntime = pi.ModelRuntime;
    if (ModelRuntime) {
      const opts: any = { refreshOnCreate: false, allowModelNetwork: false, agentDir: dir };
      const rt = await ModelRuntime.create(opts);
      const avail = rt.getAvailableSnapshot?.() || [];
      const all = avail.length ? avail : (rt.getAllModels?.() || rt.getModels?.() || []);
      return normalizeModels(all);
    }
  } catch (e) { console.warn('[agents/models] Pi SDK model discovery failed', e); }
  return [];
}


type ThinkingLevel = 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';
const ALL_LEVELS: ThinkingLevel[] = ['minimal','low','medium','high','xhigh','max'];

function computeAvailableThinkingLevels(model: any): ThinkingLevel[] {
  if (!model) return [];
  const reasoning = model.reasoning === true;
  const map = model.thinkingLevelMap;
  if (!reasoning && !map) return [];
  if (map && typeof map === 'object') {
    const out: ThinkingLevel[] = [];
    for (const lvl of ALL_LEVELS) {
      const v = (map as any)[lvl];
      if (v !== null && v !== undefined) out.push(lvl);
      // if key absent, treat as supported when reasoning is true? be conservative: include if reasoning true and not explicitly null
      else if (v === undefined && reasoning) out.push(lvl);
    }
    return Array.from(new Set(out));
  }
  // reasoning true but no explicit map -> assume common levels supported
  if (reasoning) return [...ALL_LEVELS];
  return [];
}
function pickDefaultEffort(available: ThinkingLevel[]): ThinkingLevel {
  if (available.includes('minimal')) return 'minimal';
  if (available.includes('low')) return 'low';
  return 'off';
}
function normalizeEffort(requested: any, available: ThinkingLevel[]): ThinkingLevel {
  if (!available || available.length === 0) return 'off';
  const r = String(requested || '') as ThinkingLevel;
  if ((ALL_LEVELS as string[]).includes(r) && available.includes(r)) return r;
  return pickDefaultEffort(available);
}

async function getPiModelCapabilities(agentDir: string | undefined, provider: string, modelId: string): Promise<{ available: ThinkingLevel[]; default: ThinkingLevel; reasoning: boolean }> {
  try {
    const pi = await import('@earendil-works/pi-coding-agent') as any;
    const cwd = process.cwd();
    const dir = agentDir ? path.resolve(agentDir) : path.resolve(cwd);
    let rt: any = null;
    if (typeof pi.createAgentSessionServices === 'function') {
      const SettingsManager = pi.SettingsManager;
      const settingsManager = SettingsManager?.create ? SettingsManager.create(cwd, dir) : undefined;
      const services = await pi.createAgentSessionServices({ cwd, agentDir: dir, settingsManager });
      rt = services?.modelRuntime;
    } else if (pi.ModelRuntime) {
      rt = await pi.ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false, agentDir: dir });
    }
    const model = rt?.getModel?.(provider, modelId) ?? rt?.getPhysicalModel?.(provider, modelId);
    const available = computeAvailableThinkingLevels(model);
    return { available, default: pickDefaultEffort(available), reasoning: !!model?.reasoning };
  } catch (e) {
    console.warn('[agents/models/thinking-levels] failed', e);
    return { available: [], default: 'off', reasoning: false };
  }
}

function randomColor(existing: Set<string>): string {
  const palette = ['#22c55e','#3b82f6','#a855f7','#f59e0b','#06b6d4','#ec4899','#84cc16','#f97316','#14b8a6','#eab308','#8b5cf6','#ef4444','#10b981','#6366f1','#f43f5e'];
  for (const c of palette) if (!existing.has(c)) return c;
  for (let i=0;i<50;i++) { const c = `#${Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0')}`; if (!existing.has(c)) return c; }
  return '#3b82f6';
}

@Controller('agents')
export class AgentController {
  constructor(
    @Inject(IAgentRepositoryToken) private agentRepository: IAgentRepository,
    @Inject(IWorkspaceRepositoryToken) private workspaceRepository: IWorkspaceRepository,
    private readonly appSettings: AppSettingsService,
    @Inject(AgentRunnerService) private readonly agentRunner: AgentRunnerService,
    @Optional() @Inject(NexoPalaceMemoryService) private readonly memory?: NexoPalaceMemoryService,
  ) {}

  private isMemoryFlagEnabled(value: any): boolean {
    return value === true || value === 1 || value === '1';
  }

  private async decorate(agent: IAgent | null): Promise<any> {
    if (!agent) return agent;
    if (!this.memory) return { ...agent, memoryPreference: this.isMemoryFlagEnabled((agent as any).memory_enabled), memoryEffective: false };
    return this.memory.decorateAgent(agent);
  }

  private async decorateList(list: IAgent[]): Promise<any[]> {
    return Promise.all((list || []).map((a) => this.decorate(a)));
  }

  @Get() async findAll(@Query('workspaceId') workspaceId?: string): Promise<any[]> {
    if (workspaceId) {
      const result = await this.agentRepository.getByWorkspace(workspaceId);
      const active = result.filter((a: any) => !a.archived_at).length;
      console.log(`[agents][GET] workspaceId=${workspaceId} returned=${result.length} active=${active} archived=${result.length - active}`);
      return this.decorateList(result);
    }
    const all = await this.agentRepository.getAll();
    const active = all.filter((a: any) => !a.archived_at).length;
    console.log(`[agents][GET] (ALL) total=${all.length} active=${active} archived=${all.length - active}`);
    return this.decorateList(all);
  }
  @Get('admin/all') async findAllAdmin(): Promise<any[]> { return this.decorateList(await this.agentRepository.getAll()); }
  @Get('models') async listModels(): Promise<Array<{provider:string;models:string[]}>> {
    let agentDir = '';
    try { agentDir = await this.appSettings.resolvePiAgentDir(); } catch {}
    return await getPiModels(agentDir);
  }

  @Get('models/thinking-levels')
  async getModelThinkingLevels(@Query('provider') provider: string, @Query('modelId') modelId: string): Promise<{ available: ThinkingLevel[]; default: ThinkingLevel; reasoning: boolean }> {
    if (!provider || !modelId) return { available: [], default: 'off', reasoning: false };
    let agentDir = '';
    try { agentDir = await this.appSettings.resolvePiAgentDir(); } catch {}
    return await getPiModelCapabilities(agentDir, provider, modelId);
  }

  @Put(':id/thinking-level')
  async setThinkingLevel(@Param('id') id: string, @Body() body: { thinkingLevel?: string }) {
    const agent = await this.agentRepository.get(id);
    if (!agent) return { ok: false, reason: 'not_found' };
    const rawModel = String((agent as any)?.task_state?.model || '').trim();
    const idx = rawModel.indexOf('/');
    const provider = idx >= 0 ? rawModel.slice(0, idx) : '';
    const modelId = idx >= 0 ? rawModel.slice(idx + 1) : rawModel;
    let agentDir = '';
    try { agentDir = await this.appSettings.resolvePiAgentDir(); } catch {}
    const caps = provider && modelId ? await getPiModelCapabilities(agentDir, provider, modelId) : { available: [] as ThinkingLevel[], default: 'off' as ThinkingLevel, reasoning: false };
    const level = normalizeEffort(body?.thinkingLevel, caps.available);
    (agent as any).thinkingLevel = level;
    // also mirror in task_state for convenience
    (agent as any).task_state = { ...((agent as any).task_state || {}), thinkingLevel: level };
    await this.agentRepository.update(agent as any);
    agentEventEmitter.emit('agent:thinking-level:changed', { agentId: id, thinkingLevel: level });
    return { ok: true, thinkingLevel: level, available: caps.available, default: caps.default };
  }

  @Post()
  async create(@Body() agentData: IAgent): Promise<any> {
    const all = await this.agentRepository.getAll();
    const ws = agentData.workspace_id;
    if (!ws) throw new Error('workspace_id is required (no hive without workspace)');
    const inWs = all.filter((a: any) => a.workspace_id === ws && !a.archived_at);
    if (agentData.role === 'CHIEF' && inWs.some((a: any) => a.role === 'CHIEF')) throw new Error('Workspace already has a chief agent');
    const used = new Set(inWs.map((a:any)=>a.color).filter(Boolean));
    if (!agentData.color || used.has(agentData.color)) agentData.color = randomColor(used);
    if (!agentData.nickname) agentData.nickname = agentData.name || agentData.id;
    agentData.status = agentData.status || AgentStatus.IDLE;
    if (!(agentData as any).thinkingLevel) (agentData as any).thinkingLevel = 'low';
    (agentData as any).task_state = { ...((agentData as any).task_state || {}), thinkingLevel: (agentData as any).thinkingLevel };
    if (!Object.prototype.hasOwnProperty.call(agentData as any, 'memory_enabled') || (agentData as any).memory_enabled == null) {
      const wsEntity = await this.workspaceRepository.get(ws);
      (agentData as any).memory_enabled = (wsEntity as any)?.memory_enabled === true;
    } else {
      (agentData as any).memory_enabled = (agentData as any).memory_enabled === true;
    }
    const created = await this.agentRepository.add(agentData);
    return this.decorate(created);
  }

  @Put(':id/stop') async stop(@Param('id') id: string) { try { const stopped = await this.agentRunner.stopAgent(id, { reason: 'user_stop', notifySender: false }); agentEventEmitter.emit('agent:stop', { agentId: id, reason: 'user_stop', notifySender: false }); return { stopped: !!stopped }; } catch (e) { console.error('[agents][STOP] failed', id, e); agentEventEmitter.emit('agent:stop', { agentId: id, reason: 'user_stop', notifySender: false }); return { stopped: false }; } }
  @Put(':id/session/clear') async clearSession(@Param('id') id: string) { agentEventEmitter.emit('agent:session:clear', id); return { ok: true }; }
  @Put(':id/session/compact') async compactSession(@Param('id') id: string) { agentEventEmitter.emit('agent:session:compact', id); return { ok: true }; }
  @Put(':id/session/resume') async resumeSession(@Param('id') id: string) { agentEventEmitter.emit('agent:session:resume', id); return { ok: true }; }

  @Put(':id/usage/reset')
  async resetUsage(@Param('id') id: string) {
    const agent = await this.agentRepository.get(id);
    if (!agent) return { ok: false, reason: 'not_found' };
    (agent as any).usage_reset_at = new Date();
    await this.agentRepository.update(agent as any);
    const saved = await this.agentRepository.get(id);
    agentEventEmitter.emit('agent:usage:reset', { agentId: id, workspaceId: (saved as any)?.workspace_id || (agent as any).workspace_id, usage_reset_at: (saved as any)?.usage_reset_at || (agent as any).usage_reset_at });
    return { ok: true, usage_reset_at: (saved as any)?.usage_reset_at ?? (agent as any).usage_reset_at };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const agent = await this.agentRepository.get(id);
    if (!agent) { console.warn(`[agents][DELETE] id=${id} not_found`); return { ok: false, reason: 'not_found' }; }
    if ((agent as any).archived_at) {
      console.warn(`[agents][DELETE] id=${id} already archived`);
      return { ok: true, archived_at: (agent as any).archived_at, already: true };
    }
    // cannot disable while active/working; activity must be stopped first
    if (agent.status === AgentStatus.WORKING) {
      console.warn(`[agents][DELETE] id=${id} blocked: agent is WORKING`);
      return { ok: false, reason: 'agent_working', message: 'Detén la actividad del agente antes de deshabilitarlo.' };
    }
    const beforeArchived = (agent as any).archived_at ?? null;
    (agent as any).archived_at = new Date();
    agent.status = AgentStatus.IDLE;
    console.log(`[agents][DELETE] id=${id} name=${(agent as any).nickname || (agent as any).name} beforeArchived=${beforeArchived} -> archived_at=${(agent as any).archived_at}`);
    await this.agentRepository.update(agent);
    const after = await this.agentRepository.get(id);
    console.log(`[agents][DELETE] id=${id} persisted archived_at=${(after as any)?.archived_at ?? null} status=${(after as any)?.status}`);
    // emit after persist so stop handlers can't race and clobber archived_at
    agentEventEmitter.emit('agent:stop', id);
    // refresh other agents' system prompts/roster so disabled agent disappears from [EQUIPO]
    this.agentRunner.refreshWorkspaceSystemPrompts((after as any)?.workspace_id || (agent as any).workspace_id).catch(() => {});
    return { ok: true, archived_at: (after as any)?.archived_at ?? (agent as any).archived_at };
  }

  @Delete(':id/permanent')
  async removePermanent(@Param('id') id: string) {
    const agent = await this.agentRepository.get(id);
    if (!agent) { console.warn(`[agents][DELETE permanent] id=${id} not_found`); return { ok: false, reason: 'not_found' }; }
    if (!(agent as any).archived_at) {
      console.warn(`[agents][DELETE permanent] id=${id} blocked: not archived`);
      return { ok: false, reason: 'not_archived', message: 'Solo se puede eliminar definitivamente un agente deshabilitado.' };
    }
    console.log(`[agents][DELETE permanent] id=${id} name=${(agent as any).nickname || (agent as any).name} archived_at=${(agent as any).archived_at}`);
    await this.agentRepository.hardDelete(id);
    const after = await this.agentRepository.get(id);
    console.log(`[agents][DELETE permanent] id=${id} deleted=${!after}`);
    this.agentRunner.refreshWorkspaceSystemPrompts((agent as any).workspace_id).catch(() => {});
    return { ok: true, deleted: !after };
  }

  @Put(':id/restore')
  async restore(@Param('id') id: string) {
    const agent = await this.agentRepository.get(id);
    if (!agent) { console.warn(`[agents][RESTORE] id=${id} not_found`); return { ok: false, reason: 'not_found' }; }
    const beforeArchived = (agent as any).archived_at ?? null;
    (agent as any).archived_at = null;
    agent.status = AgentStatus.IDLE;
    console.log(`[agents][RESTORE] id=${id} name=${(agent as any).nickname || (agent as any).name} beforeArchived=${beforeArchived} -> archived_at=null`);
    await this.agentRepository.update(agent);
    const after = await this.agentRepository.get(id);
    console.log(`[agents][RESTORE] id=${id} persisted archived_at=${(after as any)?.archived_at ?? null} status=${(after as any)?.status}`);
    this.agentRunner.refreshWorkspaceSystemPrompts((after as any)?.workspace_id || (agent as any).workspace_id).catch(() => {});
    return { ok: true, agent: await this.decorate(after) };
  }

  @Get(':id') async findOne(@Param('id') id: string) { return this.decorate(await this.agentRepository.get(id)); }

  @Put(':id')
  async update(@Param('id') id: string, @Body() agentData: IAgent): Promise<any> {
    const all = await this.agentRepository.getAll();
    const existing = all.find((a:any)=>a.id===id);
    console.log(`[agents][PUT] id=${id} exists=${!!existing} incomingName=${(agentData as any).nickname || (agentData as any).name} incomingArchived=${(agentData as any).archived_at ?? 'n/a'} existingArchived=${(existing as any)?.archived_at ?? null}`);
    if (existing?.workspace_id) {
      const used = new Set(all.filter((a:any)=>a.workspace_id===existing.workspace_id && a.id!==id && !a.archived_at).map((a:any)=>a.color).filter(Boolean));
      if (!agentData.color || used.has(agentData.color)) agentData.color = randomColor(used);
    }
    const incomingLevel = (agentData as any).thinkingLevel ?? (existing as any)?.thinkingLevel ?? 'low';
    (agentData as any).thinkingLevel = incomingLevel;
    (agentData as any).task_state = { ...((existing as any)?.task_state || {}), ...((agentData as any).task_state || {}), thinkingLevel: incomingLevel };
    // preserve archived_at unless explicitly provided
    if ((agentData as any).archived_at === undefined) (agentData as any).archived_at = (existing as any)?.archived_at ?? null;
    if (!Object.prototype.hasOwnProperty.call(agentData as any, 'memory_enabled')) {
      (agentData as any).memory_enabled = (existing as any)?.memory_enabled ?? null;
    } else {
      (agentData as any).memory_enabled = (agentData as any).memory_enabled == null ? null : (agentData as any).memory_enabled === true;
    }
    await this.agentRepository.update({ ...agentData, id } as any);
    const saved = await this.agentRepository.get(id);
    console.log(`[agents][PUT] id=${id} saved archived_at=${(saved as any)?.archived_at ?? null} name=${(saved as any)?.nickname}`);
    agentEventEmitter.emit('agent:thinking-level:changed', { agentId: id, thinkingLevel: incomingLevel });
    return this.decorate(saved);
  }
}
