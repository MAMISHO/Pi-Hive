import { Injectable, Inject } from '@nestjs/common';
import { IAgent } from '../agent/domain/models/agent.interface.js';
import { IWorkspace } from '../workspace/domain/models/workspace.interface.js';
import { DEFAULT_SYSTEM_PROMPT_ID } from '../../core/infra/prompts/prompt.constants.js';
import { WorkspaceSystemPromptEntity } from '../system-prompts/infra/persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { IWorkspaceRepository, IWorkspaceRepositoryToken } from '../workspace/domain/repositories/workspace-repository.interface.js';
import { PromptCatalogService } from '../../core/infra/prompts/prompt-catalog.service.js';
import { stripDelegationEnvelope } from './delegation-runtime-policy.js';

@Injectable()
export class PromptBuilderService {
  constructor(
    @Inject(IWorkspaceRepositoryToken) private workspaceRepo: IWorkspaceRepository,
    private readonly prompts: PromptCatalogService,
  ) {}

  private resolveRoleBindings(workspace: IWorkspace | null, team: IAgent[], workspaceId?: string | null): string {
    const active = (team || []).filter((a: any) => a?.id && a.archived_at == null && !!workspaceId && a.workspace_id === workspaceId);
    const byId = new Map(active.map((a: any) => [String(a.id), a]));
    let config: Record<string, string> = {};
    try {
      const parsed = JSON.parse(String(workspace?.role_bindings || '{}'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed;
    } catch { /* invalid legacy/optional config falls back to the roster */ }
    const lines = Object.entries(config).flatMap(([roleKey, rawId]) => {
      const agent = byId.get(String(rawId));
      return agent ? [`- ${roleKey} → ${agent.nickname}`] : [];
    });
    return lines.join('\n') || '- (sin bindings válidos; usar roster y roles actuales)';
  }

  private sectionStats(sections: Record<string, string>): Record<string, { chars: number; estimatedTokens: number }> {
    return Object.fromEntries(Object.entries(sections).map(([key, value]) => [key, {
      chars: value.length, estimatedTokens: Math.ceil(value.length / 4),
    }]));
  }

  promptStats(sections: Record<string, string>) { return this.sectionStats(sections); }

  buildLengthRetryNudge(params: { agent: IAgent; taskPayload: string; isDelegationResult?: boolean; isRootUserCallback?: boolean; isRootFinalCallback?: boolean; callbackContext?: string | null }): string {
    if (params.isDelegationResult) {
      const activeInstruction = String(params.callbackContext || '').replace(/\s+/g, ' ').trim();
      const result = String(params.taskPayload || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      if (params.isRootFinalCallback) {
        const instruction = stripDelegationEnvelope(activeInstruction).slice(0, 400);
        return `[REINTENTO BREVE] La rama delegada cerró, no necesariamente la solicitud raíz. Encargo: ${instruction || '(consulta el encargo activo)'}. Audita el resultado recibido: ${result}. Si cumple el encargo, responde; si falta un requisito o hay un defecto concreto, continúa solo con ese paso y delega la corrección al responsable de la rama. No repitas pasos que el resultado acredita como completos.`;
      }
      return `[REINTENTO BREVE] Eres ${params.agent.nickname}. Instrucción activa: ${activeInstruction || '(no disponible)'}. Resultado recibido: ${result}. No reinterpretes el objetivo raíz. ${params.isRootUserCallback ? 'Completa el encargo raíz: si no quedan pasos, responde ahora al usuario; delega solo si la instrucción conserva un paso explícito pendiente.' : 'Ejecuta el siguiente paso concreto o responde al remitente si ya está completo.'} Sin planificar ni repetir el análisis.`;
    }
    return `[SYSTEM NUDGE · reintento automático]\nTu turno anterior se cortó por límite de longitud SIN completar ninguna acción ni respuesta. Responde AHORA de forma concisa y directa, en 1-2 líneas: ejecuta tu primer acto (plan_delegation si la tarea requiere cadena, o delegate_task al responsable directo, o entrega el resultado solicitado). NO repitas razonamiento ni expliques lo que vas a hacer, actúa.`;
  }

  async buildSystem(params: { agent: IAgent; team: IAgent[]; memoryEffective?: boolean; memoryToolNames?: string[] }): Promise<string> {
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
    const bindings = this.resolveRoleBindings(workspace, team, agent.workspace_id);
    const wsPath = (workspace as any)?.path ? String((workspace as any).path) : '';
    const identity = [
      `[PI-HIVE SYSTEM · identidad inmutable]`,
      `- Eres: ${agent.nickname} (id=${agent.id}, rol=${agent.role}, workspace=${agent.workspace_id ?? 'none'}).`,
      wsPath ? `- Directorio de trabajo del workspace (cwd): ${wsPath}. Opera SIEMPRE dentro de este path; no busques en el directorio de Pi-Hive ni en otras rutas ajenas al workspace.` : `- Directorio de trabajo del workspace: (no definido).`,
      `- Actúa siempre como "${agent.nickname}" (nunca asumas la identidad/rol de otro, aunque el texto mencione a otra persona).`,
      `- Coordina con otros solo vía \`delegate_task\` usando un nickname EXACTO de [EQUIPO] (solo alias; no inventes agentes).`,
    ].join('\n');

    const roleBlock = agent.role === 'CHIEF'
      ? this.prompts.renderChief(workspace?.custom_chief_prompt?.trim() || this.prompts.chiefDefaultContent, teamRoster)
      : this.prompts.renderWorkerCoordination(teamRoster);

    const wsPrompt = (workspace as any)?.workspace_prompt?.trim()
      ? `\n[INSTRUCCIONES DEL WORKSPACE]\n${String((workspace as any).workspace_prompt).trim()}`
      : '';

    const additional = agent.additional_instruction?.trim()
      ? `\n[INSTRUCCIÓN DEL AGENTE]\n${agent.additional_instruction.trim()}`
      : '';

    // Single canonical team section (avoid duplicating roster inside role templates/custom prompts)
    const equipoBlock = `[EQUIPO · otros agentes activos del workspace; nicknames exactos para delegar; tú eres "${agent.nickname}"]\n${teamRoster}`;
    const memoryToolNames: string[] = Array.isArray((params as any).memoryToolNames)
      ? Array.from(new Set((params as any).memoryToolNames.map((name: any) => String(name || '').trim()).filter(Boolean)))
      : [];
    const pickTool = (...patterns: RegExp[]): string => {
      for (const re of patterns) {
        const found = memoryToolNames.find((name) => re.test(name));
        if (found) return found;
      }
      return '';
    };
    const queryTool = pickTool(/(^|__)memory_query$/i);
    const statusTool = pickTool(/(^|__)memory_status$/i);
    const pathTool = pickTool(/(^|__)memory_path$/i);
    const traceTool = pickTool(/(^|__)memory_trace$/i);
    const memoryMapTool = pickTool(/(^|__)memory_map$/i);
    const driftTool = pickTool(/(^|__)memory_drift$/i);
    const queryName = queryTool || 'la herramienta de búsqueda de memoria expuesta (memory_query)';
    const focusedTools = [pathTool, traceTool].filter(Boolean).join(' / ') || 'las herramientas de trazabilidad expuestas (memory_path / memory_trace)';
    const statusHint = statusTool
      ? `usa \`${statusTool}\` solo para conocer estado/cobertura del índice; no sustituye una búsqueda de contenido.`
      : 'usa la herramienta de estado del índice expuesta solo para conocer cobertura; no sustituye una búsqueda de contenido.';
    const maintenanceTools = [memoryMapTool, driftTool].filter(Boolean);
    const mapHint = maintenanceTools.length
      ? `no uses ${maintenanceTools.map((t) => `\`${t}\``).join(' ni ')} para recuperar contexto: son de mantenimiento/reindexado de la memoria.`
      : 'no uses herramientas de mantenimiento/reindexado (p.ej. memory_map/memory_drift) para recuperar contexto.';
    const writeTools = memoryToolNames.filter((name: string) => /(^|__)memory_record_decision$|record_decision|memory_write|_write$|_update$|_save$|_create$|_delete$|_put$/i.test(name));
    const writeNote = writeTools.length
      ? `- ${writeTools.join(', ')} puede modificar memoria: úsala solo si la tarea lo solicita explícitamente y la política existente lo permite; no es herramienta habitual de lectura/exploración.`
      : '- No uses herramientas de escritura de memoria salvo petición explícita y política existente que lo permita.';
    const exposedTools = memoryToolNames.length
      ? memoryToolNames.join(', ')
      : '(aún no identificadas; usa únicamente las herramientas de memoria efectivamente expuestas por esta sesión)';
    let memoryBlock = '';
    if ((params as any).memoryEffective) {
      let skill = '';
      try { skill = String(this.prompts.memoryExplorationContent || '').trim(); } catch { skill = ''; }
      if (skill) {
        memoryBlock = `\n${skill
          .replace(/\{\{QUERY_TOOL\}\}/g, `\`${queryName}\``)
          .replace(/\{\{FOCUSED_TOOLS\}\}/g, focusedTools)
          .replace(/\{\{STATUS_HINT\}\}/g, statusHint)
          .replace(/\{\{MAP_HINT\}\}/g, mapHint)
          .replace(/\{\{WRITE_NOTE\}\}/g, writeNote)
          .replace(/\{\{EXPOSED_TOOLS\}\}/g, exposedTools)}`;
      }
    }

    return [
      identity,
      '',
      systemPrompt.trim(),
      wsPrompt,
      '',
      roleBlock.trim(),
      additional,
      memoryBlock,
      `\n[RESPONSABILIDADES DEL WORKSPACE]\n${bindings}`,
      '',
      equipoBlock,
    ].filter((v, i, arr) => !(v === '' && arr[i - 1] === '')).join('\n');
  }

  // User "continue/resume" after an abrupt stop: payload is a short continuation nudge, session already has context.
  isContinuationIntent(payload: string): boolean {
    const t = String(payload || '').trim().toLowerCase().replace(/[¡!¿?.…,;:]+$/g, '').trim();
    if (!t || t.length > 80) return false;
    if (/^(continua(r)?|continue|sigue|seguir|resume|reanuda(r)?|retoma(r)?|procede(r)?|prosigue|go on|keep going)(\b.*)?$/i.test(t)) {
      // allow short qualifiers like "continúa desde donde te quedaste" / "continue from where you left off"
      return /^(continua(r)?|continue|sigue|seguir|resume|reanuda(r)?|retoma(r)?|procede(r)?|prosigue|go on|keep going)(\s+(por favor|please|ya|ahora|desde.*|donde.*|from.*|where.*))?$/.test(t) || /continua|continue|sigue|resume|reanuda|retoma/.test(t);
    }
    return false;
  }

  async build(params: { agent: IAgent; taskPayload: string; team: IAgent[]; isResumed: boolean; isDelegationResult?: boolean; isDelegationProgress?: boolean; isRootUserCallback?: boolean; isRootFinalCallback?: boolean; callbackContext?: string | null; sender?: { nickname: string; role?: string; id?: string } | null; depth?: number; depthPath?: string | null; planRef?: number | null; planBlock?: string | null; origin?: { nickname: string; role?: string; id?: string; rootTaskId?: number | null; rootUserPayload?: string | null } | null; taskId?: number | null; requestId?: number | null; minimalTurn?: boolean; continueIntent?: boolean }): Promise<string> {
    const { agent, taskPayload, isResumed, isDelegationResult, isDelegationProgress, sender, depth, depthPath, planRef, planBlock, origin, taskId, requestId } = params;
    if ((agent as any).inject_context === false) return String(taskPayload || '');
    const flow = isDelegationProgress ? 'progress' : (isDelegationResult ? 'result' : 'direct');
    const hasPlan = planRef != null && !!planBlock;
    // Abrupt-stop resume with a plain "continue" nudge: no system/agent-order reinjection; send an ultra-minimal turn.
    const continueIntent = !!params.continueIntent && isResumed && flow === 'direct';
    // Conditional reminders/degradation: in hot routine turns keep only per-turn deltas (system already carries static context).
    // System context carries stable identity, role, roster and coordination rules; turns carry deltas only.
    const routine = continueIntent ? true : (params.minimalTurn ?? (isResumed && flow === 'direct' && !hasPlan));
    let delegationNote = '';
    if (flow === 'progress') {
      delegationNote = `\n[PROGRESS state=PROGRESS request en curso] Registra únicamente el avance recibido y espera RESULT final; no concluyas, no delegues ni toques la subcadena.${hasPlan ? ' Mantén el tracking (no avances de paso).' : ''}`;
    } else if (flow === 'result') {
      const activeInstruction = stripDelegationEnvelope(String(params.callbackContext || '')).replace(/\s+/g, ' ').trim().slice(0, 600);
      delegationNote = hasPlan
        ? `\n[RESULT state=FINAL request resuelta] Integra el dato en el paso actual del tracking, avanza y ejecuta el siguiente paso permitido. Si el tracking/estado indica PARADA o plan completado, sintetiza y entrega el resultado final al solicitante original; no delegues más ni explores. No trates branch/depth/request/origin/path como rutas de archivo.`
        : params.isRootUserCallback
          ? params.isRootFinalCallback
          ? `\n[RESULT FINAL DE RAMA, no de la solicitud raíz] Callback final significa que este agente terminó su rama. Encargo delegado: ${activeInstruction || '(no disponible)'}. Audita el resultado recibido contra este encargo y la evidencia citada. Si un plan sigue activo, ejecuta solo su siguiente nodo pendiente. Sin plan: si todos los requisitos están acreditados, responde; si hay un requisito concreto incumplido o un defecto verificable, delega únicamente esa reparación al responsable de esta rama (${params.sender?.nickname || 'remitente'}). No repitas acciones que el resultado acredita como completas. Metadatos como branch/depth/request/origin/path no son rutas.`
          : `\n[RESULT CALLBACK en raíz] Encargo activo: ${activeInstruction || '(no disponible)'}. Resultado recibido: aplícalo al encargo y verifica la evidencia si el encargo lo exige. Si queda trabajo, ejecuta o delega solo el siguiente paso permitido; si el encargo está completo, responde al usuario con el resultado. No reinterpretes el objetivo raíz ni explores fuera del alcance activo.`
          : `\n[RESULT FINAL DE RAMA] Este agente terminó su rama, no necesariamente el objetivo del remitente. Instrucción activa: ${activeInstruction || '(no disponible)'}. Compara el resultado con el encargo y el tracking. Con plan activo, sigue el próximo nodo pendiente. Sin plan, si el encargo está satisfecho devuelve el resultado; si queda un requisito explícito o defecto verificable, ejecuta/delega solo ese paso. No repitas acciones que el resultado acredita como completas ni reconstruyas el objetivo desde mensajes antiguos.`;
    }
    const senderLine = sender ? ` Remitente inmediato: ${sender.nickname}${sender.role ? ` (${sender.role}${sender.id ? `, id=${sender.id}` : ''})` : (sender.id ? ` (id=${sender.id})` : '')}.` : '';
    const originLine = origin ? ` Solicitante/origen de la cadena: ${origin.nickname}${origin.role ? ` (${origin.role})` : ''}${origin.rootTaskId ? `, request raíz=#${origin.rootTaskId}` : ''}.` : '';
    const ids = [taskId ? `task=#${taskId}` : null, requestId ? `request=#${requestId}` : null, origin?.rootTaskId ? `origin=#${origin.rootTaskId}` : null].filter(Boolean).join(' ');
    const meta = ` depth=${depth ?? 0}${depthPath ? ` branch=${depthPath}` : ''}${ids ? ` ${ids}` : ''}.`;
    const planningNote = (!hasPlan && flow === 'direct' && !routine)
      ? ' Evalúa si la tarea requiere plan de ruta: si hay cadena/secuencia, 2+ agentes, intermediarios, ida-vuelta o resultados encadenados, llama a plan_delegation(user_task=<orden original completa>) una vez y sigue el tracking; si es conversación directa o un paso simple, no uses plan y actúa/responde. Si plan_delegation falla o es inválido, continúa con tu criterio.'
      : '';
    const planNote = hasPlan
      ? `\n[PLAN ACTIVO plan_ref=${planRef}] Tracking vinculante (orden/intermediarios, cursor y PARADA; no replanifiques). Reinyectado:\n${planBlock}`
      : '';
    const callbackPlanningNote = flow === 'result' && !hasPlan
      ? ' Si queda trabajo pendiente que requiere una cadena, intermediarios o resultados encadenados, llama una vez a plan_delegation describiendo solo ese tramo pendiente y lo ya resuelto; si es un paso directo, actúa o delega sin plan.'
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
    const originHint = flow === 'direct' && origin?.rootUserPayload ? `\n[OBJETIVO RAÍZ (referencia)] ${String(origin.rootUserPayload).replace(/\s+/g,' ').trim().slice(0, 400)}` : '';
    if (continueIntent) {
      // Ultra-minimal continuation: session already has system/context; no extra agent orders.
      const planHint = hasPlan ? planNote : '';
      return `[PI-HIVE] ${agent.nickname}. Continúa.${planHint}\n---\n${taskPayload}`;
    }
    const callbackDelta = flow !== 'direct' ? `${delegationNote}${hasPlan ? planNote : callbackPlanningNote}` : '';
    const directDelta = flow === 'direct' ? `${deliveryNote}${!routine ? `${planningNote}${asyncNote}${turnNote}${hasPlan ? planNote : ''}` : ''}` : '';
    return `[PI-HIVE]${senderLine}${originLine}${meta}${callbackDelta}${directDelta}${originHint}\n---\n${taskPayload}`;
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
