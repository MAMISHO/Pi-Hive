# Memoria externa opcional (Nexo-Palace / MCP)

Pi-Hive permite que cada workspace y agente use Nexo-Palace como memoria externa bajo demanda. **Pi es la única autoridad de configuración y conexión MCP**; Pi-Hive no guarda transporte, comando, argumentos, URL o CWD, ni inicia un cliente MCP propio.

## Configuración y preferencias

- Instala y configura Nexo-Palace en la configuración global MCP de Pi (`mcp.json`). Pi-Hive detecta un servidor habilitado cuya entrada identifique Nexo-Palace (nombre, origen o configuración contiene `nexo`, `palace` o `nxpl`). En Ajustes generales muestra el selector global solo si lo detecta; si no, ofrece el enlace de instalación.
- La preferencia global está activa por defecto cuando todavía no hay una elección guardada; un opt-out explícito se conserva.
- Con la opción global activa, los workspaces nuevos heredan memoria activa. Cada agente hereda la preferencia del workspace y puede cambiarla. La preferencia global, de workspace y de agente se guarda en Pi-Hive.
- Si Pi informa que las tools de memoria no se cargaron al iniciar una sesión, Pi-Hive marca la disponibilidad como no efectiva para todos los workspaces/agentes. Conserva las preferencias; una sesión posterior puede detectar que la conexión se recuperó.

## Uso en sesiones

- Pi-Hive usa la extensión MCP incluida en la SDK de Pi, que lee la configuración Pi y mantiene el transporte/conexión.
- En una sesión con memoria efectiva, Pi-Hive limita la exposición del servidor detectado a `memory_query` y `memory_trace`; Pi conecta el servidor con exposición directa para verificar las tools al iniciar. Los demás servidores Pi mantienen su configuración normal.
- Si la preferencia no está activa, el servidor de memoria se excluye de esa sesión. No se alteran los archivos de configuración de Pi.
- El prompt añade una instrucción breve: consultar solo cuando ayude a la tarea; prevalecen el estado persistido, gates, aprobaciones humanas y herramientas del harness.

## Trazabilidad

Pi-Hive conserva eventos `memory_state` y `memory_pi_session` con efectividad, motivo y tools de memoria detectadas. No registra configuración sensible de Pi. La memoria es informativa y no sustituye la evidencia operativa del pipeline.

## Instalación e indexado

1. Instala/configura [Nexo-Palace](https://github.com/JonyDevProjects/nexo-palace) en Pi.
2. Indexa los repositorios/fuentes y define exclusiones en Nexo-Palace según su documentación.
3. En Pi-Hive activa la preferencia global; luego ajusta workspace y agentes.

Pi-Hive no indexa ni escribe en Nexo-Palace. La actualización y frescura del índice dependen de la herramienta externa.
