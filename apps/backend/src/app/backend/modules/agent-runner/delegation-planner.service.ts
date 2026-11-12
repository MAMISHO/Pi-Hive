import { Injectable } from '@nestjs/common';
import { Type } from '@sinclair/typebox';
import { createAgentSession, defineTool, SessionManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import * as fs from 'fs';
import * as path from 'path';
import type { DelegationNode, DelegationParada } from './delegation-plan.store.js';
import { AppSettingsService } from '../app-settings/app-settings.service.js';

const FALLBACK_PLANNER_SKILL_PATH = path.join(process.cwd(), 'data', 'pi-agent', 'skills', 'delegation-planning', 'SKILL.md');

export interface DelegationPlanInput {
  model: any;
  runtime: any;
  userTask: string;
  roster: Array<{ nickname: string; role?: string; id?: string }>;
  requesterLabel?: string; // e.g. "user" (not a roster agent)
  cwd: string;
  timeoutMs?: number; // legacy: treated as idle timeout
  idleTimeoutMs?: number; // extend while activity observed (no-activity window)
  hardMaxMs?: number; // absolute cap (default 5 min)
}

export interface DelegationPlannerDebug {
  plannerMs: number;
  firstActivityMs: number | null;
  idleTimeoutMs: number;
  hardMaxMs: number;
  timedOut: 'idle' | 'max' | false;
  extraction: 'lastText' | 'messages' | 'tool_call' | 'none';
  outLen: number;
  outPreviewHead?: string;
  outPreviewTail?: string;
  assistantMsgCount: number;
  messagesCount: number;
  lastAssistantContentTypes?: string[];
  lastAssistantStopReason?: string | null;
  rosterCount: number;
  userTaskChars: number;
  systemPromptChars: number;
  repaired?: boolean;
  parsePath?: string;
  toolCallUsed?: boolean;
  errorName?: string;
  errorStackHead?: string;
}

export interface DelegationPlanResult {
  ok: boolean;
  schema?: 'v2';
  plan?: string; // canonical text for display/audit
  nodes?: DelegationNode[];
  parada?: string | DelegationParada | null;
  reason?: string;
  reason_detail?: string;
  plannerMs?: number;
  firstActivityMs?: number | null;
  debug?: DelegationPlannerDebug;
}

function stripFrontmatter(content: string): string {
  const m = content.match(/^---\s*[\s\S]*?\s*---\s*/);
  return m ? content.slice(m[0].length) : content;
}

function extractJsonBlock(text: string): { obj: any | null; repaired: boolean; parsePath: string } {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : text).trim();
  const tryParse = (s: string): any | null => { try { return JSON.parse(s); } catch { return null; } };

  let obj = tryParse(candidate);
  if (obj) return { obj, repaired: false, parsePath: fence ? 'fence' : 'direct' };

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    obj = tryParse(candidate.slice(start, end + 1));
    if (obj) return { obj, repaired: false, parsePath: 'slice_balanced' };
  }

  // Deterministic, cheap curation for truncated/incomplete JSON (no LLM retry)
  if (start >= 0) {
    let s = candidate.slice(start);
    // trim trailing whitespace
    s = s.replace(/\s+$/g, '');
    // remove trailing comma before attempting close
    s = s.replace(/,\s*$/g, '');
    // if ends mid-token after ':' or incomplete literal/key, backtrack to a safer boundary
    s = s.replace(/:\s*$/g, ': null').replace(/,\s*"[^"]*$/g, '').replace(/"\s*:\s*"[^"]*$/g, (m) => m); // keep partial string value to be closed
    const closeBalanced = (src: string): string => {
      let inStr = false, esc = false; const stack: string[] = [];
      for (let i = 0; i < src.length; i++) {
        const c = src[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') inStr = true;
        else if (c === '{') stack.push('}');
        else if (c === '[') stack.push(']');
        else if ((c === '}' || c === ']') && stack.length && stack[stack.length - 1] === c) stack.pop();
      }
      let fixed = src;
      if (inStr) { if (fixed.endsWith('\\')) fixed = fixed.slice(0, -1); fixed += '"'; }
      fixed = fixed.replace(/,\s*$/g, '');
      while (stack.length) fixed += stack.pop();
      return fixed;
    };
    // attempt 1: close as-is
    obj = tryParse(closeBalanced(s));
    if (obj) return { obj, repaired: true, parsePath: 'repaired_close' };
    // attempt 2: trim back to last structural boundary then close
    const lastBoundary = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'), s.lastIndexOf('"'));
    if (lastBoundary > 0) {
      let s2 = s.slice(0, lastBoundary + 1).replace(/,\s*$/g, '');
      obj = tryParse(closeBalanced(s2));
      if (obj) return { obj, repaired: true, parsePath: 'repaired_trim_close' };
    }
  }
  return { obj: null, repaired: false, parsePath: 'none' };
}

function normNick(s: string): string { return String(s || '').trim().toLowerCase(); }

const DEFAULT_PARADA: DelegationParada = {
  success: 'Finaliza cuando todos los nodos y subnodos están en estado terminal resuelto (DONE o SKIPPED) y el resultado de la rama se ha entregado al solicitante original.',
  on_failure: 'Si un nodo queda FAILED/BLOCKED irrecuperable, propagar el error y contexto al solicitante original y finalizar la rama; replanificar solo si se solicita explícitamente.',
  assumes_result: false,
};

function canonicalNick(roster: Array<{ nickname: string }>, name: string): string | null {
  const n = normNick(name);
  const found = (roster || []).find((r) => normNick(r.nickname) === n);
  return found ? found.nickname : null;
}

function paradaToText(p: DelegationParada | string | null): string {
  if (!p) return 'Finaliza cuando todos los nodos estén resueltos (DONE/SKIPPED) y el resultado se entregue al solicitante original; si hay fallo/bloqueo irrecuperable, propagar error al solicitante y finalizar (replan solo si se solicita). No asume el valor del resultado.';
  if (typeof p === 'string') return p;
  return `Éxito: ${p.success} Fallo: ${p.on_failure} (assumes_result=false)`;
}

function renderNodes(nodes: DelegationNode[], indent = ''): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    const head = n.delegate_to ? `acción: ${n.action}` : `acción: ${n.action}`;
    out.push(`${indent}${n.id} [PENDING] ${head}`);
    // children are the delegated substeps (owned by delegate_to) – render nested without repeating confusing labels
    if (n.children?.length) out.push(...renderNodes(n.children, indent + '  '));
  }
  return out;
}

