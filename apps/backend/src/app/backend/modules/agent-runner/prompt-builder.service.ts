import { Injectable, Inject } from '@nestjs/common';
import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IWorkspace } from '../workspace/domain/models/workspace.interface.js';
import { DEFAULT_SYSTEM_PROMPT_ID } from '../../core/infra/prompts/prompt.constants.js';
import { WorkspaceSystemPromptEntity } from '../system-prompts/infra/persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { IWorkspaceRepository, IWorkspaceRepositoryToken } from '../workspace/domain/repositories/workspace-repository.interface.js';
import { PromptCatalogService } from '../../core/infra/prompts/prompt-catalog.service.js';

@Injectable()
export class PromptBuilderService {
  constructor(
    @Inject(IWorkspaceRepositoryToken) private workspaceRepo: IWorkspaceRepository,
    private readonly prompts: PromptCatalogService,
  ) {}

  async buildSystem(params: { agent: IAgent; team: IAgent[] }): Promise<string> {
    const { agent, team } = params;
    const workspace = agent.workspace_id ? await this.workspaceRepo.get(agent.workspace_id) : null;
    const systemPrompt = await this.resolveSystemPrompt(workspace);
    const identity = `TU IDENTIDAD (inmutable, eres ESTE agente — nunca te confundas con otros):\n  - Tú eres: ${agent.nickname} (id=${agent.id})\n  - Rol: ${agent.role}\n  - Workspace: ${agent.workspace_id ?? 'none'}\nIMPORTANTE: La lista [EQUIPO] de abajo muestra a OTROS agentes (tu propio nombre normalmente NO aparece ahí, y eso es correcto). Actúa SIEMPRE como "${agent.nickname}". Si el remitente o el texto menciona a otra persona ("hola X", "dile a X"), TÚ sigues siendo "${agent.nickname}" (NO eres X): si debes obtener algo de X o que X haga algo, delega a X con delegate_task usando su nickname EXACTO.`;
    const teamRoster = team.filter(a => a.id !== agent.id).map(a => `- alias/nickname: ${a.nickname} | rol: ${a.role} | id: ${a.id}`).join('\n') || '- (sin otros agentes registrados)';
    const anti = `[PROTOCOLO OPERATIVO]\n- Identifícate y actúa solo como "${agent.nickname}". NUNCA asumas el rol de otro agente ni respondas como/por otro.\n- Comunícate con otros SOLO vía delegate_task(target_agent_nickname, instruction) usando nicknames EXACTOS (solo el alias, p.ej. "Bob"; NO uses "Bob (WORKER)"). Si un nombre NO está en [EQUIPO], repórtalo; no lo inventes.\n- No explores el filesystem (bash/ls/env) salvo que la tarea lo exija explícitamente. Si recibes un reporte/resultado ya resuelto de una delegación tuya, intégralo y responde al solicitante sin reiniciar el flujo.`;
    const chief = agent.role === 'CHIEF'
      ? `\n${this.prompts.renderChief(workspace?.custom_chief_prompt?.trim() || this.prompts.chiefDefaultContent, teamRoster)}\nComo CHIEF: delega al worker adecuado por nickname exacto y, en la instruction, transmite el PLAN COMPLETO (sub-objetivos + qué hacer con el resultado y a quién devolverlo). El CHIEF NO contacta directamente a agentes intermedios que correspondan al worker (p.ej. si el plan es "Bob pregunta a Pam y te reporta", el Chief delega SOLO a Bob con ese plan). Sintetiza y entrega la respuesta final al usuario.`
      : '';
    const additional = agent.additional_instruction?.trim() ? `\n[INSTRUCCIÓN AGENTE]\n${agent.additional_instruction.trim()}` : '';
    return `[PI-HIVE SYSTEM]\n${identity}\n${anti}\n\n${systemPrompt || ''}${chief}${additional}\n\n[EQUIPO (OTROS agentes · nicknames exactos para delegar; tú eres "${agent.nickname}")]\n${teamRoster}`;
  }

