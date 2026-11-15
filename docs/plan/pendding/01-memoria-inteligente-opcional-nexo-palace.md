# Plan 01: Memoria inteligente opcional con Nexo-Palace

## Objetivo

Integrar Nexo-Palace como memoria consultable bajo demanda para los agentes de Pi-Hive. La memoria recupera documentación, código, convenciones y trazas del proyecto para reducir lecturas repetidas y contexto innecesario.

La integración es opcional y gobernada por tres niveles: configuración general de Pi-Hive, preferencia de workspace y preferencia de agente. La memoria nunca sustituye el estado persistido del pipeline, sus gates, aprobaciones humanas ni las tools propias del harness.

## Hallazgos conocidos

- La revisión de Pi-Hive no encontró integración MCP existente en el backend, prompts o frontend. Antes de implementar hay que confirmar si la versión instalada de `@earendil-works/pi-coding-agent` aporta cliente MCP o gestión de tools que se pueda reutilizar.
- En el equipo revisado, Ollama tiene `nomic-embed-text` descargado y no mostraba modelos cargados en memoria durante la inspección.
- LiteRT estaba activo y exponía `minicpm5-2b`, identificado en la configuración local como modelo de inferencia. No se verificó un modelo de embeddings compatible con Nexo-Palace.
- Nexo-Palace documenta herramientas MCP de consulta, estado, trazabilidad y registro de decisiones, y proveedores de embeddings como Ollama y LiteRT. La primera implementación debe permitir configurar proveedor externamente y no debe dar por hecho que LiteRT está listo para embeddings.
- Ollama documenta `/api/embed` y `keep_alive` de cinco minutos por defecto. Los modelos descargados permanecen en disco; su residencia en memoria es temporal. Dos modelos Ollama pueden competir por memoria mientras ambos estén cargados.

Referencias:

- https://github.com/JonyDevProjects/nexo-palace
- https://github.com/ollama/ollama/blob/main/docs/api.md
- https://github.com/ollama/ollama/blob/main/docs/faq.mdx

## Modelo de estados

Mantener separados estos conceptos:

1. `globalMemoryEnabled`: habilitación general de la función en Pi-Hive.
2. `mcpConfigured`: existe configuración válida del servidor, sin exponer secretos.
3. `mcpAvailable`: el servicio MCP respondió a una comprobación de salud dentro del timeout.
4. `workspace.memoryEnabled`: preferencia persistida del workspace.
5. `agent.memoryEnabled`: preferencia persistida del agente.
6. `memoryEffective`: decisión calculada en backend para permitir tools en un turno.

Regla de efectividad:

```text
memoryEffective = globalMemoryEnabled
  && mcpConfigured
  && mcpAvailable
  && workspace.memoryEnabled
  && agent.memoryEnabled
```

La disponibilidad es estado operativo temporal; no se persiste en cada workspace/agente. Si el MCP falla, `memoryEffective` pasa a falso sin modificar las preferencias. Al recuperarse, vuelve a calcularse usando las preferencias guardadas.

Al crear un workspace, su preferencia inicial es `true` solo si el control se muestra porque la función general está habilitada y el MCP está disponible. Al crear un agente, su preferencia inicial copia el valor actual del workspace. Una vez creado, la preferencia del agente es independiente: el cambio del workspace no sobrescribe la preferencia persistida del agente.

## Reglas de interfaz solicitadas

### Configuración general de Pi-Hive

- Si Nexo-Palace no está configurado, mostrar un mensaje indicando que hay que instalar/configurar la herramienta para habilitar memoria inteligente y un enlace a https://github.com/JonyDevProjects/nexo-palace.
- Si no está configurado, no mostrar el checkbox de habilitación general.
- Si está configurado, mostrar checkbox de habilitación global y estado de conexión (disponible/no disponible), diferenciando apagado manual de fallo de conexión.
- Ofrecer comprobación/actualización manual de salud si encaja con el diseño de settings actual.
- Exponer al frontend solo estado sanitizado; nunca comandos con secretos ni credenciales.