function toCanonicalTextV2(nodes: DelegationNode[], parada: DelegationParada | string | null): string {
  return ['PLAN (v2, todos PENDING):', ...renderNodes(nodes), `PARADA: ${paradaToText(parada)}`].join('\n');
}

// v2 only: strict schema/keys, no v1/legacy aliases or formats
function parsePlanV2(obj: any, roster: Array<{ nickname: string }>): { ok: true; nodes: DelegationNode[]; parada: DelegationParada; plan: string } | { ok: false; reason: string } {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'planner_invalid_v2_object' };
  if (obj.schema !== 'v2') return { ok: false, reason: 'planner_v2_required' };
  if (!Array.isArray(obj.nodes)) return { ok: false, reason: 'planner_no_nodes' };

  const validate = (arr: any[], pathPrefix: string, parentDelegateTo: string | null): DelegationNode[] | { err: string } => {
    const out: DelegationNode[] = [];
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i] && typeof arr[i] === 'object' && !Array.isArray(arr[i]) ? arr[i] : {};
      const id = String(s.id || (pathPrefix ? `${pathPrefix}.${i + 1}` : `${i + 1}`)).trim();
      const ownerRaw = String(s.owner ?? '').trim();
      const owner = canonicalNick(roster, ownerRaw);
      if (!owner) return { err: `invalid_node_${id}_owner_not_in_roster:${ownerRaw || '(vacío)'}` };
      if (parentDelegateTo && normNick(owner) !== normNick(parentDelegateTo)) return { err: `invalid_node_${id}_owner_mismatch_parent_delegate:${ownerRaw}` };

      const dtRaw = s.delegate_to;
      let delegate_to: string | null = null;
      if (dtRaw != null && String(dtRaw).trim() !== '' && String(dtRaw).toLowerCase() !== 'null' && String(dtRaw).toLowerCase() !== 'none') {
        const dn = canonicalNick(roster, String(dtRaw));
        if (!dn) return { err: `invalid_node_${id}_delegate_to_not_in_roster:${String(dtRaw)}` };
        delegate_to = dn;
      }

      const action = String(s.action ?? '').trim();
      const deliver_to = String(s.deliver_to ?? 'solicitante').trim() || 'solicitante';
      const stop = String(s.stop ?? '').trim();
      if (!action || !stop) return { err: `invalid_node_${id}_missing_fields` };

      const childrenRaw = Array.isArray(s.children) ? s.children : [];
      let children: DelegationNode[] = [];
      if (childrenRaw.length) {
        const cv = validate(childrenRaw, id, delegate_to || owner);
        if ((cv as any).err) return cv as any;
        children = cv as DelegationNode[];
      }
      out.push({ id, owner, delegate_to, action, deliver_to, stop, status: 'PENDING', children, result_ref: null, result_summary: null, error: null });
    }
    return out;
  };

  const vr = validate(obj.nodes, '', null);
  if ((vr as any).err) return { ok: false, reason: (vr as any).err };
  const nodes = vr as DelegationNode[];
  if (!nodes.length) return { ok: false, reason: 'planner_no_nodes' };

  let parada: DelegationParada = { ...DEFAULT_PARADA };
  const p = obj.parada;
  if (p && typeof p === 'object' && !Array.isArray(p)) {
    parada = {
      success: String((p as any).success || DEFAULT_PARADA.success),
      on_failure: String((p as any).on_failure || DEFAULT_PARADA.on_failure),
      assumes_result: false,
    };
  }
  return { ok: true, nodes, parada, plan: toCanonicalTextV2(nodes, parada) };
}

