# Plan 02: Optimización memoria-first y uso eficiente de tools

## Objetivo

Reducir llamadas innecesarias a filesystem y el contexto/latencia de tareas de exploración usando Nexo-Palace cuando aporte información, sin convertir la memoria en requisito, fuente autoritativa ni pipeline paralelo. Mantener Pi como responsable de configurar el MCP y Pi-Hive como anfitrión de sesiones que puede exponer sus tools conforme a las preferencias existentes.

La mejora debe ser genérica: no acoplarla a Chief, Jim, Pam, Bob, un nickname, un modelo, una campaña ni una frase de prompt. No modificar el harness, templates, stages ni artefactos del workspace activo.

## Base de auditoría y grado de certeza

La auditoría entregada corresponde al run `dc0388fc-ce10-494c-90d0-04676d5fff12`, workspace `5479dcc2…`, agente Chief, fecha `2026-11-16T15:20:23Z`. Debe conservarse como línea base de referencia, no como benchmark universal.

### Hechos reportados por la auditoría

- `memory_state` informó `effective:true` y las siete tools de Nexo-Palace estaban en `activeTools/allTools`.
- Se reportaron llamadas correctas a `memory_status` y `memory_query`; también un intento de invocar `memory_status` desde `bash` que falló.
- El run se reportó como completado en 178.9 s, 5 turnos, 28 llamadas de tools y 52,771 tokens totales (input 35,650, output 867, cacheRead 16,254).
- El sistema inspeccionó filesystem antes de consultar memoria y continuó haciendo lecturas amplias después de obtener resultados de memoria.
- El prompt del backend que se encontró durante la revisión solo aconseja query/trace de forma opcional; no describe una estrategia de selección entre `memory_map`, `memory_query`, `memory_path`, `memory_trace` ni lecturas locales.

### Interpretaciones que deben verificarse

- La secuencia observada es compatible con una política de exploración poco clara, pero un run no demuestra que el prompt sea la única causa. También pueden influir el modelo, la semántica/esquema de las tools, calidad/actualidad del índice, límites de contexto, herramientas activas, instrucciones del workspace y el objetivo concreto.
- La disponibilidad de siete tools no demuestra que todas sean pertinentes ni que deban anunciarse siempre al modelo. Validar schemas, coste y semántica de cada tool en la versión conectada de Nexo-Palace.
- “52,771 tokens” no debe equipararse automáticamente con tokens evitables. Separar usage del proveedor (incluyendo cache según la definición del proveedor), estimaciones de prompt, llamadas de herramientas y texto de resultados. Confirmar cómo se contabilizan múltiples turnos y reintentos.
- `toolCallsTotal:28` requiere reconciliarse con eventos `tool_call`/`tool_result` del run. Se reportaron nombres vacíos en algunos eventos; revisar si son duplicaciones de diferentes eventos SDK para una misma ejecución o llamadas sin nombre. No sumar `toolcall_start`, `tool_execution_start` y `tool_call` como ejecuciones distintas sin correlación por `toolCallId`.
- `memory_map` y `memory_path` pueden reducir exploración si sus resultados cubren la pregunta; esto es hipótesis de trabajo, no beneficio medido aún.

## Reglas que no cambian

1. Las tools y gates de migración pertenecen al harness. Memoria sirve para recuperar información contextual, no para marcar steps, aprobar gates ni sustituir estado persistido.
2. La memoria es opcional y solo se usa si la sesión expone tools efectivas. Si no hay disponibilidad, continuar con el flujo normal de Pi.
3. No declarar consultada una tool ni un dato como confirmado sin evento/resultado correspondiente.
4. La memoria puede estar incompleta o desactualizada. Para código/archivos/estado actual, validar solo la afirmación relevante en el archivo o mecanismo autoritativo. No hacer lecturas indiscriminadas “por si acaso”.
5. No forzar memoria para conversación simple, ejecución ya especificada, operaciones locales obvias o tareas donde el estado autoritativo está en otro sistema.
6. No ejecutar nombres MCP mediante `bash`; llamar directamente a la tool MCP expuesta por la sesión.
7. No añadir al prompt global listas de agentes/nicknames ni nombres de roles de un workspace. Estas recomendaciones deben ser independientes del equipo.