### Formularios y vistas de workspace

- Crear workspace: mostrar el checkbox solo cuando la función general esté habilitada y MCP disponible; inicializar marcado.
- Editar workspace: mostrar preferencia persistida y disponibilidad efectiva. Si MCP está caído, advertir que no está disponible, sin borrar/resetear la preferencia.
- Si Nexo-Palace no está configurado o la función general está apagada, ocultar controles de uso operativo sin alterar preferencias almacenadas.
- Listados/detalles: indicador que distinga preferencia activada de efectividad; ejemplo “Preferencia activada · MCP no disponible”.

### Formularios y vistas de agente

- Mostrar control de memoria solo cuando el workspace tiene preferencia habilitada y Pi-Hive tiene memoria configurada globalmente.
- Crear agente: esperar a cargar el workspace y usar su preferencia como valor inicial.
- Permitir activar/desactivar memoria para el agente y guardar la preferencia aunque MCP esté temporalmente caído.
- Editar agente: presentar preferencia guardada y disponibilidad efectiva por separado.
- Si el workspace desactiva memoria, ocultar el control de uso al crear/editar agentes, sin borrar la preferencia almacenada del agente.
- Listados/detalles: indicador distinto para preferencia y disponibilidad.

El backend siempre calcula la efectividad. El frontend no autoriza tools basándose solo en los checkboxes.

## Fase 1: auditoría de arquitectura y seguridad

Antes de editar:

1. Revisar `git status --short` y diffs de todos los archivos candidatos; preservar cambios locales.
2. Inspeccionar configuración general existente, APIs, DTOs, persistencia y UI de settings.
3. Inspeccionar modelos/entidades/migraciones/controllers/formularios de workspace y agente.
4. Inspeccionar `agent-runner.service.ts`, resolución de herramientas, sesión, prompt builder, callbacks y trazas.
5. Inspeccionar tipos y paquete instalado `@earendil-works/pi-coding-agent` para confirmar soporte MCP: transporte, ciclo de vida, tool registry, timeouts, cancelación y cierre.
6. Revisar pruebas/builds y convenciones Nx.
7. Entregar una tabla breve `capacidad actual | evidencia/ruta | brecha | cambio mínimo`.

No editar el proyecto del harness, templates o artefactos de migraciones. No reiniciar servicios ni guardar secretos en configuración serializada que se devuelva al frontend.

## Fase 2: configuración global y servicio MCP

### Configuración

- Añadir configuración general siguiendo los mecanismos actuales de Pi-Hive para habilitar/deshabilitar memoria y definir el servidor MCP.
- Secretos, si se requieren, deben usar el mecanismo seguro existente. Si no existe, documentar la brecha y no crear almacenamiento inseguro.
- La API de settings devuelve estado sanitizado: configurado, habilitado, disponible, timestamp/resultado breve de salud.

### Servicio exclusivo MCP

Crear un servicio backend responsable de:

- conectar con Nexo-Palace usando transporte oficialmente soportado;
- validar handshake y tools/schemas anunciados;
- allowlist de tools aprobadas;
- exponer llamadas acotadas a los consumidores;
- health check inicial, periódico y manual;
- actualizar estado de disponibilidad y propagar cambios;
- aplicar timeout, cancelación y backoff limitado, evitando loops;
- cierre limpio de clientes/procesos gestionados;
- redactar secretos y limitar contenido en logs/trazas.

No usar `memory_status` como health check si no es apropiado; comprobar transporte/respuesta con una operación mínima. No hacer consultas de embeddings durante el health check porque pueden cargar el modelo.

Si el servidor no está disponible, tools de memoria no se exponen. Un fallo MCP debe producir diagnóstico compacto y no bloquear el trabajo normal del agente.

## Fase 3: persistencia y APIs de preferencia