function parsePlan(text: string, roster: Array<{ nickname: string }>): (DelegationPlanResult & { ok: boolean; repaired?: boolean; parsePath?: string }) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: 'planner_empty_response' };
  const { obj, repaired, parsePath } = extractJsonBlock(raw);
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, reason: 'planner_invalid_json_v2', reason_detail: 'invalid_or_truncated_v2_json', repaired, parsePath };
  }
  const v2 = parsePlanV2(obj, roster);
  if (v2.ok === true) return { ok: true, schema: 'v2', nodes: v2.nodes, parada: v2.parada, plan: v2.plan, repaired, parsePath };
  return { ok: false, reason: v2.reason, reason_detail: v2.reason, repaired, parsePath };
}

@Injectable()
export class DelegationPlannerService {
  constructor(private readonly appSettings: AppSettingsService) {}

  private buildSystemPrompt(rosterText: string, requesterLabel?: string, agentDir?: string): string {
    let skillBody = '';
    try {
      const base = agentDir || (this.appSettings?.defaultPiAgentDir?.() ?? path.join(process.cwd(), 'data', 'pi-agent'));
      const skillPath = path.join(base, 'skills', 'delegation-planning', 'SKILL.md');
      const p = fs.existsSync(skillPath) ? skillPath : FALLBACK_PLANNER_SKILL_PATH;
      skillBody = stripFrontmatter(fs.readFileSync(p, 'utf-8')).trim();
    } catch {
      skillBody = 'Produce a concise delegation tracking plan as a JSON tree (schema v2), all nodes PENDING, no result values in stop/parada.';
    }
    return [
      'You are a delegation planning specialist for a multi-agent hive.',
      'You receive a user request and the available agent roster. Produce ONLY a delegation tracking plan.',
      'Respond with a single COMPLETE JSON object (schema v2), no markdown and no text outside the JSON. If your runtime supports it, you may instead call the tool `submit_delegation_plan` with the same object.',
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

  async planOneShot(input: DelegationPlanInput): Promise<DelegationPlanResult> {
    const { model, runtime, userTask, roster, cwd } = input;
    // Dynamic timeout: extend while model activity is observed (load/processing/stream), up to hardMax.
    const idleTimeoutMs = Math.max(5_000, Math.min(Number(input.idleTimeoutMs ?? input.timeoutMs ?? 45_000), 300_000));
    const hardMaxMs = Math.max(idleTimeoutMs, Math.min(Number(input.hardMaxMs ?? 300_000), 300_000));
    const started = Date.now();
    const requesterLabel = String(input.requesterLabel || 'user/solicitante').trim() || 'user/solicitante';
    const rosterText = (roster || []).map((a) => `- ${a.nickname}${a.role ? ` (${a.role})` : ''}${a.id ? ` id=${a.id}` : ''}`).join('\n');
    let agentDir = path.join(process.cwd(), 'data', 'pi-agent');
    try { agentDir = await this.appSettings.resolvePiAgentDir(); } catch {}
    const systemPrompt = this.buildSystemPrompt(rosterText, requesterLabel, agentDir);

    const sessionManager = SessionManager.inMemory(cwd);
    let session: any;
    let resourceLoader: any;
    let unsubscribe: (() => void) | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let lastActivity = started;
    let firstActivityAt: number | null = null;
    let timedOut: 'idle' | 'max' | false = false;
    const markActivity = () => {
      const now = Date.now();
      if (firstActivityAt == null) firstActivityAt = now;
      lastActivity = now;
    };

    const preview = (s: string, n: number) => {
      const t = String(s || '');
      return t.length > n ? `${t.slice(0, n)}…[+${t.length - n}]` : t;
    };

    const makeDebug = (base: Partial<DelegationPlannerDebug> & { plannerMs: number; extraction: 'lastText' | 'messages' | 'tool_call' | 'none'; outLen: number }): DelegationPlannerDebug => ({
      plannerMs: base.plannerMs,
      firstActivityMs: firstActivityAt ? firstActivityAt - started : null,
      idleTimeoutMs,
      hardMaxMs,
      timedOut,
      extraction: base.extraction,
      outLen: base.outLen,
      outPreviewHead: base.outPreviewHead,
      outPreviewTail: base.outPreviewTail,
      assistantMsgCount: base.assistantMsgCount ?? 0,
      messagesCount: base.messagesCount ?? 0,
      lastAssistantContentTypes: base.lastAssistantContentTypes,
      lastAssistantStopReason: base.lastAssistantStopReason ?? null,
      rosterCount: (roster || []).length,
      userTaskChars: String(userTask || '').length,
      systemPromptChars: String(systemPrompt || '').length,
      repaired: base.repaired,
      parsePath: base.parsePath,
      toolCallUsed: base.toolCallUsed,
      errorName: base.errorName,
      errorStackHead: base.errorStackHead,
    });

    try {
      try {
        resourceLoader = new (DefaultResourceLoader as any)({
          cwd,
          agentDir,
          noSkills: true,
          noExtensions: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          systemPrompt,
        });
      } catch {
        resourceLoader = undefined;
      }

      // Structured submission via tool call (preferred, deterministic) with text fallback
      let submittedPlan: any = null;
      const submitDelegationPlanTool = defineTool({
        name: 'submit_delegation_plan',
        label: 'submit_delegation_plan',
        description: 'Submit the delegation tracking plan (schema v2). Call this with the complete plan object.',
        parameters: Type.Object({
          schema: Type.Literal('v2'),
          solicitante_raiz: Type.String(),
          parada: Type.Object({
            success: Type.String(),
            on_failure: Type.String(),
            assumes_result: Type.Boolean(),
          }),
          nodes: Type.Array(Type.Any()),
        }),
        async execute(_toolCallId: string, args: any) {
          submittedPlan = args;
          return { content: [{ type: 'text', text: 'plan_received' }], details: { ok: true } } as any;
        },
      } as any);

      const sessionOpts: any = {
        sessionManager,
        model,
        modelRuntime: runtime,
        cwd,
        agentDir,
        customTools: [submitDelegationPlanTool],
        tools: ['submit_delegation_plan'],
      };
      if (resourceLoader) sessionOpts.resourceLoader = resourceLoader;

      const created = await createAgentSession(sessionOpts) as any;
      session = created?.session;
      try {
        const ag = session?.agent;
        if (ag) {
          if (typeof ag.setSystemPrompt === 'function') ag.setSystemPrompt(systemPrompt);
          else ag.systemPrompt = systemPrompt;
        }
      } catch {}

      // Observe load/processing/stream activity to extend the idle timeout dynamically.
      try {
        if (typeof session?.subscribe === 'function') {
          unsubscribe = session.subscribe((event: any) => {
            const t = event?.type;
            if (t === 'message_update' && event.assistantMessageEvent) {
              const a = event.assistantMessageEvent?.type;
              if (a === 'text_delta' || a === 'thinking_delta' || a === 'toolcall_start' || a === 'toolcall_end' || a === 'text_end' || a === 'thinking_end') {
                markActivity();
              }
            } else if (t === 'tool_execution_start' || t === 'tool_execution_end' || t === 'tool_call' || t === 'agent_start' || t === 'agent_end' || t === 'message_start' || t === 'message_end' || t === 'turn_start' || t === 'turn_end' || t === 'auto_retry_start' || t === 'auto_retry_end') {
              markActivity();
            }
          });
        }
      } catch {}

      const userMessage = `[CONTEXT]\nSolicitante/origen (NO es un agente del roster, NO usar como owner/delegate_to): ${requesterLabel}\n\n[USER REQUEST]\n${String(userTask || '').trim() || '(vacía)'}\n\n[INSTRUCTION]\nReturn ONLY the JSON object (schema v2) in your reply, with no markdown and no text outside it. If you can call \`submit_delegation_plan\`, you may use it; otherwise reply with the JSON text.\nPlan: {"schema":"v2","solicitante_raiz":"${requesterLabel}","parada":{"success":"todos los nodos/subnodos resueltos (DONE/SKIPPED) y resultado entregado al solicitante original","on_failure":"propagar error/bloqueo irrecuperable al solicitante original y finalizar (replan solo si se solicita)","assumes_result":false},"nodes":[{"id":"1","owner":"nickname_roster","delegate_to":"nickname_roster_o_null","action":"...","deliver_to":"nickname_roster_o_solicitante","stop":"condición de cumplimiento sin valor de resultado","status":"PENDING","children":[]}]} . owner/delegate_to solo nicknames exactos del ROSTER. Todos status PENDING. No asumas ni incluyas valores de resultado; no pre-ejecutes ni afirmes que alguien ya respondió. Si no puedes usar la tool, devuelve SOLO el objeto JSON completo (sin markdown).`;

      const runPromise = session.prompt(userMessage);
      const watchdogPromise = new Promise<never>((_, reject) => {
        watchdog = setInterval(() => {
          const now = Date.now();
          if (now - started >= hardMaxMs) {
            timedOut = 'max';
            reject(new Error(`planner_timeout_max_${hardMaxMs}ms`));
          } else if (now - lastActivity >= idleTimeoutMs) {
            timedOut = 'idle';
            reject(new Error(`planner_timeout_idle_${idleTimeoutMs}ms`));
          }
        }, 1000);
        (watchdog as any)?.unref?.();
      });

      await Promise.race([runPromise, watchdogPromise]);

      const extractAssistantText = (): { text: string; extraction: 'lastText' | 'messages' | 'tool_call' | 'none'; assistantMsgCount: number; messagesCount: number; lastAssistantContentTypes?: string[]; lastAssistantStopReason?: string | null; toolCallObj?: any } => {
        let messagesCount = 0;
        let assistantMsgCount = 0;
        let lastAssistantContentTypes: string[] | undefined;
        let lastAssistantStopReason: string | null = null;
        let msgs: any[] = [];
        try { msgs = typeof session.getMessages === 'function' ? (session.getMessages() || []) : []; } catch {}
        messagesCount = msgs.length;
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m: any = msgs[i];
          if (m?.role === 'assistant') assistantMsgCount++;
        }
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m: any = msgs[i];
          if (m?.role === 'assistant') {
            lastAssistantContentTypes = Array.isArray(m.content) ? m.content.map((p: any) => String(p?.type || typeof p)) : [typeof m.content];
            lastAssistantStopReason = m.stopReason ?? m.stop_reason ?? null;
            break;
          }
        }
        // Prefer structured tool-call submission (deterministic)
        const pickToolArgs = (c: any): any | null => {
          if (!c) return null;
          const name = c.name || c.toolName || c.function?.name;
          if (name !== 'submit_delegation_plan') return null;
          let args = c.arguments ?? c.args ?? c.input ?? c.function?.arguments;
          if (typeof args === 'string') { try { args = JSON.parse(args); } catch {} }
          if (args && typeof args === 'object') {
            if (args.plan && (args.plan.schema === 'v2' || Array.isArray(args.plan.nodes))) return args.plan;
            return args;
          }
          return null;
        };
        try {
          if (submittedPlan && typeof submittedPlan === 'object') {
            const obj = (submittedPlan.plan && (submittedPlan.plan.schema === 'v2' || Array.isArray(submittedPlan.plan.nodes))) ? submittedPlan.plan : submittedPlan;
            return { text: '', extraction: 'tool_call', assistantMsgCount, messagesCount, lastAssistantContentTypes, lastAssistantStopReason, toolCallObj: obj };
          }
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m: any = msgs[i];
            if (m?.role !== 'assistant') continue;
            const c = m.content;
            if (Array.isArray(c)) {
              for (let j = c.length - 1; j >= 0; j--) {
                const p: any = c[j];
                if (p && (p.type === 'toolCall' || p.type === 'tool_call' || p.type === 'functionCall')) {
                  const obj = pickToolArgs(p);
                  if (obj) return { text: '', extraction: 'tool_call', assistantMsgCount, messagesCount, lastAssistantContentTypes, lastAssistantStopReason, toolCallObj: obj };
                }
              }
            }
            const obj = pickToolArgs(m);
            if (obj) return { text: '', extraction: 'tool_call', assistantMsgCount, messagesCount, lastAssistantContentTypes, lastAssistantStopReason, toolCallObj: obj };
          }
        } catch {}
        try {
          const last = typeof session.getLastAssistantText === 'function' ? session.getLastAssistantText() : undefined;
          if (last && String(last).trim()) return { text: String(last), extraction: 'lastText', assistantMsgCount, messagesCount, lastAssistantContentTypes, lastAssistantStopReason };
        } catch {}
        try {
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m: any = msgs[i];
            if (m?.role !== 'assistant') continue;
            const c = m.content;
            if (typeof c === 'string' && c.trim()) return { text: c, extraction: 'messages', assistantMsgCount, messagesCount, lastAssistantContentTypes, lastAssistantStopReason };
            if (Array.isArray(c)) {
              const text = c.filter((p: any) => p && p.type === 'text' && typeof p.text === 'string').map((p: any) => p.text).join('');
              if (text.trim()) return { text, extraction: 'messages', assistantMsgCount, messagesCount, lastAssistantContentTypes, lastAssistantStopReason };
            }
          }
        } catch {}
        return { text: '', extraction: 'none', assistantMsgCount, messagesCount, lastAssistantContentTypes, lastAssistantStopReason };
      };

