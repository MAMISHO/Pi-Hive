#!/usr/bin/env node
/**
 * Repro script: replicates the delegation planner call for agent_run_logs#109507
 * (delegation_planned, task 1, Dev 6f83c757, workspace 5479dcc2, 2026-11-11 14:41:05Z)
 * using the SAME pi-coding-agent SDK flow as DelegationPlannerService.planOneShot.
 *
 * Usage: node scripts/repro-planner-trace.mjs
 *   (run from repo root; requires ollama running with ollama/ornith-1.5:9b-16k-pi)
 *
 * Prints: inputs (trace/task/roster/model), exact system+user prompts & lengths,
 * session/tool options, event timeline, and full extraction/debug like the service.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Type } from '@sinclair/typebox';
import { createAgentSession, defineTool, SessionManager, DefaultResourceLoader, ModelRuntime } from '@earendil-works/pi-coding-agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ---- Trace-under-test (from data/pi-hive.db) ----
const TRACE = {
  run_log_id: 109507,
  run_id: 'b7597f20-0728-47fc-8a87-2d005545f6c9',
  agent_id: '6f83c757-a59d-46ac-8392-37aa50521a18', // Dev (WORKER)
  workspace_id: '5479dcc2-2a44-4210-ad06-66fd06b79df9', // expression
  task_id: 1,
  created_at: '2026-11-11 14:41:05.839 +00:00',
  plannerModel: 'ollama/ornith-1.5:9b-16k-pi',
  observed: {
    reason: 'planner_empty_response', reason_detail: 'no_assistant_message',
    plannerMs: 49853, firstActivityMs: 2, timedOut: false,
    extraction: 'none', outLen: 0, assistantMsgCount: 0, messagesCount: 0,
    lastAssistantStopReason: null, rosterCount: 3, userTaskChars: 191,
    systemPromptChars: 5600, toolCallUsed: false,
  },
};

// Task 1 payload (exact)
const USER_TASK = 'Vamos a hacer una prueba de comunicación con Jim y pam,\ndile a Bob que le pregunte a pam que cuando es 2+2 y luego ese resultado que le diga pam a Bob, Bob le sume 100 y te diga la respuesta.';
const REQUESTER_LABEL = 'user (solicitante, NO es agente del roster)'; // sender=user
// Roster: available agents in workspace minus self(Dev) -> Chief, Bob, Pam (3)
const ROSTER = [
  { nickname: 'Chief-ugy', role: 'CHIEF', id: 'chief-mw9eqoxa' },
  { nickname: 'Bob', role: 'WORKER', id: 'f9604918-14c5-444e-a49a-fc5ea50536bb' },
  { nickname: 'Pam', role: 'WORKER', id: 'e39c6f44-a189-4108-ac34-a52fc5f72b86' },
];
const WORKSPACE_PATH = '/Users/mamisho/dev/Sin título/paginas/expression';
const PLANNER_SKILL_PATH = path.join(REPO_ROOT, 'data', 'pi-agent', 'skills', 'delegation-planning', 'SKILL.md');

// ---- Helpers copied/mirrored from DelegationPlannerService (v2-only, post-fix) ----
function stripFrontmatter(content) {
  const m = content.match(/^---\s*[\s\S]*?\s*---\s*/);
  return m ? content.slice(m[0].length) : content;
}
function preview(s, n) { const t = String(s || ''); return t.length > n ? `${t.slice(0, n)}…[+${t.length - n}]` : t; }
function normNick(s) { return String(s || '').trim().toLowerCase(); }
function canonicalNick(roster, name) {
  const n = normNick(name);
  const found = (roster || []).find((r) => normNick(r.nickname) === n);
  return found ? found.nickname : null;
}
const DEFAULT_PARADA = {
  success: 'Finaliza cuando todos los nodos y subnodos están en estado terminal resuelto (DONE o SKIPPED) y el resultado de la rama se ha entregado al solicitante original.',
  on_failure: 'Si un nodo queda FAILED/BLOCKED irrecuperable, propagar el error y contexto al solicitante original y finalizar la rama; replanificar solo si se solicita explícitamente.',
  assumes_result: false,
};
function extractJsonBlock(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : text).trim();
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };
  let obj = tryParse(candidate);
  if (obj) return { obj, repaired: false, parsePath: fence ? 'fence' : 'direct' };
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    obj = tryParse(candidate.slice(start, end + 1));
    if (obj) return { obj, repaired: false, parsePath: 'slice_balanced' };
  }
  if (start >= 0) {
    let s = candidate.slice(start).replace(/\s+$/g, '').replace(/,\s*$/g, '').replace(/:\s*$/g, ': null');
    const closeBalanced = (src) => {
      let inStr = false, esc = false; const stack = [];
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true; else if (c === '{') stack.push('}'); else if (c === '[') stack.push(']'); else if ((c === '}' || c === ']') && stack.length && stack[stack.length - 1] === c) stack.pop();
      }
      let fixed = src; if (inStr) { if (fixed.endsWith('\\')) fixed = fixed.slice(0, -1); fixed += '"'; }
      fixed = fixed.replace(/,\s*$/g, ''); while (stack.length) fixed += stack.pop(); return fixed;
    };
    obj = tryParse(closeBalanced(s)); if (obj) return { obj, repaired: true, parsePath: 'repaired_close' };
    const lastBoundary = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'), s.lastIndexOf('"'));
    if (lastBoundary > 0) { let s2 = s.slice(0, lastBoundary + 1).replace(/,\s*$/g, ''); obj = tryParse(closeBalanced(s2)); if (obj) return { obj, repaired: true, parsePath: 'repaired_trim_close' }; }
  }
  return { obj: null, repaired: false, parsePath: 'none' };
}
function parsePlanV2(obj, roster) {
  const rawNodes = Array.isArray(obj?.nodes) ? obj.nodes : (Array.isArray(obj?.tree) ? obj.tree : null);
  if (!rawNodes) return { ok: false, reason: 'planner_no_nodes' };
  const validate = (arr, pathPrefix, parentDelegateTo) => {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i] || {};
      const id = String(s.id || (pathPrefix ? `${pathPrefix}.${i + 1}` : `${i + 1}`)).trim();
      const owner = canonicalNick(roster, String(s.owner ?? s.responsable ?? s.destino ?? s.target ?? s.agent ?? '').trim());
      if (!owner) return { err: `invalid_node_${id}_owner_not_in_roster` };
      if (parentDelegateTo && normNick(owner) !== normNick(parentDelegateTo)) return { err: `invalid_node_${id}_owner_mismatch_parent_delegate` };
      const dtRaw = s.delegate_to ?? s.delegateTo ?? s.delegar_a ?? s.to ?? null;
      let delegate_to = null;
      if (dtRaw != null && String(dtRaw).trim() !== '' && String(dtRaw).toLowerCase() !== 'null' && String(dtRaw).toLowerCase() !== 'none') {
        const dn = canonicalNick(roster, String(dtRaw)); if (!dn) return { err: `invalid_node_${id}_delegate_to_not_in_roster` }; delegate_to = dn;
      }
      const action = String(s.action ?? s.accion ?? s.task ?? s.instruction ?? '').trim();
      const deliver_to = String(s.deliver_to ?? s.entrega ?? s.return_to ?? s.report_to ?? s.deliverTo ?? 'solicitante').trim() || 'solicitante';
      const stop = String(s.stop ?? s.condicion ?? s.condition ?? s.halt ?? '').trim();
      if (!action || !stop) return { err: `invalid_node_${id}_missing_fields` };
      const childrenRaw = Array.isArray(s.children) ? s.children : (Array.isArray(s.subnodes) ? s.subnodes : []);
      let children = [];
      if (childrenRaw.length) { const cv = validate(childrenRaw, id, delegate_to || owner); if (cv.err) return cv; children = cv; }
      out.push({ id, owner, delegate_to, action, deliver_to, stop, status: 'PENDING', children, result_ref: null, result_summary: null, error: null });
    }
    return out;
  };
  const vr = validate(rawNodes, '', null);
  if (vr.err) return { ok: false, reason: vr.err };
  const nodes = vr; if (!nodes.length) return { ok: false, reason: 'planner_no_nodes' };
  let parada = { ...DEFAULT_PARADA };
  const p = obj?.parada ?? obj?.stop;
  if (p && typeof p === 'object') parada = { success: String(p.success || p.exito || DEFAULT_PARADA.success), on_failure: String(p.on_failure || p.fallo || p.failure || DEFAULT_PARADA.on_failure), assumes_result: false };
  else if (typeof p === 'string' && p.trim()) parada = { success: p.trim(), on_failure: DEFAULT_PARADA.on_failure, assumes_result: false };
  return { ok: true, nodes, parada };
}
function buildSystemPrompt(rosterText, requesterLabel) {
  let skillBody = '';
  try { skillBody = stripFrontmatter(fs.readFileSync(PLANNER_SKILL_PATH, 'utf-8')).trim(); }
  catch { skillBody = 'Produce a concise delegation tracking plan as a JSON tree (schema v2), all nodes PENDING, no result values in stop/parada.'; }
  return [
    'You are a delegation planning specialist for a multi-agent hive.',
    'You receive a user request and the available agent roster. Produce ONLY a delegation tracking plan.',
    'Respond by CALLING the tool `submit_delegation_plan` with the plan as its arguments (preferred, deterministic). Do not answer with chat text. (Fallback: if tool call is not possible, return a single COMPLETE JSON object, no markdown/trailing text.)',
    'Plan schema v2: {"schema":"v2","solicitante_raiz":"<requester>","parada":{"success":"...","on_failure":"...","assumes_result":false},"nodes":[{"id":"1","owner":"<nickname>","delegate_to":"<nickname|null>","action":"...","deliver_to":"<nickname|solicitante>","stop":"...","status":"PENDING","children":[]}]}',
    'Rules: use only exact nicknames from the ROSTER for owner/delegate_to (never invent). The requester/origin is NOT in the roster and must NEVER be owner/delegate_to (only in solicitante_raiz/deliver_to/parada for final delivery). Preserve the chain and intermediaries (no shortcuts). Every node status MUST be "PENDING".',
    'Stop/parada are GENERAL completion criteria (all nodes resolved DONE/SKIPPED, or propagate irrecoverable FAILED/BLOCKED to requester) and must NEVER include or assume the expected result value (assumes_result=false). Structure the route; do not solve the task.',
    'NEVER solve or pre-execute the task and NEVER embed expected result values (no computed answers or result numbers) in action/stop/parada. Do not claim any agent already responded; plan so each step is actually delegated/executed.',
    'Keep the plan concise and complete (do not truncate).',
    'Do not explore the environment, files, or code. `branch`/`depth`/`request`/`origin` are chain metadata, never filesystem paths.',
    '',
    '[ROSTER (agentes disponibles; solo estos pueden ser owner/delegate_to)]',
    rosterText || '(sin otros agentes registrados)',
    '',
    '[SKILL-REFERENCE]',
    skillBody,
  ].join('\n');
}

