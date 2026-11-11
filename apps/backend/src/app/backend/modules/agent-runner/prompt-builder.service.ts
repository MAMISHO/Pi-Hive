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
    const anti = `[PROTOCOLO OPERATIVO]\n- Sé siempre "${agent.nickname}"; no asumas el rol/identidad de otro.\n- Coordina con otros SOLO vía delegate_task(nickname EXACTO, solo alias; no inventes nombres fuera de [EQUIPO]).\n- No explores filesystem/código salvo petición explícita. Si recibes un resultado ya resuelto de tu delegación, intégralo y responde al solicitante sin reiniciar el flujo.`;
    const chief = agent.role === 'CHIEF'
      ? `\n${this.prompts.renderChief(workspace?.custom_chief_prompt?.trim() || this.prompts.chiefDefaultContent, teamRoster)}`
      : `\n${this.prompts.renderWorkerCoordination(teamRoster)}`;
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
        : `\n[RESULT state=FINAL request resuelta]${callbackContext ? ` Contexto/plan previo: ${callbackContext}` : ''} Aplica el dato recibido, sintetiza y entrega el resultado final al solicitante de esta request; no explores filesystem/código/entorno ni trates branch/depth/request/origin/path como rutas. Si faltan pasos concretos pendientes, ejecuta/delega solo el siguiente (nickname exacto, instrucción del tramo del receptor) sin reiniciar ni rebotar lo ya entregado.`;
    }
    const senderLine = sender ? ` Remitente inmediato: ${sender.nickname}${sender.role ? ` (${sender.role}${sender.id ? `, id=${sender.id}` : ''})` : (sender.id ? ` (id=${sender.id})` : '')}.` : '';
    const originLine = origin ? ` Solicitante/origen de la cadena: ${origin.nickname}${origin.role ? ` (${origin.role})` : ''}${origin.rootTaskId ? `, request raíz=#${origin.rootTaskId}` : ''}.` : '';
    const ids = [taskId ? `task=#${taskId}` : null, requestId ? `request=#${requestId}` : null, origin?.rootTaskId ? `origin=#${origin.rootTaskId}` : null].filter(Boolean).join(' ');
    const meta = ` depth=${depth ?? 0}${depthPath ? ` branch=${depthPath}` : ''}${ids ? ` ${ids}` : ''}.`;
    const roleNote = agent.role === 'CHIEF'
      ? ' CHIEF: delega al responsable directo con el tramo que le corresponde (NO el plan completo); reescribe desde la perspectiva del receptor; sin contactar intermediarios que le correspondan; ante RESULT ya entregado, sintetiza sin re-orquestar.'
      : ' Miembro: respeta cadena/intermediarios; delega al responsable directo con el tramo que le corresponde (NO el plan completo); reescribe desde la perspectiva del receptor; ante RESULT integra y entrega al solicitante.';
    const planningNote = (!hasPlan && flow === 'direct')
      ? ' Evalúa si la tarea requiere plan de ruta: si hay cadena/secuencia, 2+ agentes, intermediarios, ida-vuelta o resultados encadenados, llama a plan_delegation(user_task=<orden original completa>) una vez y sigue el tracking; si es conversación directa o un paso simple, no uses plan y actúa/responde. Si plan_delegation falla o es inválido, continúa con tu criterio.'
      : '';
    const planNote = hasPlan
      ? `\n[PLAN ACTIVO plan_ref=${planRef}] Tracking vinculante (orden/intermediarios, cursor y PARADA; no replanifiques). Reinyectado:\n${planBlock}`
      : '';
    const turnNote = flow === 'progress'
      ? ' No actúes sobre la subcadena.'
      : (!hasPlan && flow === 'direct')
        ? ' ACCIÓN PRIMERO: en 1-2 líneas decide brevemente si requiere plan_delegation (cadena/2+ agentes/intermediarios) o no, y ejecuta tu primer acto según corresponda (plan_delegation, delegate_task al responsable directo o respuesta). No repitas ni alargues el razonamiento, no solo acuses recibo.'
        : ' ACCIÓN PRIMERO: razona en 1-2 líneas como máximo y ejecuta tu parte ahora (sigue el tracking activo, o delegate_task al responsable directo, o entrega la respuesta). No repitas ni alargues el razonamiento, no solo acuses recibo.';
    const asyncNote = (flow === 'direct' && !sender) ? '' : ' Si delegas, termina el turno (sin esperar/pollear).';
    const deliveryNote = (flow === 'direct' && sender && sender.id !== 'user')
      ? `\n[ENTREGA AL REMITENTE] Solicitante inmediato: ${sender.nickname}. Si respondes en tu turno, tu respuesta se entrega a ${sender.nickname} automáticamente como [DELEGATION RESULT] (no crea una orden nueva). Delegar a ${sender.nickname} está bloqueado: crearía una orden nueva y un eco. Si el remitente es el destinatario natural de lo que te pide (dato, respuesta, mensaje, confirmación o entrega), contéstalo directamente en tu turno. No le pidas al receptor que reporte al usuario final: su respuesta se te entrega a ti automáticamente. Solo delega si necesitas la acción de un TERCERO distinto de ${sender.nickname}.`
      : '';
    const originHint = origin?.rootUserPayload ? `\n[OBJETIVO RAÍZ (referencia)] ${String(origin.rootUserPayload).replace(/\s+/g,' ').trim().slice(0, 400)}` : '';
    return `[PI-HIVE] Eres ${agent.nickname} (${agent.role}).${senderLine}${originLine}${meta}${roleNote} Equipo: ${teamShort}. Nicknames exactos (solo alias). No explores salvo petición explícita. \`branch/depth/request/origin/path\` son metadatos, no rutas.${planningNote}${deliveryNote}${asyncNote}${turnNote}${delegationNote}${planNote}${originHint}\n---\n${taskPayload}`;
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
