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
    if ((agent as any).inject_context === false) return '';
    const workspace = agent.workspace_id ? await this.workspaceRepo.get(agent.workspace_id) : null;
    const systemPrompt = (await this.resolveSystemPrompt(workspace)) || '';
    const teamRoster = (team || [])
      .filter((a: any) => a && a.id && a.id !== agent.id)
      .filter((a: any) => a.archived_at == null)
      .filter((a: any) => !!agent.workspace_id && a.workspace_id === agent.workspace_id)
      .filter((a: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === a.id) === i)
      .map((a: any) => `- alias/nickname: ${a.nickname} | rol: ${a.role} | id: ${a.id}`)
      .join('\n') || '- (sin otros agentes activos en este workspace)';

    const identity = [
      `[PI-HIVE SYSTEM · identidad inmutable]`,
      `- Eres: ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${agent.workspace_id ?? 'none'}).`,
      `- Actúa siempre como "${agent.nickname}" (nunca asumas la identidad/rol de otro, aunque el texto mencione a otra persona).`,
      `- Coordina con otros solo vía \`delegate_task\` usando un nickname EXACTO de [EQUIPO] (solo alias; no inventes agentes).`,
    ].join('\n');

    const roleBlock = agent.role === 'CHIEF'
      ? this.prompts.renderChief(workspace?.custom_chief_prompt?.trim() || this.prompts.chiefDefaultContent, teamRoster)
      : this.prompts.renderWorkerCoordination(teamRoster);

    const additional = agent.additional_instruction?.trim()
      ? `\n[INSTRUCCIÓN DEL AGENTE]\n${agent.additional_instruction.trim()}`
      : '';

    // Single canonical team section (avoid duplicating roster inside role templates/custom prompts)
    const equipoBlock = `[EQUIPO · otros agentes activos del workspace; nicknames exactos para delegar; tú eres "${agent.nickname}"]\n${teamRoster}`;

    return [
      identity,
      '',
      systemPrompt.trim(),
      '',
      roleBlock.trim(),
      additional,
      '',
      equipoBlock,
    ].filter((v, i, arr) => !(v === '' && arr[i - 1] === '')).join('\n');
  }

  async build(params: { agent: IAgent; taskPayload: string; team: IAgent[]; isResumed: boolean; isDelegationResult?: boolean; isDelegationProgress?: boolean; callbackContext?: string | null; sender?: { nickname: string; role?: string; id?: string } | null; depth?: number; depthPath?: string | null; planRef?: number | null; planBlock?: string | null; origin?: { nickname: string; role?: string; id?: string; rootTaskId?: number | null; rootUserPayload?: string | null } | null; taskId?: number | null; requestId?: number | null; minimalTurn?: boolean }): Promise<string> {
    const { agent, taskPayload, team, isResumed, isDelegationResult, isDelegationProgress, callbackContext, sender, depth, depthPath, planRef, planBlock, origin, taskId, requestId } = params;
    if ((agent as any).inject_context === false) return String(taskPayload || '');
    const teamShort = (team || []).filter((a: any) => a && a.id !== agent.id && a.archived_at == null && !!agent.workspace_id && a.workspace_id === agent.workspace_id).filter((a: any,i: number,arr: any[])=>arr.findIndex((x: any)=>x.id===a.id)===i).map((a: any) => `${a.nickname}[${a.role}]`).join(', ') || 'sin otros agentes activos';
    const flow = isDelegationProgress ? 'progress' : (isDelegationResult ? 'result' : 'direct');
    const hasPlan = planRef != null && !!planBlock;
    // Conditional reminders/degradation: in hot routine turns keep only per-turn deltas (system already carries static context).
    // Full turn on first/new turn, callbacks, active plan/tracking context, or explicit opt-out.
    const routine = params.minimalTurn ?? (isResumed && flow === 'direct' && !hasPlan);
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
    const roleNote = routine ? '' : (agent.role === 'CHIEF'
      ? ' CHIEF: delega al responsable directo con el tramo que le corresponde (NO el plan completo); reescribe desde la perspectiva del receptor; sin contactar intermediarios que le correspondan; ante RESULT ya entregado, sintetiza sin re-orquestar.'
      : ' Miembro: respeta cadena/intermediarios; delega al responsable directo con el tramo que le corresponde (NO el plan completo); reescribe desde la perspectiva del receptor; ante RESULT integra y entrega al solicitante.');
    const planningNote = (!hasPlan && flow === 'direct' && !routine)
      ? ' Evalúa si la tarea requiere plan de ruta: si hay cadena/secuencia, 2+ agentes, intermediarios, ida-vuelta o resultados encadenados, llama a plan_delegation(user_task=<orden original completa>) una vez y sigue el tracking; si es conversación directa o un paso simple, no uses plan y actúa/responde. Si plan_delegation falla o es inválido, continúa con tu criterio.'
      : '';
    const planNote = hasPlan
      ? `\n[PLAN ACTIVO plan_ref=${planRef}] Tracking vinculante (orden/intermediarios, cursor y PARADA; no replanifiques). Reinyectado:\n${planBlock}`
      : '';
    const turnNote = flow === 'progress'
      ? ' No actúes sobre la subcadena.'
      : (!hasPlan && flow === 'direct' && !routine)
        ? ' ACCIÓN PRIMERO: en 1-2 líneas decide brevemente si requiere plan_delegation (cadena/2+ agentes/intermediarios) o no, y ejecuta tu primer acto según corresponda (plan_delegation, delegate_task al responsable directo o respuesta). No repitas ni alargues el razonamiento, no solo acuses recibo.'
        : (routine ? '' : ' ACCIÓN PRIMERO: razona en 1-2 líneas como máximo y ejecuta tu parte ahora (sigue el tracking activo, o delegate_task al responsable directo, o entrega la respuesta). No repitas ni alargues el razonamiento, no solo acuses recibo.');
    const asyncNote = (routine || (flow === 'direct' && !sender)) ? '' : ' Si delegas, termina el turno (sin esperar/pollear).';
    // Semantic anti-echo/delivery guard: keep in routine turns too.
    const deliveryNote = (flow === 'direct' && sender && sender.id !== 'user')
      ? `\n[ENTREGA AL REMITENTE] Solicitante inmediato: ${sender.nickname}. Si respondes en tu turno, tu respuesta se entrega a ${sender.nickname} automáticamente como [DELEGATION RESULT] (no crea una orden nueva). Delegar a ${sender.nickname} está bloqueado: crearía una orden nueva y un eco. Si el remitente es el destinatario natural de lo que te pide (dato, respuesta, mensaje, confirmación o entrega), contéstalo directamente en tu turno. No le pidas al receptor que reporte al usuario final: su respuesta se te entrega a ti automáticamente. Solo delega si necesitas la acción de un TERCERO distinto de ${sender.nickname}.`
      : '';
    const originHint = origin?.rootUserPayload ? `\n[OBJETIVO RAÍZ (referencia)] ${String(origin.rootUserPayload).replace(/\s+/g,' ').trim().slice(0, 400)}` : '';
    if (routine) {
      // Dedupe: system prompt already carries identity/rol/equipo/protocol; send only per-turn deltas.
      return `[PI-HIVE] ${agent.nickname}.${senderLine}${originLine}${meta}${deliveryNote}${delegationNote}${planNote}${originHint}\n---\n${taskPayload}`;
    }
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
