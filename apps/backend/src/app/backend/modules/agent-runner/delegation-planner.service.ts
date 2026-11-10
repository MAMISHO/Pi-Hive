import { Injectable } from '@nestjs/common';
import { createAgentSession, SessionManager, DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import * as fs from 'fs';
import * as path from 'path';
import type { DelegationStep } from './delegation-plan.store.js';

const PLANNER_SKILL_PATH = path.join(process.cwd(), 'data', 'pi-agent', 'skills', 'delegation-planning', 'SKILL.md');

export interface DelegationPlanInput {
  model: any;
  runtime: any;
  userTask: string;
  roster: Array<{ nickname: string; role?: string; id?: string }>;
  cwd: string;
  timeoutMs?: number;
}

export interface DelegationPlanResult {
  ok: boolean;
  plan?: string; // canonical text (PLAN/PARADA)
  steps?: DelegationStep[];
  parada?: string | null;
  reason?: string;
  plannerMs?: number;
}

function stripFrontmatter(content: string): string {
  const m = content.match(/^---\s*[\s\S]*?\s*---\s*/);
  return m ? content.slice(m[0].length) : content;
}

function extractJsonBlock(text: string): any | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text.trim();
  try { return JSON.parse(candidate); } catch {}
  // try to find first {...} block
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch {}
  }
  return null;
}

function normNick(s: string): string { return String(s || '').trim().toLowerCase(); }

function toCanonicalText(steps: DelegationStep[], parada: string | null): string {
  const lines = steps.map((s, i) => `${i + 1}. destino=${s.destino} | acción=${s.accion} | entrega=${s.entrega} | stop=${s.stop}`);
  return `PLAN:\n${lines.join('\n')}\nPARADA: ${parada || '(según stop de pasos)'}`;
}

function parsePlan(text: string, roster: Array<{ nickname: string }>): { ok: true; steps: DelegationStep[]; parada: string | null; plan: string } | { ok: false; reason: string } {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: 'planner_empty_response' };
  const allowed = new Set((roster || []).map((r) => normNick(r.nickname)).filter(Boolean));
  const obj = extractJsonBlock(raw);
  let steps: DelegationStep[] = [];
  let parada: string | null = null;

  if (obj && (Array.isArray(obj.steps) || Array.isArray(obj.plan))) {
    const arr: any[] = Array.isArray(obj.steps) ? obj.steps : obj.plan;
    parada = (obj.parada ?? obj.stop ?? obj.PARADA ?? null) as any;
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i] || {};
      const destino = String(s.destino ?? s.target ?? s.to ?? s.agent ?? '').trim();
      const accion = String(s.accion ?? s.action ?? s.task ?? s.instruction ?? '').trim();
      const entrega = String(s.entrega ?? s.deliver_to ?? s.return_to ?? s.report_to ?? '').trim();
      const stop = String(s.stop ?? s.halt ?? s.condicion ?? s.condition ?? '').trim();
      if (!destino || !accion || !entrega || !stop) return { ok: false, reason: `invalid_step_${i + 1}_missing_fields` };
      if (allowed.size && !allowed.has(normNick(destino))) return { ok: false, reason: `invalid_step_${i + 1}_destino_not_in_roster:${destino}` };
      steps.push({ id: i + 1, destino, accion, entrega, stop, status: i === 0 ? 'active' : 'pending' });
    }
  } else {
    // fallback: parse text lines "1. destino=... | acción=... | entrega=... | stop=..."
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/^\d+\.\s*(.+)$/);
      if (!m) continue;
      const body = m[1];
      const parts = body.split('|').map((p) => p.trim());
      const kv: Record<string, string> = {};
      for (const p of parts) {
        const idx = p.indexOf('=');
        if (idx > 0) kv[normNick(p.slice(0, idx))] = p.slice(idx + 1).trim();
      }
      const destino = String(kv['destino'] || kv['target'] || '').trim();
      const accion = String(kv['acción'] || kv['accion'] || kv['action'] || '').trim();
      const entrega = String(kv['entrega'] || kv['deliver_to'] || kv['report_to'] || '').trim();
      const stop = String(kv['stop'] || kv['condicion'] || kv['condition'] || '').trim();
      if (!destino || !accion || !entrega || !stop) return { ok: false, reason: 'invalid_text_step_missing_fields' };
      if (allowed.size && !allowed.has(normNick(destino))) return { ok: false, reason: `invalid_text_step_destino_not_in_roster:${destino}` };
      steps.push({ id: steps.length + 1, destino, accion, entrega, stop, status: steps.length === 0 ? 'active' : 'pending' });
    }
    const pm = raw.match(/(?:^|\n)\s*PARADA\s*:\s*(.+)$/i);
    if (pm) parada = pm[1].trim();
  }

  if (!steps.length) return { ok: false, reason: 'planner_no_steps' };
  if (!parada) {
    const last = steps[steps.length - 1];
    parada = last.stop || 'Entregar resultado final al solicitante cuando se cumpla el último paso.';
  }
  return { ok: true, steps, parada, plan: toCanonicalText(steps, parada) };
}

