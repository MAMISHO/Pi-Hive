#!/usr/bin/env bash
set -euo pipefail

# Deterministic audit for Pi-Hive delegation/task traces (SQLite).
# Usage examples:
#   scripts/audit-trace.sh --ids 1,2,3,6
#   scripts/audit-trace.sh --range 10-20
#   scripts/audit-trace.sh --since 5 --flow delegation_result
#   scripts/audit-trace.sh --agent Bob --text "104"
#   scripts/audit-trace.sh --workspace <uuid> --limit 200 --events
#   scripts/audit-trace.sh --db data/pi-hive.db --events --no-summary

DB="data/pi-hive.db"
IDS=""; RANGE=""; SINCE=""; AGENT=""; FLOW=""; STATUS=""; TEXT=""; WORKSPACE=""
LIMIT="500"; SHOW_EVENTS=0; SHOW_SUMMARY=1; PAYLOAD_LEN=260; RESP_LEN=260; CONTENT_LEN=260

usage(){ sed -n '1,60p' "$0"; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --db) DB="$2"; shift 2;;
    --ids) IDS="$2"; shift 2;;
    --range) RANGE="$2"; shift 2;;
    --since) SINCE="$2"; shift 2;;
    --agent) AGENT="$2"; shift 2;;
    --flow) FLOW="$2"; shift 2;;
    --status) STATUS="$2"; shift 2;;
    --text) TEXT="$2"; shift 2;;
    --workspace) WORKSPACE="$2"; shift 2;;
    --limit) LIMIT="$2"; shift 2;;
    --events) SHOW_EVENTS=1; shift;;
    --no-summary) SHOW_SUMMARY=0; shift;;
    --payload-len) PAYLOAD_LEN="$2"; shift 2;;
    --response-len) RESP_LEN="$2"; shift 2;;
    --content-len) CONTENT_LEN="$2"; shift 2;;
    -h|--help) usage;;
    *) echo "Unknown arg: $1" >&2; usage;;
  esac
done

