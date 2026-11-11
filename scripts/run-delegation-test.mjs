#!/usr/bin/env node
/**
 * Lanza una prueba de delegación de la batería Pi-Hive y espera a que la
 * cadena completa se estabilice (sin tareas PENDING/PROCESSING).
 *
 * Uso:
 *   node scripts/run-delegation-test.mjs --test 1 --target Chief
 *   node scripts/run-delegation-test.mjs --test 2 --target Dev --no-clear
 *
 * Opciones:
 *   --test <1|2|3>      Prueba de la batería (obligatorio)
 *   --target <nick>     Agente que recibe la orden del usuario (obligatorio)
 *   --timeout <min>     Timeout total (default 45)
 *   --no-clear          No limpia sesiones/tasks antes de lanzar
 *   --base <url>        Base URL backend (default http://localhost:8090)
 */
const BASE = process.env.PI_HIVE_API || 'http://localhost:8090';

const TESTS = {
  1: 'Vamos a hacer una prueba de comunicacón en el sistema. Para ello vamos a jugar ping pong. Tú le envías un ping a Bob y bob debe responder pong.Luego cuando Bob responda pong debes decirle que le diga a pam ping y que pam debe responderle con un pong y bob debe darte la respuesta de pam.',
  2: 'Vamos a hacer una prueba de comunicación con Jim y pam,\ndile a Bob que le pregunte a pam que cuando es 2+2 y luego ese resultado que le diga pam a Bob, Bob le sume 100 y te diga la respuesta.',
  3: 'Necesitamos resolver una tarea que está detallada en:\n/Users/mamisho/dev/Pi-Hive/test/delegation/2/task1.txt\nCuando la termines dime su resultado.',
};

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const testId = Number(arg('test'));
const targetNick = arg('target');
const timeoutMin = Number(arg('timeout', 45));
const noClear = !!arg('no-clear', false);
const base = String(arg('base', BASE)).replace(/\/$/, '');

if (!TESTS[testId] || !targetNick) {
  console.error('Uso: node scripts/run-delegation-test.mjs --test <1|2|3> --target <nickname> [--timeout 45] [--no-clear]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toISOString().slice(11, 19);
const log = (...a) => console.log(`[${ts()}]`, ...a);

async function api(path, opts = {}) {
  const res = await fetch(base + path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return body;
}

async function main() {
  const ws = await api('/workspaces/active');
  if (!ws?.id) throw new Error('No hay workspace activo');
  const agents = await api('/agents');
  const target = agents.find((a) => String(a.nickname || '').toLowerCase() === String(targetNick).toLowerCase() && a.workspace_id === ws.id);
  if (!target) throw new Error(`Agente "${targetNick}" no encontrado en workspace ${ws.name}`);
  const roster = agents.filter((a) => a.workspace_id === ws.id && !a.archived_at).map((a) => `${a.nickname}(${a.role})`);

  log(`workspace=${ws.name} (${ws.id})`);
  log(`target=${target.nickname} (${target.id}) role=${target.role} model=${target.task_state?.model || '?'}`);
  log(`roster=${roster.join(', ')}`);

  if (!noClear) {
    log('clear-all: limpiando tasks y sesiones...');
    const cleared = await api(`/workspaces/${ws.id}/sessions/clear-all`, { method: 'POST' });
    if (cleared?.ok === false) throw new Error(`clear-all falló: ${JSON.stringify(cleared)}`);
    log(`clear-all ok: agents=${cleared?.cleared ?? '?'}`);
    await sleep(1500);
  }

  const payload = TESTS[testId];
  const root = await api('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      sender_agent_id: 'user',
      receiver_agent_id: target.id,
      payload,
      status: 'PENDING',
      parent_task_id: null,
      workspace_id: ws.id,
    }),
  });
  const rootId = Number(root.id);
  log(`TEST ${testId} lanzado: root task #${rootId} -> ${target.nickname}`);
  log(`payload: ${payload.replace(/\n/g, ' ').slice(0, 140)}...`);

  const deadline = Date.now() + timeoutMin * 60_000;
  const seen = new Map();
  let lastSig = '';
  let stableSince = 0;
  let done = false;

  while (Date.now() < deadline) {
    const tasks = (await api(`/tasks?workspaceId=${encodeURIComponent(ws.id)}`)).filter((t) => Number(t.id) >= rootId);
    for (const t of tasks) {
      const prev = seen.get(t.id);
      if (!prev || prev.status !== t.status || prev.response !== t.response) {
        if (!prev) {
          log(`  + task #${t.id} ${t.sender_agent_id === 'user' ? 'user' : (agents.find(a=>a.id===t.sender_agent_id)?.nickname || t.sender_agent_id)} -> ${agents.find(a=>a.id===t.receiver_agent_id)?.nickname || t.receiver_agent_id} flow=${t.task_flow || 'direct'} depth=${t.depth ?? 0}${t.parent_task_id ? ` parent=#${t.parent_task_id}` : ''}`);
        }
        if (!prev || prev.status !== t.status) log(`  ~ task #${t.id} status=${t.status}`);
        seen.set(t.id, { status: t.status, response: t.response });
      }
    }

    const live = tasks.filter((t) => t.status === 'PENDING' || t.status === 'PROCESSING');
    const rootTask = tasks.find((t) => Number(t.id) === rootId);
    const rootTerminal = rootTask && !['PENDING', 'PROCESSING'].includes(rootTask.status);
    const sig = tasks.map((t) => `${t.id}:${t.status}`).join('|') + `|live=${live.length}`;

    if (sig !== lastSig) {
      lastSig = sig;
      stableSince = Date.now();
      log(`estado: tasks=${tasks.length} live=${live.length}${live.length ? ' (' + live.map((t) => '#' + t.id + ':' + t.status).join(',') + ')' : ''} raiz=${rootTask?.status ?? '?'}`);
    }

    if (rootTerminal && live.length === 0) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= 15_000) { done = true; break; }
    }
    await sleep(4000);
  }

  const tasks = (await api(`/tasks?workspaceId=${encodeURIComponent(ws.id)}`)).filter((t) => Number(t.id) >= rootId);
  const rootTask = tasks.find((t) => Number(t.id) === rootId);
  log('================ RESULTADO ================');
  log(`root=#${rootId} status=${rootTask?.status} live=${tasks.filter((t) => t.status === 'PENDING' || t.status === 'PROCESSING').length} totalTasks=${tasks.length} ${done ? 'ESTABILIZADO' : 'TIMEOUT'}`);
  for (const t of tasks.sort((a, b) => a.id - b.id)) {
    const s = agents.find((a) => a.id === t.sender_agent_id)?.nickname || (t.sender_agent_id === 'user' ? 'user' : t.sender_agent_id);
    const r = agents.find((a) => a.id === t.receiver_agent_id)?.nickname || t.receiver_agent_id;
    log(`#${t.id} ${s} -> ${r} [${t.status}] flow=${t.task_flow || 'direct'} cb_final=${t.callback_final ?? 0} parent=${t.parent_task_id ?? '-'} plan_ref=${t.plan_ref ?? '-'} depth=${t.depth ?? 0}`);
  }
  if (!done) process.exit(3);
}

main().catch((e) => { console.error('ERROR:', e?.message || e); process.exit(2); });