- Añadir campos booleanos opcionales de preferencia a workspace y agente, con default compatible.
- No persistir `mcpAvailable` en filas de workspace/agente.
- Workspace antiguo sin campo: normalizar como memoria desactivada hasta que exista preferencia explícita, sin habilitarla accidentalmente.
- Agente antiguo sin campo: no dar memoria efectiva inesperada; resolver default compatible en lectura o migración no destructiva.
- Crear workspace: persistir `true` cuando el control es visible; si no hay memoria general disponible, no activar.
- Crear agente: copiar preferencia del workspace al crear.
- Edición: cambios explícitos actualizan solo la preferencia del registro editado.
- APIs workspace/agente incluyen preferencias y estado efectivo sanitizado, calculado con estado global actual.
- Restringir cambios a roles/permisos existentes de administración y ownership.

No alterar preferencia alguna cuando MCP cae, vuelve a estar disponible o el admin cambia el estado global.

## Fase 4: conexión al runner y exposición de tools

- Reutilizar soporte MCP del runtime si existe; de lo contrario integrar el cliente mínimo sin reemplazar el sistema de tools existente.
- Calcular `memoryEffective` en backend antes de crear/preparar tools por agente/turno.
- Exponer inicialmente solo lectura: `memory_query`, `memory_trace`; `memory_status` solo para diagnóstico autorizado.
- No habilitar `memory_record_decision` en esta entrega, pues escribe memoria persistente y necesita política de autorización separada.
- En caída durante un turno, impedir nuevas llamadas MCP; mantener tools no relacionadas con memoria.
- Fallos de tool devuelven error breve, trazable y no reintentable indefinidamente por el modelo.
- Evitar reconexiones/consultas automáticas en cada callback de progreso.
- Workspace/agente sin memoria efectiva no recibe tools MCP ni prompt adicional.

### Límites de contexto y tokens

- Limitar resultados por consulta, tamaño de fragmento y presupuesto total por turno.
- Devolver extractos, ruta, encabezado, tipo, identificador y procedencia; nunca archivos completos.
- Deduplicar fragmentos ya entregados dentro del turno/sesión sin perder procedencia.
- No reinyectar resultados en callback final si basta con el dato compacto y referencias.
- No consultar memoria para sustituir estado del pipeline, gates, catálogo autoritativo ni evidencia de aprobaciones.
- No añadir las tools a todos los roles ni hacer consultas en cada turno.
- Instrucción de prompt mínima: memoria informativa, bajo demanda, y subordinada al estado persistido/harness.

## Fase 5: frontend

Implementar controles siguiendo los patrones existentes de settings/workspaces/agentes:

1. Settings general: mensaje de instalación y enlace cuando no configurado; checkbox global y estado cuando configurado.
2. Workspace create/edit: checkbox sujeto a precondición global; default activo en creación; edición conserva valor durante outage.
3. Agent create/edit: checkbox sujeto a preferencia de workspace; default hereda el workspace; edición preserva preferencia propia.
4. Workspace/agent list/detail: indicador diferenciado de preferencia y disponibilidad.
5. Estados de carga/error: no activar defaults por error de API ni presentar memoria como efectiva sin confirmación backend.
6. Outage/recovery: actualizar indicador global/efectivo sin alterar preferencias.

## Fase 6: observabilidad y privacidad

Registrar con `runId`, `taskId`, `workspaceId` y `agentId`:

- estado de conexión/health y duración;
- tool permitida/rechazada, llamada, duración, timeout/fallo/cancelación;
- conteo aproximado de bytes/tokens de consulta/resultados;
- truncado/deduplicación aplicada;
- disponibilidad efectiva y motivo de denegación.

No guardar secretos, bodies completos ni preguntas sensibles sin necesidad. Asegurar que el trace existente no termine serializando la entrada MCP completa. Medir tokens por turno antes/después, llamadas de memoria, latencia y ratio de errores.

## Fase 7: pruebas

### Backend