  async build(params: { agent: IAgent; taskPayload: string; team: IAgent[]; isResumed: boolean; isDelegationResult?: boolean; isDelegationProgress?: boolean; callbackContext?: string | null; sender?: { nickname: string; role?: string; id?: string } | null; depth?: number; depthPath?: string | null; planRef?: number | null; planBlock?: string | null; origin?: { nickname: string; role?: string; id?: string; rootTaskId?: number | null; rootUserPayload?: string | null } | null; taskId?: number | null; requestId?: number | null }): Promise<string> {
    const { agent, taskPayload, team, isDelegationResult, isDelegationProgress, callbackContext, sender, depth, depthPath, planRef, planBlock, origin, taskId, requestId } = params;
    const teamShort = team.filter(a => a.id !== agent.id).map(a => `${a.nickname}[${a.role}]`).join(', ') || 'sin equipo';
    const flow = isDelegationProgress ? 'progress' : (isDelegationResult ? 'result' : 'direct');
    const hasPlan = planRef != null && !!planBlock;
    let delegationNote = '';
    if (flow === 'progress') {
      delegationNote = `\n[PROGRESS state=PROGRESS request en curso]${callbackContext ? ` Plan/contexto: ${callbackContext}` : ''} Registra avance y espera RESULT final de esta request; no concluyas, no delegues ni toques la subcadena.${hasPlan ? ' Mantén el tracking (no avances de paso).' : ''}`;
    } else if (flow === 'result') {
      delegationNote = hasPlan
        ? `\n[RESULT state=FINAL request resuelta] Integra el dato en el paso actual del tracking, avanza y ejecuta el siguiente paso permitido. Si el tracking/estado indica PARADA o plan completado, sintetiza y entrega el resultado final al solicitante original; no delegues más ni explores. No trates branch/depth/request/origin/path como rutas de archivo.`
        : `\n[RESULT state=FINAL request resuelta]${callbackContext ? ` Contexto/plan previo: ${callbackContext}` : ''} Aplica el dato recibido, sintetiza y entrega el resultado final al solicitante de esta request; no explores filesystem/código/entorno ni trates branch/depth/request/origin/path como rutas. Si faltan pasos concretos pendientes, ejecuta/delega solo el siguiente (nickname exacto, instrucción completa) sin reiniciar ni rebotar lo ya entregado.`;
    }
    const senderLine = sender ? ` Remitente inmediato: ${sender.nickname}${sender.role ? ` (${sender.role}${sender.id ? `, id=${sender.id}` : ''})` : (sender.id ? ` (id=${sender.id})` : '')}.` : '';
    const originLine = origin ? ` Solicitante/origen de la cadena: ${origin.nickname}${origin.role ? ` (${origin.role})` : ''}${origin.rootTaskId ? `, request raíz=#${origin.rootTaskId}` : ''}.` : '';
    const ids = [taskId ? `task=#${taskId}` : null, requestId ? `request=#${requestId}` : null, origin?.rootTaskId ? `origin=#${origin.rootTaskId}` : null].filter(Boolean).join(' ');
    const meta = ` depth=${depth ?? 0}${depthPath ? ` branch=${depthPath}` : ''}${ids ? ` ${ids}` : ''}.`;
    const chiefNote = agent.role === 'CHIEF' ? ` CHIEF: coordina y delega al responsable (plan completo); ante resultado ya entregado, sintetiza sin re-orquestar.` : '';
    const planningNote = (!hasPlan && flow === 'direct' && sender?.id === 'user')
      ? ' Decide ANTES de delegar si necesitas plan de ruta: si la orden define cadena/secuencia, menciona 2+ agentes, requiere intermediarios que medien/reenvíen, ida-vuelta o resultados encadenados, llama a plan_delegation(user_task=<orden/objetivo original completo>) una vez al inicio y sigue el tracking; si es conversación directa o un único paso simple, no hace falta plan. Si plan_delegation falla o es inválido, continúa con tu criterio.'
      : '';
    const planNote = hasPlan
      ? `\n[PLAN ACTIVO plan_ref=${planRef}] Rama con tracking estructurado persistente. Síguelo de forma vinculante (respeta orden/intermediarios, cursor y PARADA). Reinyectado en cada llamada de esta rama:\n${planBlock}`
      : '';
    const turnNote = flow === 'progress' ? ' No actúes sobre la subcadena.' : ' Ejecuta ahora tu parte/acción inmediata; no solo acuses recibo.';
    const asyncNote = (flow === 'direct' && !sender) ? '' : ' Si delegas, no esperes/pollees: termina el turno.';
    const semantics = ' Coordinación en Pi-Hive: no hay chat directo agente↔agente; se coordina por delegate_task y devolviendo el resultado de tu tramo en la respuesta (el runtime lo enruta). Cumple el encargo concreto de este mensaje (p.ej. si te piden responder con una palabra/dato, responde ese dato); si debes involucrar a otro agente de la cadena, delega con instrucción completa (remitente, solicitante/origen y objetivo, acción concreta y respuesta esperada de ESTE agente, y a quién entregar).';
    const originHint = origin?.rootUserPayload ? `\n[OBJETIVO RAÍZ (referencia, solicitud original)] ${String(origin.rootUserPayload).replace(/\s+/g,' ').trim().slice(0, 400)}` : '';
    return `[PI-HIVE] Eres ${agent.nickname} (${agent.role}).${senderLine}${originLine}${meta}${chiefNote} Equipo: ${teamShort}. Nicknames exactos (solo alias). No explores salvo petición explícita. \`branch/depth/request/origin/path\` son metadatos de cadena, no rutas de filesystem.${semantics}${planningNote}${asyncNote}${turnNote}${delegationNote}${planNote}${originHint}\n---\n${taskPayload}`;
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
    return this.prompts.systemDefaultContent;
  }
}