## Fase 0: preservar estado y reproducir la línea base

1. Revisar `git status --short` y diffs antes de editar. Preservar cambios de otros trabajos; no resetear ni limpiar archivos.
2. Usar el run citado como evidencia histórica, sin modificar su workspace ni reescribir el artefacto de auditoría.
3. Exportar/consultar eventos del run citado desde el trace persistido, incluyendo IDs, timestamps, tool names, task/turn y resultados resumidos. No copiar cuerpos sensibles al documento.
4. Reconciliar las métricas: `run_usage`, `turn_input`, `tool_call`, `tool_result`, eventos SDK y `toolCallsTotal`. Determinar si `cacheRead` está incluido en `totalTokens` y si los 5 turnos son turnos del runner o llamadas al modelo.
5. Registrar versión de Pi SDK, proveedor/modelo y nivel de razonamiento si consta, estado MCP, disponibilidad de herramientas e instrucciones/prompt efectivo. No inferir valores ausentes.
6. Para una comparación nueva, definir una tarea equivalente y repetible en workspace no activo o fixture. No ejecutar una prueba que cambie archivos/índice/memoria del workspace activo sin un encargo explícito.

Entregable: ficha de línea base con fuente de cada cifra, incertidumbres y lista de tools/eventos deduplicada.

## Fase 1: inspeccionar semántica y mecanismos existentes

Leer solo fuentes necesarias dentro de Pi-Hive y documentación MCP aplicable:

- `apps/backend/src/app/backend/modules/agent-runner/prompt-builder.service.ts` y sus pruebas;
- composición del prompt efectivo y orden de contexto;
- integración MCP y filtro de exposición en `nexo-palace-memory.service.ts`;
- lifecycle/activación de tools, callbacks y `session_tools_activated` en `agent-runner.service.ts`;
- `RunTraceService`, schema/API de trazas y métricas `run_usage`;
- docs locales de Nexo-Palace y descripción/schema real de las tools anunciadas.

Crear una matriz `tool | propósito demostrado | entradas | salida/tamaño | costo/latencia conocido | operación de lectura/escritura | cuándo conviene`. Verificar si las siete tools reportadas están disponibles en runtime, qué campos requieren y si `memory_status` es diagnóstico, consulta de estado o ambas cosas. No inventar campos de request.

Determinar qué significa “memoria indexada” con indicadores existentes. Si no hay una señal confiable de frescura/cobertura, tratar esa condición como desconocida y dejar que un resultado vacío/insuficiente habilite fallback puntual; no añadir un gate paralelo en Pi-Hive.

## Fase 2: diseñar guidance compacto y condicional

Modificar solo el bloque opcional de memoria en el prompt efectivo, manteniendo intactas instrucciones generales, identidad, delegación, seguridad y stops. No duplicar guidance en prompts globales/workspace/agente.

La instrucción debe ser breve, orientada a acciones y no prescriptiva en casos donde memoria no aporte. Definir una estrategia general como:

1. Si la tarea necesita contexto del proyecto y la memoria está disponible, iniciar con una consulta amplia pero concreta mediante `memory_query`. `memory_status` solo informa del estado/cobertura del índice, no del contenido del proyecto.
2. Usar `memory_path`/`memory_trace` cuando haga falta ubicar un nodo/archivo o entender una relación concreta.
3. Detener consultas cuando la respuesta ya cubra el objetivo. Consultar detalles locales solo para verificar un hecho actual, contrato o pasaje específico no resuelto por memoria.
4. Usar `read` para archivos puntuales; evitar `find`, `ls` recursivo o dumps con `bash` si una consulta de memoria ya cubre el alcance. `bash` no es interfaz MCP.
5. Si la memoria no devuelve resultado útil, parece desactualizada o contradice una fuente actual, decirlo/registrarlo y recurrir a la fuente autoritativa con el mínimo alcance.
6. No consultar memoria en cada callback, ni para reemplazar el estado de pipeline/harness.