@Injectable()
export class DelegationPlannerService {
  private buildSystemPrompt(rosterText: string): string {
    let skillBody = '';
    try {
      skillBody = stripFrontmatter(fs.readFileSync(PLANNER_SKILL_PATH, 'utf-8')).trim();
    } catch {
      skillBody = 'Produce a concise delegation tracking plan.';
    }
    return [
      'You are a delegation planning specialist for a multi-agent hive.',
      'You receive a user request and the available agent roster. Produce ONLY a delegation tracking plan.',
      'Output MUST be valid JSON (no markdown, no preamble) with shape: {"steps":[{"destino":"<nickname>","accion":"...","entrega":"<nickname|solicitante>","stop":"..."}],"parada":"..."}',
      'Use only exact nicknames from the roster for destino. Do not invent agents. Preserve the chain requested by the user (keep intermediaries; do not shortcut).',
      'Do not explore the environment, files, or code. `branch`/`depth`/`request`/`origin` are chain metadata, never filesystem paths.',
      '',
      '[ROSTER]',
      rosterText || '(sin otros agentes registrados)',
      '',
      '[SKILL-REFERENCE]',
      skillBody,
    ].join('\n');
  }

  async planOneShot(input: DelegationPlanInput): Promise<DelegationPlanResult> {
    const { model, runtime, userTask, roster, cwd } = input;
    const timeoutMs = Math.max(5_000, Math.min(Number(input.timeoutMs || 45_000), 120_000));
    const started = Date.now();
    const rosterText = (roster || []).map((a) => `- ${a.nickname}${a.role ? ` (${a.role})` : ''}${a.id ? ` id=${a.id}` : ''}`).join('\n');
    const systemPrompt = this.buildSystemPrompt(rosterText);

    const sessionManager = SessionManager.inMemory(cwd);
    let session: any;
    let resourceLoader: any;
    const agentDir = path.join(process.cwd(), 'data', 'pi-agent');

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

      const sessionOpts: any = {
        sessionManager,
        model,
        modelRuntime: runtime,
        cwd,
        agentDir,
        tools: [],
        noTools: 'all',
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

      const userMessage = `[USER REQUEST]\n${String(userTask || '').trim() || '(vacía)'}\n\n[INSTRUCTION]\nDevuelve únicamente JSON válido con el tracking: {"steps":[{"destino":"nickname_exacto","accion":"...","entrega":"...","stop":"..."}],"parada":"..."}. Sin texto extra.`;
      const run = session.prompt(userMessage);
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`planner_timeout_${timeoutMs}ms`)), timeoutMs));
      await Promise.race([run, timeout]);

      const out = typeof session.getLastAssistantText === 'function' ? session.getLastAssistantText() : undefined;
      const parsed = parsePlan(String(out || ''), roster || []);
      if (parsed.ok === false) return { ok: false, reason: parsed.reason, plannerMs: Date.now() - started };
      return { ok: true, plan: parsed.plan, steps: parsed.steps, parada: parsed.parada, plannerMs: Date.now() - started };
    } catch (e: any) {
      return { ok: false, reason: `planner_error: ${e?.message || String(e)}`, plannerMs: Date.now() - started };
    } finally {
      try { if (session?.dispose) session.dispose(); } catch {}
    }
  }
}
