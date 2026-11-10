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
    const identity = `TU IDENTIDAD (inmutable, eres ESTE agente — nunca te confundas con otros):\n  - Tú eres: ${agent.nickname} (id=${agent.id})\n  - Rol: ${agent.role}\n  - Workspace: ${agent.workspace_id ?? 'none'}\nIMPORTANTE: La lista [EQUIPO] de abajo muestra a OTROS agentes (tu propio nombre normalmente NO aparece ahí, y eso es correcto). Actúa SIEMPRE como "${agent.nickname}". Si el remitente o el texto menciona a otra persona ("hola X", "dile a X"), TÚ sigues siendo "${agent.nickname}" (NO eres X): si debes obtener algo de X o que X haga algo, delega a X con delegate_task usando su nickname EXACTO.`;
    const teamRoster = team.filter(a => a.id !== agent.id).map(a => `- alias/nickname: ${a.nickname} | rol: ${a.role} | id: ${a.id}`).join('\n') || '- (sin otros agentes registrados)';
    const anti = `[PROTOCOLO OPERATIVO]\n- Identifícate y actúa solo como "${agent.nickname}". NUNCA asumas el rol de otro agente ni respondas como/por otro.\n- Comunícate con otros SOLO vía delegate_task(target_agent_nickname, instruction) usando nicknames EXACTOS (solo el alias, p.ej. "Bob"; NO uses "Bob (WORKER)"). Si un nombre NO está en [EQUIPO], repórtalo; no lo inventes.\n- ORQUESTACIÓN POR SUB-DELEGACIÓN: si la tarea requiere que OTRO agente aporte datos o una sub-tarea (p.ej. "pregúntale a Pam X, y con eso haz Y"), delega esa sub-tarea a ese agente, termina tu turno y NO esperes (NUNCA sleep/bash/polling). El resultado volverá como "[DELEGATION RESULT]".\n- AL RECIBIR "[DELEGATION RESULT]" (callback): es el resultado de TU delegación previa, NO una tarea nueva. Toma el dato, APLICA los pasos pendientes del plan/instrucción original (transforma/calcula/reporta lo que faltaba) y entrega el RESULTADO FINAL al solicitante; NO re-delegues por este resultado.\n- No explores el filesystem (bash/ls/env) salvo que la tarea lo exija explícitamente.`;
    const chief = agent.role === 'CHIEF'
      ? `\n[CHIEF]\n${(workspace?.custom_chief_prompt?.trim() || DEFAULT_CHIEF_PROMPT_CONTENT).replace('{{TEAM_ROSTER}}', teamRoster)}\nComo CHIEF: delega al worker adecuado por nickname exacto y, en la instruction, transmite el PLAN COMPLETO (sub-objetivos + qué debe hacer con el resultado y a quién devolverlo). El CHIEF NO contacta directamente a agentes intermedios que correspondan al worker (p.ej. si el plan es "Bob pregunta a Pam y te reporta", el Chief delega SOLO a Bob con ese plan). Sintetiza y entrega la respuesta final al usuario.`
      : '';
    const additional = agent.additional_instruction?.trim() ? `\n[INSTRUCCIÓN AGENTE]\n${agent.additional_instruction.trim()}` : '';
    return `[PI-HIVE SYSTEM]\n${identity}\n${anti}\n${systemPrompt || ''}${chief}${additional}\n[EQUIPO (OTROS agentes · nicknames exactos para delegar; tú eres "${agent.nickname}")]\n${teamRoster}`;
  }

  async build(params: { agent: IAgent; taskPayload: string; team: IAgent[]; isResumed: boolean; isDelegationResult?: boolean; callbackContext?: string | null; sender?: { nickname: string; role?: string; id?: string } | null; depth?: number; depthPath?: string | null }): Promise<string> {
    const { agent, taskPayload, team, isResumed, isDelegationResult, callbackContext, sender, depth, depthPath } = params;
    const teamShort = team.filter(a => a.id !== agent.id).map(a => `${a.nickname}[${a.role}]`).join(', ') || 'sin equipo';
    const teamRoster = team.filter(a => a.id !== agent.id).map(a => `${a.nickname} (${a.role})`).join(', ') || 'sin equipo';
    let delegationNote = '';
    if (isDelegationResult) {
      delegationNote = `\n[DELEGATION RESULT] Resultado devuelto de tu delegación. NO es tarea nueva ni re-delegues por ello.`;
      if (callbackContext) {
        delegationNote += `\n[CONTINUACIÓN — plan original pendiente]\nInstrucción/plan original que DEBES continuar ahora con este resultado: ${callbackContext}\nAplica el resultado recibido a ese plan y entrega la respuesta final (p.ej. si el plan pide transformar el dato, transfórmalo).`;
      } else {
        delegationNote += ` Integra/sintetiza y entrega la respuesta final.`;
      }
    }
    const senderLine = sender
      ? ` Remitente (quien te delega/solicita): ${sender.nickname}${sender.role ? ` (${sender.role})` : ''}.`
      : '';
    const meta = ` depth=${depth ?? 0}${depthPath ? ` path=${depthPath}` : ''}.`;
    const chiefNote = agent.role === 'CHIEF'
      ? ` Eres CHIEF: delega por nickname exacto (${teamRoster}) SOLO al worker responsable, transmitiendo el PLAN COMPLETO (sub-objetivos + qué hacer con el resultado); no contactes agentes intermedios ni actúes como worker.`
      : ` Si la tarea requiere datos/acción de otro agente del equipo, SUB-DELEGA a ese agente (delegate_task, nickname exacto sin rol), termina tu turno y al [DELEGATION RESULT] aplica los pasos restantes del plan y responde al remitente. No respondas como/por el otro agente.`;
    const asyncNote = ` NUNCA esperes con sleep/bash/polling. Si delegas, completa el turno y continúa cuando llegue el [DELEGATION RESULT].`;
    return `[PI-HIVE TAREA] TÚ ERES ${agent.nickname} (${agent.role}).${senderLine}${meta}${chiefNote} Equipo (otros): ${teamShort}. Usa nicknames exactos (solo alias, ej. "Bob", no "Bob (WORKER)"); si no existe, repórtalo. No explores el filesystem salvo que la tarea lo pida.${asyncNote}${delegationNote}\n---\n${taskPayload}`;
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