const log = (...a) => console.log(new Date().toISOString(), ...a);
const dump = (label, obj) => { console.log(`\n===== ${label} =====`); console.log(typeof obj === 'string' ? obj : JSON.stringify(obj, (k,v)=> typeof v==='bigint'?v.toString():v, 2)); };

async function main() {
  dump('TRACE (db)', TRACE);
  dump('INPUT', { task_id: TRACE.task_id, agent: 'Dev', model: TRACE.plannerModel, requesterLabel: REQUESTER_LABEL, userTaskChars: USER_TASK.length, userTask: USER_TASK, roster: ROSTER });

  const rosterText = ROSTER.map((a) => `- ${a.nickname}${a.role ? ` (${a.role})` : ''}${a.id ? ` id=${a.id}` : ''}`).join('\n');
  const systemPrompt = buildSystemPrompt(rosterText, REQUESTER_LABEL);
  const userMsg = `<USER_REQUEST>\n${USER_TASK}\n</USER_REQUEST>\n\n<REQUESTER>\n${REQUESTER_LABEL}\n</REQUESTER>\n\nGenera el plan de delegación v2 (tracking jerárquico, todos los nodos PENDING). Responde ÚNICAMENTE llamando a la herramienta \`submit_delegation_plan\` con el plan completo (sin texto de chat). Si no puedes usar la herramienta, devuelve SOLO el objeto JSON completo. No des la solución ni valores de resultado; estructura la ruta.`;

  dump('PROMPTS (lengths vs observed)', {
    rosterText, systemPromptChars: systemPrompt.length, observed_systemPromptChars: TRACE.observed.systemPromptChars,
    userMsgChars: userMsg.length, userTaskChars: USER_TASK.length,
  });
  dump('SYSTEM_PROMPT (full)', systemPrompt);
  dump('USER_MESSAGE (full)', userMsg);

  log('Resolving model via ModelRuntime (refreshOnCreate:false, allowModelNetwork:false)...');
  const runtime = await ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false });
  const [provider, ...rest] = TRACE.plannerModel.split('/');
  const modelId = rest.join('/');
  let model = runtime.getModel?.(provider, modelId) ?? runtime.getPhysicalModel?.(provider, modelId);
  dump('MODEL', { provider, modelId, found: !!model, model: model ? { id: model.id, name: model.name, provider: model.provider, api: model.api, baseUrl: model.baseUrl, contextWindow: model.contextWindow, maxTokens: model.maxTokens, reasoning: model.reasoning, input: model.input } : null, runtimeKeys: Object.keys(runtime || {}) });

  if (!model) { console.error('Model not found in runtime'); process.exit(2); }

  const cwd = fs.existsSync(WORKSPACE_PATH) ? WORKSPACE_PATH : process.cwd();
  const agentDir = path.join(REPO_ROOT, 'data', 'pi-agent');
  const sessionManager = SessionManager.inMemory(cwd);

  let submittedPlan = null;
  const submitDelegationPlanTool = defineTool({
    name: 'submit_delegation_plan',
    label: 'submit_delegation_plan',
    description: 'Submit the delegation tracking plan (schema v2). Call this with the complete plan object.',
    parameters: Type.Object({
      schema: Type.Literal('v2'),
      solicitante_raiz: Type.String(),
      parada: Type.Object({ success: Type.String(), on_failure: Type.String(), assumes_result: Type.Boolean() }),
      nodes: Type.Array(Type.Any()),
    }),
    async execute(_toolCallId, args) {
      submittedPlan = args;
      log('TOOL execute submit_delegation_plan captured args keys=', Object.keys(args||{}));
      return { content: [{ type: 'text', text: 'plan_received' }], details: { ok: true } };
    },
  });

  let resourceLoader;
  try {
    resourceLoader = new DefaultResourceLoader({ cwd, agentDir, noSkills: true, noExtensions: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt });
  } catch (e) { log('resourceLoader failed', e); resourceLoader = undefined; }

  const sessionOpts = {
    sessionManager, model, modelRuntime: runtime, cwd, agentDir,
    customTools: [submitDelegationPlanTool], tools: ['submit_delegation_plan'],
    ...(resourceLoader ? { resourceLoader } : {}),
  };
  dump('SESSION_OPTS (summary)', { cwd, agentDir, tools: sessionOpts.tools, customTools: sessionOpts.customTools.map(t=>t.name), hasResourceLoader: !!resourceLoader, modelRuntimePassed: !!sessionOpts.modelRuntime });

  log('createAgentSession...');
  const created = await createAgentSession(sessionOpts);
  const session = created?.session;
  try { const ag = session?.agent; if (ag) { if (typeof ag.setSystemPrompt === 'function') ag.setSystemPrompt(systemPrompt); else ag.systemPrompt = systemPrompt; } } catch {}

  const events = [];
  const started = Date.now();
  let firstActivityAt = null;
  const markActivity = (ev) => { const now = Date.now(); if (firstActivityAt == null) firstActivityAt = now; events.push({ t: now-started, ev }); };
  const unsubscribe = typeof session.subscribe === 'function' ? session.subscribe((ev) => markActivity(ev)) : undefined;

  const idleTimeoutMs = 45000, hardMaxMs = 300000;
  let timedOut = false; let lastActivity = started;
  // track lastActivity on any event
  const origMark = markActivity;
  const wrappedUnsub = unsubscribe; // events already pushed; also bump lastActivity
  const trackSub = typeof session.subscribe === 'function' ? session.subscribe(() => { const now = Date.now(); if (firstActivityAt==null) firstActivityAt=now; lastActivity = now; }) : undefined;

  log('session.prompt() ...');
  const runPromise = session.prompt(userMsg);
  const watchdogPromise = new Promise((_, reject) => {
    const wd = setInterval(() => {
      const now = Date.now();
      if (now - started >= hardMaxMs) { timedOut = 'max'; clearInterval(wd); reject(new Error('planner_timeout_max')); }
      else if (now - lastActivity >= idleTimeoutMs) { timedOut = 'idle'; clearInterval(wd); reject(new Error('planner_timeout_idle')); }
    }, 1000);
    runPromise.finally(() => clearInterval(wd)).catch(() => {});
  });

  let runError = null;
  try { await Promise.race([runPromise, watchdogPromise]); } catch (e) { runError = e; log('run error/timeout', e?.message || e); }

  const plannerMs = Date.now() - started;
  const firstActivityMs = firstActivityAt ? firstActivityAt - started : null;

  // Gather messages/state
  let msgs = []; try { msgs = typeof session.getMessages === 'function' ? (session.getMessages() || []) : []; } catch(e){ log('getMessages err', e); }
  let assistantMsgCount = 0; let lastAssistantContentTypes; let lastAssistantStopReason = null;
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i]?.role === 'assistant') assistantMsgCount++; }
  for (let i = msgs.length - 1; i >= 0; i--) { const m=msgs[i]; if (m?.role==='assistant'){ lastAssistantContentTypes = Array.isArray(m.content)?m.content.map(p=>String(p?.type||typeof p)):[typeof m.content]; lastAssistantStopReason = m.stopReason ?? m.stop_reason ?? null; break; } }

  // Extraction like service
  const pickToolArgs = (c) => {
    if (!c) return null; const name = c.name || c.toolName || c.function?.name; if (name !== 'submit_delegation_plan') return null;
    let args = c.arguments ?? c.args ?? c.input ?? c.function?.arguments; if (typeof args === 'string') { try { args = JSON.parse(args); } catch {} }
    if (args && typeof args === 'object') { if (args.plan && (args.plan.schema==='v2'||Array.isArray(args.plan.nodes))) return args.plan; return args; } return null;
  };
  let extraction = 'none', outText = '', toolCallObj = null;
  if (submittedPlan && typeof submittedPlan === 'object') { extraction = 'tool_call'; toolCallObj = submittedPlan.plan && (submittedPlan.plan.schema==='v2'||Array.isArray(submittedPlan.plan.nodes)) ? submittedPlan.plan : submittedPlan; }
  else {
    outer: for (let i=msgs.length-1;i>=0;i--){ const m=msgs[i]; if(m?.role!=='assistant') continue; const c=m.content; if(Array.isArray(c)){ for(let j=c.length-1;j>=0;j--){ const p=c[j]; if(p&&(p.type==='toolCall'||p.type==='tool_call'||p.type==='functionCall')){ const o=pickToolArgs(p); if(o){ extraction='tool_call'; toolCallObj=o; break outer; } } } } const o=pickToolArgs(m); if(o){ extraction='tool_call'; toolCallObj=o; break; } }
  }
  if (extraction==='none') {
    try { const last = typeof session.getLastAssistantText === 'function' ? session.getLastAssistantText() : undefined; if (last && String(last).trim()) { outText = String(last); extraction='lastText'; } } catch {}
  }
  if (extraction==='none') {
    for (let i=msgs.length-1;i>=0;i--){ const m=msgs[i]; if(m?.role!=='assistant') continue; const c=m.content; if(typeof c==='string'&&c.trim()){ outText=c; extraction='messages'; break; } if(Array.isArray(c)){ const text=c.filter(p=>p&&p.type==='text'&&typeof p.text==='string').map(p=>p.text).join(''); if(text.trim()){ outText=text; extraction='messages'; break; } } }
  }

  let parse = null;
  if (extraction==='tool_call' && toolCallObj) parse = parsePlanV2(toolCallObj, ROSTER);
  else if (outText) { const ex = extractJsonBlock(outText); parse = ex.obj ? parsePlanV2(ex.obj, ROSTER) : { ok:false, reason:'no_json' }; }

  const debug = {
    plannerMs, firstActivityMs, idleTimeoutMs, hardMaxMs, timedOut, extraction,
    outLen: outText.length, assistantMsgCount, messagesCount: msgs.length,
    lastAssistantContentTypes, lastAssistantStopReason, toolCallUsed: extraction==='tool_call',
    rosterCount: ROSTER.length, userTaskChars: USER_TASK.length, systemPromptChars: systemPrompt.length,
  };

  dump('RUN RESULT', { runError: runError ? { message: runError.message, name: runError.name } : null, plannerMs, firstActivityMs, timedOut });
  dump('DEBUG (like service)', debug);
  dump('EVENTS timeline (count & first/last 30)', { count: events.length, first: events.slice(0,30), last: events.slice(-30) });
  dump('MESSAGES (full, sanitized)', msgs);
  dump('EXTRACTION/PARSE', { extraction, outTextPreview: preview(outText, 800), toolCallObj: toolCallObj ? preview(JSON.stringify(toolCallObj), 1200) : null, submittedPlanCaptured: !!submittedPlan, parse });

  try { if (session?.dispose) session.dispose(); } catch {}
  try { if (unsubscribe) unsubscribe(); } catch {}
  try { if (trackSub) trackSub(); } catch {}
  log('done');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