**Corrección de semántica:** el README público actual de Nexo-Palace describe `memory_map` como reindexado de cambios, no como mapa de overview. No recomendarlo para recuperar contexto. `memory_drift` analiza cambios y `memory_record_decision` persiste una decisión; se reservan para solicitudes explícitas y política autorizada. Si la versión conectada del MCP difiere del README, validar su schema/descripción real antes de ajustar esta guía.

Detalles de implementación:

- Referirse a nombres reales de tools configurados/expuestos en la sesión, no hardcodear `nexo-palace` ni `mcp__nexo_palace__` como regla global. El runtime puede aportar una lista filtrada de herramientas, o usar nombres neutrales (`memory_map`, `memory_query`, etc.) solo si son estables en el contrato.
- No enumerar `memory_record_decision` como herramienta habitual de lectura. Es potencialmente escritora: usarla solo si la tarea lo solicita explícitamente y su política existente permite la escritura.
- No indicar “memoria primero” como absoluto. La heurística se activa cuando la tarea requiere conocimiento del workspace que memoria puede contener; tareas puntuales o de fuente autoritativa pueden empezar por su herramienta nativa.
- Evitar instrucciones que ordenen llamar un número fijo de tools; el criterio es suficiencia y evidencia, no cumplir una cuota.

## Fase 3: instrumentar uso y medir sin duplicar eventos

Ampliar observabilidad solo si los eventos actuales no permiten obtener métricas confiables. Preferir derivar agregados de eventos existentes y `run_usage` frente a introducir otro sistema de telemetría.

Por run/turno registrar o derivar:

- tokens de proveedor separados por input/output/cache, con origen y semántica documentada;
- estimación de tokens del system prompt y del input de tarea por separado, aclarando que es estimación;
- ejecuciones de tools deduplicadas por ID de llamada, clasificadas como memoria, filesystem, shell, delegación/planificación y otras;
- primera tool de exploración y si fue memoria, filesystem/shell o ninguna;
- errores, latencia, longitud de salida y carácter truncado de resultados MCP;
- indicadores compactos de estado de memoria: efectiva, tool list observada y resultado de la llamada (sin persistir consultas completas ni resultados sensibles).

Reglas de instrumentación:

- Establecer una única fuente/camino canónico para contar una ejecución. Eventos de lifecycle (`toolcall_start`, `tool_execution_start`, `tool_call`) no deben incrementar tres veces el mismo contador.
- Manejar tool name vacío como dato inválido/desconocido y exponerlo en diagnóstico; no clasificarlo silenciosamente como filesystem ni memoria.
- No registrar prompt completo, pensamiento, secretos, argumentos completos ni resultados MCP completos para medir tokens. Longitudes, hashes no reversibles cuando proceda, nombre de tool y metadatos suficientes.
- No incluir nuevas trazas ruidosas por cada delta de streaming.

## Fase 4: prueba controlada de calidad y eficiencia

Comparar con la línea base sobre la misma tarea de exploración en fixtures/workspaces seguros y condiciones tan equivalentes como sea posible. Si proveedor o contexto cambian, declararlo y no atribuir causalidad exclusiva al prompt.

Casos mínimos:

1. Pregunta de orientación general sobre un proyecto indexado.
2. Pregunta concreta que necesita verificar un archivo actual.
3. Memoria no disponible.
4. Memoria disponible pero vacía, desactualizada o insuficiente.
5. Tarea que no requiere explorar el proyecto (control negativo; no debería forzar uso de MCP).

