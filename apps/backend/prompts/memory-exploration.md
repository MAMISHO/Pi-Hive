[SKILL · Memoria inteligente del workspace (MCP)]
Activa en esta sesión: la memoria indexada del workspace está disponible y sus herramientas MCP están expuestas y operativas. Objetivo: obtener contexto con menos pasos y tokens usando las tools MCP de memoria como fuente principal de exploración/lectura, en lugar de recorrer archivos con tools separadas.

## Prioridad obligatoria en exploración
- Si la tarea es **explorar, entender, buscar, resumir o ubicar** información del workspace/proyecto (estructura, contenido, relaciones, trazabilidad de archivos/símbolos/requisitos): **tu primera llamada de herramienta debe ser {{QUERY_TOOL}}** (búsqueda de memoria), no `ls`, `find`, `grep`, `read` ni `bash`. La memoria indexada suele resolver gran parte sin recorrer ficheros uno a uno.
- **No inicies con filesystem** (`ls/find/bash/read`) salvo que la tarea sea puntualmente sobre un archivo/ruta/contenido concreto ya identificado por el usuario o por la propia memoria. La memoria es informativa y no reemplaza fuentes actuales ni estado persistido (pipeline, gates, aprobaciones).

## Cómo obtener estructura y resumen priorizado (sin leer ficheros)
- No hay herramienta de árbol exhaustivo del filesystem: aproxima la estructura desde la memoria.
- **Cobertura (opcional, una vez):** {{STATUS_HINT}}
- **Localiza y comprende (antes de leer múltiples archivos):** usa {{QUERY_TOOL}} con una consulta amplia pero concreta (palabras clave, y si aplica IDs de requisitos/decisiones como RF, RNF, US, EPIC, ADR) para ubicar especificaciones, código relevante, convenciones y las áreas/directorios/módulos clave, con propósito breve de lo importante (entrypoints, config/build, módulos core, contratos) ordenado por importancia. Refina por áreas/rutas solo si hace falta (1–2 consultas acotadas).
- **Relaciones de lo relevante:** usa {{FOCUSED_TOOLS}} sobre los archivos o símbolos clave para conocer dependencias, trazabilidad, tests vinculados y requisitos/convenios relacionados, solo cuando haga falta.
- **Al responder:** presenta un árbol/visión lógica priorizada. Da detalle breve (ruta + propósito) a lo importante; agrupa o describe de forma escueta lo secundario/soporte y omite ruido. Una vez localizado lo necesario, trabaja con lo que la memoria resuelve y resume/detén la exploración cuando baste.
- **Mantenimiento (no recupera contexto):** {{MAP_HINT}} No ejecutes reindexado o drift salvo petición explícita.

## Invocación correcta (nombres MCP completos)
- Invoca las tools **directamente por su nombre MCP completo exacto** tal como figuran en “Herramientas de memoria expuestas…” abajo (p. ej. {{QUERY_TOOL}}). **No uses nombres cortos** (no llames `memory_query`/`memory_status` sin prefijo) y **nunca ejecutes nombres MCP mediante `bash`**.
- Usa únicamente las herramientas de memoria que figuren expuestas en esta sesión; si alguna no está disponible, no la fuerces y continúa con los medios disponibles respetando el alcance mínimo.
- No repitas consultas equivalentes ni asumas que el índice contiene todo el repositorio.

## Leer/consultar ficheros del filesystem: solo cuando sea estrictamente necesario
- **Evita por defecto** leer o recorrer ficheros (`ls/find/grep/read/bash`) para explorar: prefiere lo que la memoria ya resuelve para cuidar tokens y ventana de contexto.
- **Lee/consulta ficheros solo si es estrictamente necesario**: (a) la memoria, tras 1–2 refinamientos acotados, no cubre un hueco concreto; (b) debes verificar un hecho actual, contrato o pasaje específico que la memoria no confirma; o (c) la memoria contradice una fuente actual. Indica la razón.
- **Fallback acotado**: recurre a la fuente autoritativa con **alcance mínimo**. Lee únicamente los ficheros/pasajes necesarios para cubrir ese hueco concreto.
- **Prohibido el barrido**: no hagas `ls/find` recursivos, listados amplios, `cat/head` en cadena ni volcados masivos con `bash`/`read` si la memoria ya cubrió parte del alcance o si el hueco es puntual.

## Decisiones y sincronización (solo cuando aplique)
- **Registro de decisiones**: si adoptas un patrón arquitectónico, eliges una biblioteca, cambias un contrato o resuelves un bug no trivial y existe una herramienta de escritura/decisión expuesta, regístralo solo cuando se solicite explícitamente o la política existente lo permita (no como paso de lectura/exploración).
- **Sincronización/mantenimiento**: tras cambios relevantes en código o documentación, actualiza el índice solo si se solicita o corresponde explícitamente (herramienta de mantenimiento/reindexado expuesta, nunca para recuperar contexto). No lo uses como parte de la exploración.

## Reglas
- Consulta solo lo necesario; formula consultas breves y específicas.
- Prefiere responder con lo que la memoria ya resuelve y verifica en filesystem únicamente los detalles concretos no cubiertos.
{{WRITE_NOTE}}
- Herramientas de memoria expuestas en esta sesión (usa solo estas, por su nombre MCP completo): {{EXPOSED_TOOLS}}.
