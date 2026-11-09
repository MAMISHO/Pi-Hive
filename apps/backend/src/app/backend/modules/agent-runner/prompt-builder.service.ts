import { Injectable, Inject } from '@nestjs/common';
import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IWorkspace } from '../workspace/domain/models/workspace.interface.js';
import { DEFAULT_CHIEF_PROMPT_CONTENT, DEFAULT_SYSTEM_PROMPT_CONTENT, DEFAULT_SYSTEM_PROMPT_ID } from '../../core/infra/prompts/default-prompts.js';
import { WorkspaceSystemPromptEntity } from '../system-prompts/infra/persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { IWorkspaceRepository, IWorkspaceRepositoryToken } from '../workspace/domain/repositories/workspace-repository.interface.js';

@Injectable()
export class PromptBuilderService {
  constructor(
    @Inject(IWorkspaceRepositoryToken) private workspaceRepo: IWorkspaceRepository,
  ) {}

  async buildSystem(params: { agent: IAgent; team: IAgent[] }): Promise<string> {
    const { agent, team } = params;
    const workspace = agent.workspace_id ? await this.workspaceRepo.get(agent.workspace_id) : null;
    const systemPrompt = await this.resolveSystemPrompt(workspace);
    const identity = `TU IDENTIDAD (inmutable, eres ESTE agente — nunca te confundas con otros):\n  - Tú eres: ${agent.nickname} (id=${agent.id})\n  - Rol: ${agent.role}\n  - Workspace: ${agent.workspace_id ?? 'none'}\nIMPORTANTE: En la lista de equipo aparecen OTROS agentes (y podrías aparecer tú); actúa siempre como "${agent.nickname}". Para comunicarte con otro agente usa su alias/nickname exacto.`;
    const teamRoster = team.filter(a => a.id !== agent.id).map(a => `- alias/nickname: ${a.nickname} | rol: ${a.role} | id: ${a.id}`).join('\n') || '- (sin workers/equipo registrado)'
    const chief = agent.role === 'CHIEF'
      ? `
[CHIEF]\n${(workspace?.custom_chief_prompt?.trim() || DEFAULT_CHIEF_PROMPT_CONTENT).replace('{{TEAM_ROSTER}}', teamRoster)}`
      : '';
    const additional = agent.additional_instruction?.trim() ? `\n[INSTRUCCIÓN AGENTE]\n${agent.additional_instruction.trim()}` : '';
    return `[PI-HIVE SYSTEM]\n${identity}\n${systemPrompt || ''}${chief}${additional}\n[EQUIPO (inyectado dinámicamente; úsalo para delegar por alias/nickname o id)]\n${teamRoster}`;
  }

  async build(params: { agent: IAgent; taskPayload: string; team: IAgent[]; isResumed: boolean }): Promise<string> {
    const { agent, taskPayload, team, isResumed } = params;
    const workspace = agent.workspace_id ? await this.workspaceRepo.get(agent.workspace_id) : null;
    const systemPrompt = await this.resolveSystemPrompt(workspace);
    const identity = `TU IDENTIDAD (inmutable, eres ESTE agente — nunca te confundas con otros):\n  - Tú eres: ${agent.nickname} (id=${agent.id})\n  - Rol: ${agent.role}\n  - Workspace: ${agent.workspace_id ?? 'none'}\nIMPORTANTE: En la lista de equipo aparecen OTROS agentes (y podrías aparecer tú); actúa siempre como "${agent.nickname}". Para comunicarte con otro agente usa su alias/nickname exacto.`;
    const teamRoster = team.filter(a => a.id !== agent.id).map(a => `- alias/nickname: ${a.nickname} | rol: ${a.role} | id: ${a.id}`).join('\n') || '- (sin workers/equipo registrado)'
    const chief = agent.role === 'CHIEF'
      ? `\n[CHIEF]\n${(workspace?.custom_chief_prompt?.trim() || DEFAULT_CHIEF_PROMPT_CONTENT).replace('{{TEAM_ROSTER}}', teamRoster)}`
      : '';
    const additional = agent.additional_instruction?.trim() ? `\n[INSTRUCCIÓN AGENTE]\n${agent.additional_instruction.trim()}` : '';

    const teamShort = team.filter(a => a.id !== agent.id).map(a => `${a.nickname}[${a.role}]`).join(', ') || 'sin equipo';
    return `[PI-HIVE TAREA] Equipo: ${teamShort}\n---\n${taskPayload}`;
  }

  private async resolveSystemPrompt(workspace: IWorkspace | null): Promise<string> {
    try {
      if (workspace?.active_system_prompt_id) {
        const row = await WorkspaceSystemPromptEntity.findByPk(workspace.active_system_prompt_id);
        if (row?.content) return row.content;
      }
      const def = await WorkspaceSystemPromptEntity.findByPk(DEFAULT_SYSTEM_PROMPT_ID);
      if (def?.content) return def.content;
    } catch {}
    return DEFAULT_SYSTEM_PROMPT_CONTENT;
  }
}