Para cada caso comparar: éxito/calidad revisada, tokens proveedor y estimados separados, llamadas únicas por categoría, primera tool, latencia total/por tool, errores, número/tamaño de lecturas y cobertura de evidencia. Hacer varias repeticiones si la variabilidad del modelo es alta; reportar mediana y rango, no solo el mejor run.

No fijar un objetivo de reducción en tokens hasta tener línea base reconciliada. El criterio es lograr reducción repetible de lecturas/calls/coste sin degradar calidad, exactitud, uso de fuente vigente ni comportamiento cuando memoria falta. Un prompt más directivo no es éxito si causa consultas MCP superfluas.

## Fase 5: cambios y pruebas automatizadas

Implementar el cambio mínimo confirmado por las fases anteriores, probablemente en el bloque de memoria del PromptBuilder y, solo si hace falta, en agregación de trazas. No tocar tools/gates del harness.

Pruebas backend sugeridas:

1. Sin `memoryEffective`, el prompt no contiene guía ni nombres de tools MCP.
2. Con memoria efectiva, el bloque de guidance se inyecta exactamente una vez y no altera identidad, reglas del workspace, delegación ni stops.
3. La guía prioriza orientación cuando procede, limita lecturas locales a huecos y no obliga a usar memoria en tarea directa/no exploratoria.
4. Los nombres se derivan de la lista de tools runtime o contrato validado; un alias MCP renombrado no rompe instrucciones acopladas a un servidor concreto.
5. Tool calls se deduplican por ID y los eventos duplicados SDK no inflan el contador; eventos sin nombre quedan como desconocidos.
6. Clasificación separa memoria, filesystem/shell y delegación sin contar herramientas normales como MCP.
7. No se guardan cuerpos completos/secretos en métricas nuevas.
8. Outage o resultado vacío permite fallback, sin alterar preferencias ni estado del harness.

Añadir pruebas frontend solo si se cambia una vista. Este plan no requiere cambios UI por defecto.

## Fase 6: ejecución y comunicación

- Ejecutar pruebas y builds pertinentes de Pi-Hive según su configuración Nx.
- No iniciar ni dejar backend/frontend en segundo plano; no reiniciar servicios existentes.
- No modificar el harness ni el workspace activo para realizar pruebas.
- No declarar que memoria ahorró tokens basándose solo en disponibilidad o tools activadas.
- Entregar resumen con causa respaldada, diferencias entre hecho e hipótesis, archivos cambiados, resultados por caso, medición antes/después y limitaciones reales.

## Criterios de aceptación

- El bloque de memoria efectivo enseña al modelo a escoger la tool según la pregunta, usar MCP directamente y consultar filesystem bajo demanda, sin imponer memoria a toda tarea.
- La guía no sustituye el estado persistido, tools, gates ni stops humanos del harness.
- No hay acoplamiento a nicknames, IDs, un modelo, un prompt de prueba ni nombre específico del servidor.
- Un resultado insuficiente/desactualizado permite fallback a fuente local autoritativa, con lecturas puntuales.
- La instrumentación cuenta invocaciones únicas, distingue categorías y no cuenta eventos duplicados como tools adicionales.
- Las cifras de tokens distinguen datos del proveedor de estimaciones y separan cache según definición verificada.
- La evaluación cubre memoria útil, insuficiente/no disponible y control sin necesidad de memoria.
- No se afirma ahorro ni mejora de calidad hasta observar resultados comparables y reproducibles.
- Tests/builds pertinentes pasan; no quedan servicios arrancados por la validación.

## Pendientes que requieren decisión humana solo si aparecen

- Aprobación para cambiar el contrato de Nexo-Palace o activar tools con efectos de escritura si hoy no existe política.
- Permiso para ensayar sobre workspace/índice/memoria activos si no existe fixture seguro.
- Selección de objetivo cuantitativo de ahorro después de obtener línea base fiable, si se necesita un SLA de tokens.
