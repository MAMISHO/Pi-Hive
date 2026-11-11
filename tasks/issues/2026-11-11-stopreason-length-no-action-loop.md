# Issue: turno agotado por longitud sin acción (`stopReason=length`, "bucle" de pensamiento)

- **Fecha:** 2026-11-11
- **Estado:** pendiente
- **Severidad/impacto:** alta (fidelidad de cadena) — la orden del usuario no se ejecuta ni se cierra.
- **Ámbito:** `agent-runner` (modelo principal / ejecución de turno). No es fallo de ruteo, anti-eco, idempotencia, lineage ni del planificador efímero en la corrida observada.

## Resumen

En una ejecución iniciada desde **Dev** (sesión limpia), el agente receptor consumió el turno en razonamiento (`thinking`) y alcanzó el límite de salida del modelo (**`stopReason=length`**) **sin emitir ninguna acción** (`plan_delegation` / `delegate_task`) ni texto de respuesta. La tarea quedó marcada `COMPLETED` con respuesta `(no text output, stopReason=length)` y **la cadena no se inició** (sin delegaciones, sin cierre al solicitante). Se percibe como “bucle”/estancamiento de pensamiento, aunque no es un loop de re-delegaciones.

## Evidencia (auditoría)

- **DB:** `data/pi-hive.db`, tasks **#1–#1**, chat events **#5–#8** (2026-11-11 02:12:54–02:13:53), iniciador **Dev (WORKER)**, sesión limpia (post-clear #1–#4).
- **Task 1:** `user → Dev`, `flow=direct`, `status=COMPLETED`, `plan_ref` vacío, `depth=0`.
  - Prompt: “Vamos a hacer una prueba de comunicación con Jim y pam, dile a Bob que le pregunte a pam que cuando es 2+2 y luego ese resultado que le diga pam a Bob, Bob le sume 100 y te diga la respuesta.”
  - **evt 7** `thinking`: Dev identifica la cadena (user→Bob→Pam…) y “necesito decirle a Bob…”.
  - **evt 8** `response`: `(no text output, stopReason=length)`.
  - **Sin tool calls** (`plan_delegation` / `delegate_task` ausentes), **sin delegaciones hijas**, **sin `kind=plan`**, `data/delegation-plans/` inexistente.
- **Trazas:** `agent_run_logs` sin `delegation_planned` para esta corrida (último previo: id 63425, task 1, `{"ok":false,"reason":"planner_empty_response",...}` de corrida anterior, no relacionada).
- **Conteos/rastro:** 1×`direct`, 0 callbacks, sin ecos/duplicados/ping-pong. Motor/ruteo/lineage estables.

## Análisis

- **Causa probable:** comportamiento no determinista del modelo principal — generación larga de razonamiento que agota el presupuesto de salida (`stopReason=length`) antes de producir una acción o respuesta.
- **No es:**
  - fallo del planificador efímero ni de Pi/SDK en esta corrida (no se invocó `plan_delegation`, no hubo sesión efímera/validación),
  - error de llamada a tools (no hubo llamadas) ni crash del runner (tarea finalizada y registrada),
  - problema de ruteo/anti-eco/idempotencia/guardas ni del system prompt de infraestructura (prompt unificado vigente; Dev con bloque “Coordinación y delegación (miembro del equipo)”, criterios de decisión/adquisición de plan presentes).
- **Naturaleza:** degradación por **agotamiento de longitud sin salida accionable** (cadena no iniciada, cierre vacío), distinta de (a) `planner_empty_response` del planificador efímero, (b) colapso de identidad/cadena por intuición del modelo, y (c) corridas exitosas con cadena mediada.
- **Instrumentación actual:** la mejora reciente (tabla `agent_run_logs` + `resultSummary` legible con `details/reason` en `tool_call` end) no se ejercita aquí al no haber intento de planning/tools; sí ayudará en corridas donde falle el planificador. Falta señal específica para este caso (`stopReason=length` sin acción).

## Propuestas de mitigación (a evaluar/implementar)

De menor a mayor intrusión (mantener `plan_ref` opcional y ruteo/anti-eco estables):

1. **Prompt (acción temprana / razonamiento acotado):**
   - Regla de acción primero en tareas directas con cadena: razonar breve y que el primer acto sea `plan_delegation` (si aplica) o `delegate_task` al responsable directo / entregar respuesta. No alargar el pensamiento.
   - Acotar thinking (“pocas líneas; priorizar emitir la tool call o el resultado”). Refuerzo en callbacks (“integrar → siguiente paso/cierre, 1 turno conciso”).
   - Mitiga pero no garantiza (depende del modelo).

2. **Runtime en `AgentRunnerService.executeTask` (recomendado, más efectivo):**
   - Detectar turno incompleto: `stopReason === 'length'` && `assistantText` vacío/sin salida útil && `!delegatedThisRun` (y sin tool calls con efecto).
   - No cerrar en falso como `COMPLETED` vacío: marcar estado recuperable (`HOLD`/`FAILED`, motivo `output_length_exhausted_no_action`) o reintentar.
   - **Reintento acotado (1 vez) con nudge**: re-prompt “tu turno se cortó por límite sin completar la acción; responde de forma concisa ejecutando `plan_delegation` o `delegate_task` al responsable directo / entrega el resultado, sin repetir razonamiento”. Cap a 1 reintento (evita bucle); seguro si no hubo efectos secundarios/delegación (idempotencia).
   - Trazabilidad: evento/traza explícito `output_length_no_action` (`stopReason`, `delegatedThisRun`, nº tool calls/texto) para distinguir de cierre legítimo.

3. **Modelo/configuración:**
   - Limitar verbosidad/presupuesto de “thinking” y reservar tokens para salida/acción si el modelo/runtime (`@earendil-works/pi-coding-agent` 1.5.0 / `ModelRuntime`, p.ej. `ollama/ornith-1.5:9b-16k-pi`) lo soporta.
   - Mantener prompts compactos (sin recortar reglas de fidelidad/decisión de plan).

4. **Opcional, sin forzar planificación:** nudge de arranque más imperativo en `prompt-builder` cuando la tarea directa encaje en criterios de cadena/intermediarios/2+ agentes y no haya `plan_ref` (“emite ahora `plan_delegation(...)` o `delegate_task`…”). No auto-disparar planificación server-side por defecto (riesgo de sobre-planificar; `plan_ref` opcional).

## Recomendación

1. Implementar guarda de runtime (2): detectar `stopReason=length` sin acción → 1 reintento con nudge (o HOLD marcado) + traza `output_length_no_action`.
2. Reforzar prompt (1): acción temprana / thinking breve.
3. Ajustar presupuesto de razonamiento del modelo si el runtime lo permite (3).

## Reproducción / siguiente paso

- Repetir en limpio la misma prueba desde Dev: “Vamos a hacer una prueba de comunicación con Jim y pam, dile a Bob que le pregunte a pam que cuando es 2+2 y luego ese resultado que le diga pam a Bob, Bob le sume 100 y te diga la respuesta.” Auditar si reaparece `stopReason=length` sin tool calls.
- Si se implementa (2), verificar que el reintento/nudge produce `plan_delegation` o `delegate_task` y que no se generan delegaciones duplicadas (idempotencia) ni bucles de reintento.
- Referencia de diagnóstico relacionado: fallos de `plan_delegation` ahora quedan en `agent_run_logs.delegation_planned` (`reason/ok/steps`) y en `tool_call` end legible.