1. Workspace sin config general, antiguo y nuevo: no hay tools ni llamadas MCP.
2. MCP no configurado: API sanitizada y sin exposición de secretos.
3. Global apagado: preferencias no se pierden y efectividad falsa.
4. MCP caído/timeout/desconexión a mitad de llamada: efectividad falsa, preferencias intactas, recuperación sin loops.
5. Reconnect: solo vuelve memoria para workspaces/agentes con ambas preferencias true.
6. Matriz completa de memoria efectiva según cinco condiciones.
7. Defaults de workspace/agente y override explícito de agente.
8. Allowlist, schemas inválidos, tool de escritura rechazada, cancelación y cierre de cliente.
9. Límites de resultado, tokens, truncamiento y deduplicación.
10. Callbacks progress/final no reconectan ni reinyectan contexto entero.
11. Logs/trazas sanitizados y correlacionados.

Usar mocks; tests normales no requieren red, Ollama, LiteRT ni servicio MCP real.

### Frontend

1. Settings sin MCP: mensaje/enlace, sin checkbox global.
2. Settings con MCP: checkbox y estado operativo.
3. Workspace create default true solo con disponibilidad; edit preserva preferencia en outage.
4. Agent create espera workspace y copia su default; toggle independiente.
5. Workspace sin preferencia: opción de agente oculta.
6. Indicadores de preferencia versus efectividad en workspace/agente.
7. Caída/recovery cambia estado visual sin cambiar preferencias.
8. Errores/loading no provocan habilitación accidental.

## Fase 8: validación del proveedor de embeddings

La integración debe ser independiente del proveedor. No cambiar modelos ni lanzar pruebas de carga sobre procesos activos sin verificar impacto.

Comparar, si es seguro y posible:

- Opción A: Nexo-Palace usa embeddings de Ollama; Pi-Hive usa inferencia de Ollama.
- Opción B: Nexo-Palace usa embeddings de LiteRT; Pi-Hive usa inferencia de Ollama.

Verificar antes de elegir LiteRT: modelo embedding compatible, endpoint/dimensiones correctas, configuración efectiva y comportamiento durante reindexación. El modelo `minicpm5-2b` observado no prueba que LiteRT esté sirviendo embeddings.

Medir memoria física total, latencia primera/siguientes solicitudes, `ollama ps`, loads/unloads y timeouts. Separar procesos no elimina competencia por memoria física. No reindexar usando proveedores mezclados; cambio de proveedor puede requerir reconstruir el índice vectorial según Nexo-Palace.

Si no se puede medir de forma segura, entregar instrucciones manuales reproducibles y dejar la elección sin fijar.

## Fase 9: validación y entrega

- Ejecutar tests y builds Nx pertinentes, sin dejar servicios backend/frontend corriendo.
- No declarar listo si fallan tests/builds relevantes o si no se cubren preferencias/efectividad/roles.
- Entregar un resumen con:
  - hallazgos de arquitectura y decisión de cliente MCP;
  - archivos/cambios;
  - configuración y defaults compatibles;
  - fórmula de memoria efectiva y propagación de disponibilidad;
  - roles/tools expuestos y límites de resultados;
  - pruebas/builds y resultado;
  - medición de tokens/latencia o plan pendiente;
  - comparación Ollama/LiteRT o motivo de no ejecutar;
  - pasos manuales de instalación/indexación y riesgos restantes.

## Criterios de aceptación

- Sin Nexo-Palace configurado, Pi-Hive muestra instrucciones/enlace en settings y no expone toggles de memoria en formularios de workspace/agente.
- Con MCP configurado, settings muestra el control global y health real.
- Workspace nuevo queda activado por defecto solo cuando el control esté disponible; workspace existente conserva preferencias.
- Agente nuevo hereda el valor del workspace; luego conserva su preferencia independiente.
- La caída global deshabilita uso en todo Pi-Hive y comunica estado, pero no modifica preferencias guardadas.
- La reconexión restaura disponibilidad efectiva conforme a preferencias.
- Tools solo se exponen si memoria efectiva es verdadera y el rol/tool están allowlisted.
- Fallos MCP no generan loops ni bloquean otras tools.
- Memoria no sustituye autoridad del pipeline, gates ni stops humanos.
- Hay límites verificables de contexto, observabilidad sin secretos y medición de tokens.
- Workspaces/agentes previos siguen funcionando sin migración destructiva ni habilitación accidental.
