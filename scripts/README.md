# Scripts de auditoría (Pi-Hive)

Utilidades deterministas para capturar trazas acotadas sin exploración manual repetida. Sirven para cualquier tipo de prueba (delegación básica, tooling/ficheros, multi-hop, regresiones, etc.).

## `audit-trace.sh`
Consulta SQLite (`data/pi-hive.db` por defecto) y vuelca tasks, eventos y resúmenes para detectar ecos/rebotes.

```bash
# por ids / rango / desde id
scripts/audit-trace.sh --ids 1,2,3,6
scripts/audit-trace.sh --range 10-20
scripts/audit-trace.sh --since 5

# por agente (nickname o id, emisor o receptor), flow, status, texto, workspace
scripts/audit-trace.sh --agent Bob --flow delegation_result
scripts/audit-trace.sh --agent Pam --text "104"
scripts/audit-trace.sh --status COMPLETED --workspace <uuid>

# incluir chat events de las tasks seleccionadas y acotar salida
scripts/audit-trace.sh --ids 3,4,5 --events --limit 300
scripts/audit-trace.sh --range 1-14 --events --payload-len 400 --response-len 400

# otra BD / sin resumen
scripts/audit-trace.sh --db data/pi-hive.db --no-summary
```

**Salida:**
- **Tasks**: id, sender/receiver (nickname), status, task_flow, cb_final, parent_task_id, plan_ref, depth, depth_path, payload/response (recortados), created_at.
- **Events** (`--events`): agent_chat_events de las tasks seleccionadas (direction/kind/content).
- **Summary**: conteos por flow/cb_final; **candidatos a eco/duplicado** (misma tupla sender,receiver,flow,parent,cb_final repetida); **candidatos a ping-pong** (A→B y B→A con mismo flow en la selección); **Planes** (tasks con `plan_ref` y eventos `kind='plan'` de tracking de delegación).

Los callbacks incluyen en el payload un encabezado de rastro (`state=FINAL|PROGRESS`, `task/request/origin/parent`, `depth`, `branch`) para distinguir resultados finales de informes intermedios y seguir la cadena origen→final. `branch/depth/path` son metadatos de cadena, no rutas de filesystem.