[[ -f "$DB" ]] || { echo "DB not found: $DB" >&2; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 not found" >&2; exit 1; }

sql_escape(){ printf "%s" "$1" | sed "s/'/''/g"; }

TASK_WHERE="1=1"
if [[ -n "$IDS" ]]; then TASK_WHERE="$TASK_WHERE AND t.id IN ($IDS)"; fi
if [[ -n "$RANGE" ]]; then IFS='-' read -r A B <<<"$RANGE"; TASK_WHERE="$TASK_WHERE AND t.id BETWEEN ${A:-0} AND ${B:-999999999}"; fi
if [[ -n "$SINCE" ]]; then TASK_WHERE="$TASK_WHERE AND t.id >= $SINCE"; fi
if [[ -n "$FLOW" ]]; then TASK_WHERE="$TASK_WHERE AND IFNULL(t.task_flow,'')='$(sql_escape "$FLOW")'"; fi
if [[ -n "$STATUS" ]]; then TASK_WHERE="$TASK_WHERE AND IFNULL(t.status,'')='$(sql_escape "$STATUS")'"; fi
if [[ -n "$WORKSPACE" ]]; then TASK_WHERE="$TASK_WHERE AND IFNULL(t.workspace_id,'')='$(sql_escape "$WORKSPACE")'"; fi
if [[ -n "$AGENT" ]]; then A=$(sql_escape "$AGENT"); TASK_WHERE="$TASK_WHERE AND (IFNULL(sa.nickname,'') LIKE '%$A%' OR IFNULL(ra.nickname,'') LIKE '%$A%' OR IFNULL(t.sender_agent_id,'')='$(sql_escape "$AGENT")' OR IFNULL(t.receiver_agent_id,'')='$(sql_escape "$AGENT")')"; fi
if [[ -n "$TEXT" ]]; then T=$(sql_escape "$TEXT"); TASK_WHERE="$TASK_WHERE AND (IFNULL(t.payload,'') LIKE '%$T%' OR IFNULL(t.response,'') LIKE '%$T%')"; fi

echo "== DB: $DB =="
echo "== Filters: ids=${IDS:-*} range=${RANGE:-*} since=${SINCE:-*} agent=${AGENT:-*} flow=${FLOW:-*} status=${STATUS:-*} workspace=${WORKSPACE:-*} text=${TEXT:-*} limit=$LIMIT =="

echo
echo "## Tasks (tasks_queue)"
sqlite3 -header -column "$DB" "SELECT t.id, IFNULL(sa.nickname,t.sender_agent_id) AS sender, IFNULL(ra.nickname,t.receiver_agent_id) AS receiver, t.status, IFNULL(t.task_flow,'direct') AS task_flow, IFNULL(t.callback_final,0) AS cb_final, t.parent_task_id, IFNULL(t.plan_ref,'') AS plan_ref, t.depth, IFNULL(t.depth_path,'') AS depth_path, substr(replace(IFNULL(t.payload,''),char(10),' '),1,$PAYLOAD_LEN) AS payload, substr(replace(IFNULL(t.response,''),char(10),' '),1,$RESP_LEN) AS response, datetime(t.created_at,'localtime') AS created_at FROM tasks_queue t LEFT JOIN agents sa ON sa.id=t.sender_agent_id LEFT JOIN agents ra ON ra.id=t.receiver_agent_id WHERE $TASK_WHERE ORDER BY t.id ASC LIMIT $LIMIT;"

if [[ $SHOW_EVENTS -eq 1 ]]; then
  echo
  echo "## Events (agent_chat_events for selected tasks)"
  sqlite3 -header -column "$DB" "WITH sel AS (SELECT t.id FROM tasks_queue t LEFT JOIN agents sa ON sa.id=t.sender_agent_id LEFT JOIN agents ra ON ra.id=t.receiver_agent_id WHERE $TASK_WHERE) SELECT e.id, IFNULL(a.nickname,e.agent_id) AS agent, e.task_id, e.direction, e.kind, substr(replace(IFNULL(e.content,''),char(10),' '),1,$CONTENT_LEN) AS content, datetime(e.created_at,'localtime') AS created_at FROM agent_chat_events e LEFT JOIN agents a ON a.id=e.agent_id WHERE e.task_id IN (SELECT id FROM sel) ORDER BY e.task_id ASC, e.id ASC LIMIT $LIMIT;"
fi

if [[ $SHOW_SUMMARY -eq 1 ]]; then
  echo
  echo "## Summary (counts by flow/cb_final)"
  sqlite3 -header -column "$DB" "SELECT IFNULL(t.task_flow,'direct') AS task_flow, IFNULL(t.callback_final,0) AS cb_final, COUNT(*) AS n FROM tasks_queue t LEFT JOIN agents sa ON sa.id=t.sender_agent_id LEFT JOIN agents ra ON ra.id=t.receiver_agent_id WHERE $TASK_WHERE GROUP BY IFNULL(t.task_flow,'direct'), IFNULL(t.callback_final,0) ORDER BY n DESC, task_flow;"
  echo
  echo "## Echo/duplicate candidates (same sender,receiver,flow,parent,cb_final repeated)"
  sqlite3 -header -column "$DB" "SELECT IFNULL(sa.nickname,t.sender_agent_id) AS sender, IFNULL(ra.nickname,t.receiver_agent_id) AS receiver, IFNULL(t.task_flow,'direct') AS task_flow, t.parent_task_id, IFNULL(t.callback_final,0) AS cb_final, COUNT(*) AS n, group_concat(t.id) AS ids FROM tasks_queue t LEFT JOIN agents sa ON sa.id=t.sender_agent_id LEFT JOIN agents ra ON ra.id=t.receiver_agent_id WHERE $TASK_WHERE GROUP BY t.sender_agent_id,t.receiver_agent_id,IFNULL(t.task_flow,'direct'),t.parent_task_id,IFNULL(t.callback_final,0) HAVING COUNT(*)>1 ORDER BY n DESC, ids;"
  echo
  echo "## Ping-pong candidates (A->B and B->A same flow in selection)"
  sqlite3 -header -column "$DB" "WITH s AS (SELECT IFNULL(sa.nickname,t.sender_agent_id) s, IFNULL(ra.nickname,t.receiver_agent_id) r, IFNULL(t.task_flow,'direct') f FROM tasks_queue t LEFT JOIN agents sa ON sa.id=t.sender_agent_id LEFT JOIN agents ra ON ra.id=t.receiver_agent_id WHERE $TASK_WHERE) SELECT a.s AS a, a.r AS b, a.f AS task_flow, COUNT(*) AS legs FROM s a JOIN s b ON a.s=b.r AND a.r=b.s AND a.f=b.f GROUP BY a.s,a.r,a.f;"
  echo
  echo "## Plans (delegation tracking)"
  sqlite3 -header -column "$DB" "SELECT t.id, IFNULL(t.plan_ref,'') AS plan_ref, IFNULL(sa.nickname,t.sender_agent_id) AS sender, IFNULL(ra.nickname,t.receiver_agent_id) AS receiver, IFNULL(t.task_flow,'direct') AS task_flow, t.parent_task_id, t.depth, IFNULL(t.depth_path,'') AS depth_path, datetime(t.created_at,'localtime') AS created_at FROM tasks_queue t LEFT JOIN agents sa ON sa.id=t.sender_agent_id LEFT JOIN agents ra ON ra.id=t.receiver_agent_id WHERE $TASK_WHERE AND t.plan_ref IS NOT NULL ORDER BY t.plan_ref ASC, t.id ASC LIMIT $LIMIT;"
  sqlite3 -header -column "$DB" "SELECT e.id, IFNULL(a.nickname,e.agent_id) AS agent, e.task_id, e.kind, substr(replace(IFNULL(e.content,''),char(10),' '),1,$CONTENT_LEN) AS content, datetime(e.created_at,'localtime') AS created_at FROM agent_chat_events e LEFT JOIN agents a ON a.id=e.agent_id WHERE e.kind='plan' AND (e.task_id IN (SELECT t.id FROM tasks_queue t LEFT JOIN agents sa ON sa.id=t.sender_agent_id LEFT JOIN agents ra ON ra.id=t.receiver_agent_id WHERE $TASK_WHERE) OR e.task_id IS NULL) ORDER BY e.id ASC LIMIT $LIMIT;"
fi