      const ex = extractAssistantText();
      const out = ex.text;
      const plannerMs = Date.now() - started;
      const firstActivityMs = firstActivityAt ? firstActivityAt - started : null;
      if (ex.extraction === 'tool_call' && ex.toolCallObj) {
        const v2 = parsePlanV2(ex.toolCallObj, roster || []);
        const dbgObj = JSON.stringify(ex.toolCallObj);
        const debug = makeDebug({ plannerMs, extraction: 'tool_call', outLen: dbgObj.length, outPreviewHead: preview(dbgObj, 400), outPreviewTail: dbgObj.length > 200 ? preview(dbgObj.slice(-200), 200) : undefined, assistantMsgCount: ex.assistantMsgCount, messagesCount: ex.messagesCount, lastAssistantContentTypes: ex.lastAssistantContentTypes, lastAssistantStopReason: ex.lastAssistantStopReason, parsePath: 'tool_call', toolCallUsed: true });
        if (!v2.ok) return { ok: false, reason: (v2 as any).reason, reason_detail: (v2 as any).reason, plannerMs, firstActivityMs, debug };
        return { ok: true, schema: 'v2', nodes: (v2 as any).nodes, parada: (v2 as any).parada, plan: (v2 as any).plan, plannerMs, firstActivityMs, debug };
      }
      const baseDebug = { plannerMs, extraction: ex.extraction, outLen: String(out || '').length, outPreviewHead: out ? preview(out, 400) : undefined, outPreviewTail: out && out.length > 200 ? preview(out.slice(-200), 200) : undefined, assistantMsgCount: ex.assistantMsgCount, messagesCount: ex.messagesCount, lastAssistantContentTypes: ex.lastAssistantContentTypes, lastAssistantStopReason: ex.lastAssistantStopReason, toolCallUsed: false };
      if (!out || !String(out).trim()) {
        const reason_detail = ex.assistantMsgCount === 0 ? 'no_assistant_message' : (ex.extraction === 'none' ? 'assistant_no_extractable_text' : 'empty_text');
        return { ok: false, reason: 'planner_empty_response', reason_detail, plannerMs, firstActivityMs, debug: makeDebug(baseDebug) };
      }
      const parsed = parsePlan(String(out), roster || []);
      const debug = makeDebug({ ...baseDebug, repaired: (parsed as any).repaired, parsePath: (parsed as any).parsePath });
      if (!parsed.ok) {
        return { ok: false, reason: (parsed as any).reason, reason_detail: (parsed as any).reason_detail || (parsed as any).reason, plannerMs, firstActivityMs, debug };
      }
      return { ok: true, schema: 'v2', plan: (parsed as any).plan, nodes: (parsed as any).nodes, parada: (parsed as any).parada, plannerMs, firstActivityMs, debug };
    } catch (e: any) {
      try { if (session?.abort) await session.abort().catch?.(() => {}); } catch {}
      const plannerMs = Date.now() - started;
      const msg = e?.message || String(e);
      const reason = (typeof msg === 'string' && msg.startsWith('planner_timeout_')) ? msg : `planner_error: ${msg}`;
      return { ok: false, reason, reason_detail: timedOut ? `timed_out_${timedOut}` : 'exception', plannerMs, firstActivityMs: firstActivityAt ? firstActivityAt - started : null, debug: makeDebug({ plannerMs, extraction: 'none', outLen: 0, errorName: e?.name || 'Error', errorStackHead: preview(String(e?.stack || msg), 300) }) };
    } finally {
      try { if (watchdog) clearInterval(watchdog); } catch {}
      try { if (unsubscribe) unsubscribe(); } catch {}
      try { if (session?.dispose) session.dispose(); } catch {}
    }
  }
}
