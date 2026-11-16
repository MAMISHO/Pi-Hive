[SKILL · Memoria inteligente del workspace (MCP)]
Activa en esta sesión: la memoria indexada del workspace está disponible y sus herramientas MCP están expuestas y operativas. Objetivo: obtener contexto con menos pasos y tokens usando las tools MCP de memoria como fuente principal de exploración/lectura, en lugar de recorrer archivos con tools separadas.

## Prioridad obligatoria en exploración
- Si la tarea es **explorar, entender, buscar, resumir o ubicar** información del workspace/proyecto (estructura, contenido, relaciones, trazabilidad de archivos/símbolos/requisitos): **tu primera llamada de herramienta debe ser {{QUERY_TOOL}}** (búsqueda de memoria), no `ls`, `find`, `grep`, `read` ni `bash`. La memoria indexada suele resolver gran parte sin recorrer ficheros uno a uno.
- **No inicies con filesystem** (`ls/find/bash/read`) salvo que la tarea sea puntualmente sobre un archivo/ruta/contenido concreto ya identificado por el usuario o por la propia memoria. La memoria es informativa y no reemplaza fuentes actuales ni estado persistido (pipeline, gates, aprobaciones).

## Cómo obtener estructura y resumen priorizado (sin leer ficheros)
- No hay herramienta de árbol exhaustivo del filesystem: aproxima la estructura desde la memoria.
- **Cobertura (opcional, una vez):** {{STATUS_HINT}}
- **Estructura + propósito:** usa {{QUERY_TOOL}} con una consulta amplia pero concreta (p. ej. “estructura del proyecto, módulos/directorios y archivos más importantes: propósito breve de cada uno, ordenados por importancia”). Refina por áreas/rutas solo si hace falta (1–2 consultas acotadas).
- **Relaciones de lo relevante:** usa {{FOCUSED_TOOLS}} solo para profundizar dependencias/trazabilidad de archivos o símbolos clave ya identificados.
- **Al responder:** presenta un árbol/visión lógica priorizada. Da detalle breve (ruta + propósito) a lo importante (entrypoints, config/build, módulos core, contratos); agrupa o describe de forma escueta lo secundario/soporte y omite ruido. Resume y detén la exploración cuando baste.
- **Mantenimiento (no recupera contexto):** {{MAP_HINT}} No ejecutes reindexado o drift salvo petición explícita.

## Invocación correcta (nombres MCP completos)
- Invoca las tools **directamente por su nombre MCP completo exacto** tal como figuran en “Herramientas de memoria expuestas…” abajo (p. ej. {{QUERY_TOOL}}). **No uses nombres cortos** (no llames `memory_query`/`memory_status` sin prefijo) y **nunca ejecutes nombres MCP mediante `bash`**.
- No repitas consultas equivalentes ni asumas que el índice contiene todo el repositorio.

## Leer/consultar ficheros del filesystem: solo cuando sea estrictamente necesario
- **Evita por defecto** leer o recorrer ficheros (`ls/find/grep/read/bash`) para explorar: prefiere lo que la memoria ya resuelve para cuidar tokens y ventana de contexto.
- **Lee/consulta ficheros solo si es estrictamente necesario**: (a) la memoria, tras 1–2 refinamientos acotados, no cubre un hueco concreto; (b) debes verificar un hecho actual, contrato o pasaje específico que la memoria no confirma; o (c) la memoria contradice una fuente actual. Indica la razón.
- **Fallback acotado**: recurre a la fuente autoritativa con **alcance mínimo**. Lee únicamente los ficheros/pasajes necesarios para cubrir ese hueco concreto.
- **Prohibido el barrido**: no hagas `ls/find` recursivos, listados amplios, `cat/head` en cadena ni volcados masivos con `bash`/`read` si la memoria ya cubrió parte del alcance o si el hueco es puntual.

## Reglas
- Consulta solo lo necesario; formula consultas breves y específicas.
- Prefiere responder con lo que la memoria ya resuelve y verifica en filesystem únicamente los detalles concretos no cubiertos.
{{WRITE_NOTE}}
- Herramientas de memoria expuestas en esta sesión (usa solo estas, por su nombre MCP completo): {{EXPOSED_TOOLS}}.
