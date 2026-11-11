import { Injectable } from '@nestjs/common';
import { DelegationPlanEntity } from './infra/persistence/sequalize/entities/delegation-plan.schema.js';

// ---- v2 (tree) ----
export type PlanNodeStatus = 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'BLOCKED' | 'SKIPPED';

export interface DelegationNode {
  id: string; // hierarchical, e.g. "1", "1.1"
  owner: string; // nickname (roster) responsible for this node
  delegate_to: string | null; // roster nickname to delegate to, or null for local action
  action: string;
  deliver_to: string; // nickname or requester label (e.g. user/solicitante) for result delivery
  stop: string; // completion condition (no result values)
  status: PlanNodeStatus;
  result_ref?: number | null;
  result_summary?: string | null;
  error?: string | null;
  children?: DelegationNode[];
}

export interface DelegationParada {
  success: string;
  on_failure: string;
  assumes_result: false;
}

export interface DelegationPlanState {
  plan_ref: number;
  root_task_id: number;
  workspace_id: string | null;
  owner_agent_id: string;
  requester: string | null;
  raw_text: string;
  schema: 'v2';
  nodes: DelegationNode[];
  parada: DelegationParada | string | null;
  cursor: number; // kept for DB compat, unused in v2
  state: 'active' | 'done' | 'aborted' | 'failed';
}

function norm(s: any): string { return String(s || '').trim().toLowerCase(); }

function isTerminal(s: PlanNodeStatus | string | undefined): boolean {
  const v = String(s || '').toUpperCase();
  return v === 'DONE' || v === 'SKIPPED' || v === 'FAILED' || v === 'BLOCKED';
}

function paradaToText(p: DelegationParada | string | null | undefined): string {
  if (!p) return 'Finaliza cuando todos los nodos/subnodos están resueltos (DONE/SKIPPED) y el resultado se entrega al solicitante original; si hay fallo/bloqueo irrecuperable, propagar error al solicitante y finalizar (replan solo si se solicita explícitamente). No presupone el valor del resultado.';
  if (typeof p === 'string') return p;
  return `Éxito: ${p.success} | Fallo: ${p.on_failure} | assumes_result=false`;
}

@Injectable()
export class DelegationPlanStore {
  async create(plan: { plan_ref: number; root_task_id: number; workspace_id: string | null; owner_agent_id: string; requester: string | null; raw_text: string; schema: 'v2'; nodes: DelegationNode[]; parada: DelegationParada | string | null; cursor?: number; state: 'active' | 'done' | 'aborted' | 'failed' }): Promise<void> {
    const payload = { schema: 'v2', nodes: plan.nodes || [] };
    const existing = await DelegationPlanEntity.findByPk(plan.plan_ref).catch(() => null);
    if (existing) {
      // upsert: replace any legacy/incompatible plan (v1 is discarded) so regeneration persists
      (existing as any).root_task_id = plan.root_task_id;
      (existing as any).workspace_id = plan.workspace_id ?? null;
      (existing as any).owner_agent_id = plan.owner_agent_id;
      (existing as any).requester = plan.requester ?? null;
      (existing as any).raw_text = plan.raw_text;
      (existing as any).steps_json = JSON.stringify(payload);
      (existing as any).parada = typeof plan.parada === 'string' ? plan.parada : (plan.parada ? JSON.stringify(plan.parada) : null);
      (existing as any).cursor = plan.cursor ?? 0;
      (existing as any).state = plan.state || 'active';
      (existing as any).updated_at = new Date();
      await existing.save().catch(() => {});
      return;
    }
    await DelegationPlanEntity.create({
      plan_ref: plan.plan_ref,
      root_task_id: plan.root_task_id,
      workspace_id: plan.workspace_id ?? null,
      owner_agent_id: plan.owner_agent_id,
      requester: plan.requester ?? null,
      raw_text: plan.raw_text,
      steps_json: JSON.stringify(payload),
      parada: typeof plan.parada === 'string' ? plan.parada : (plan.parada ? JSON.stringify(plan.parada) : null),
      cursor: plan.cursor ?? 0,
      state: plan.state || 'active',
      created_at: new Date(),
      updated_at: new Date(),
    } as any);
  }

  async get(planRef: number | null | undefined): Promise<DelegationPlanState | null> {
    if (planRef == null) return null;
    const row = await DelegationPlanEntity.findByPk(Number(planRef)).catch(() => null);
    if (!row) return null;
    let parsed: any = null;
    try { parsed = JSON.parse((row as any).steps_json || 'null'); } catch { parsed = null; }
    const isV2 = parsed && !Array.isArray(parsed) && (parsed.schema === 'v2' || Array.isArray(parsed.nodes));
    if (!isV2) return null; // v1/legacy discarded
    const nodes: DelegationNode[] = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    let parada: string | DelegationParada | null = (row as any).parada ?? null;
    if (typeof parada === 'string') {
      const t = parada.trim();
      if (t.startsWith('{')) { try { parada = JSON.parse(t); } catch {} }
    }
    return {
      plan_ref: Number((row as any).plan_ref),
      root_task_id: Number((row as any).root_task_id),
      workspace_id: (row as any).workspace_id ?? null,
      owner_agent_id: (row as any).owner_agent_id,
      requester: (row as any).requester ?? null,
      raw_text: (row as any).raw_text || '',
      schema: 'v2',
      nodes,
      parada,
      cursor: Number((row as any).cursor ?? 0),
      state: ((row as any).state || 'active') as any,
    };
  }

  async save(plan: DelegationPlanState): Promise<void> {
    const row = await DelegationPlanEntity.findByPk(plan.plan_ref).catch(() => null);
    if (!row) return;
    const payload = { schema: 'v2', nodes: plan.nodes || [] };
    (row as any).steps_json = JSON.stringify(payload);
    (row as any).cursor = plan.cursor ?? 0;
    (row as any).state = plan.state;
    (row as any).parada = typeof plan.parada === 'string' ? plan.parada : (plan.parada ? JSON.stringify(plan.parada) : null);
    (row as any).raw_text = plan.raw_text;
    (row as any).updated_at = new Date();
    await row.save().catch(() => {});
  }

  // ---- v2 helpers ----
  findNode(nodes: DelegationNode[] | undefined, id: string): DelegationNode | null {
    if (!nodes) return null;
    for (const n of nodes) {
      if (String(n.id) === String(id)) return n;
      const c = this.findNode(n.children, id);
      if (c) return c;
    }
    return null;
  }

  // Find first actionable pending node for owner within the given slice/root (deterministic, DFS order)
  findFirstPendingOwned(nodes: DelegationNode[] | undefined, ownerNickname: string): DelegationNode | null {
    if (!nodes) return null;
    for (const n of nodes) {
      if (isTerminal(n.status)) continue;
      if (norm(n.owner) === norm(ownerNickname) && n.status === 'PENDING') return n;
      // if this node is owned by someone else but pending, do not descend into foreign subtree for this owner
      if (norm(n.owner) !== norm(ownerNickname)) continue;
      const c = this.findFirstPendingOwned(n.children, ownerNickname);
      if (c) return c;
    }
    return null;
  }

  // Collect top-level pending nodes owned by agent in a given node list (its direct responsibilities)
  collectOwnedPending(nodes: DelegationNode[] | undefined, ownerNickname: string, acc: DelegationNode[] = []): DelegationNode[] {
    if (!nodes) return acc;
    for (const n of nodes) {
      if (norm(n.owner) === norm(ownerNickname)) {
        if (!isTerminal(n.status)) acc.push(n);
        // do not descend past ownership boundary except not needed; children of owned node belong to delegated owners
      } else {
        this.collectOwnedPending(n.children, ownerNickname, acc);
      }
    }
    return acc;
  }

  // Render subplan nested inside a node (children) for transmission when delegating (minimal, no owner/delivery noise)
  private renderSubplan(nodes: DelegationNode[] | undefined, indent = ''): string[] {
    if (!nodes || !nodes.length) return [];
    const out: string[] = [];
    for (const n of nodes) {
      const st = `[${String(n.status || 'PENDING').toUpperCase()}]`;
      out.push(`${indent}${n.id} ${st} acción: ${n.action}`);
      if (n.children && n.children.length) out.push(...this.renderSubplan(n.children, indent + '  '));
    }
    return out;
  }

  // Deterministic per-agent slice: only this agent's actionable list
  formatForAgent(plan: DelegationPlanState, agentNickname: string, _depth = 0): string {
    const paradaText = paradaToText(plan.parada);
    if (plan.state !== 'active') {
      return `[DELEGATION PLAN · plan_ref=${plan.plan_ref} · state=${plan.state}]\nPARADA: ${paradaText}`;
    }
    const owned = this.collectOwnedPending(plan.nodes, agentNickname, []);
    if (!owned.length) {
      return `[DELEGATION PLAN · plan_ref=${plan.plan_ref} · state=${plan.state}]\nSin tareas pendientes en tu tramo.\nPARADA: ${paradaText}`;
    }
    const lines: string[] = [];
    for (const n of owned) {
      const st = `[${String(n.status || 'PENDING').toUpperCase()}]`;
      lines.push(`${n.id} ${st} acción: ${n.action}`);
      if (n.delegate_to && n.children && n.children.length) {
        lines.push(`  Subtareas delegadas:`);
        lines.push(...this.renderSubplan(n.children, '    '));
      }
      if (n.result_ref) lines.push(`  resultado: #${n.result_ref}`);
      if (n.error) lines.push(`  error: ${n.error}`);
    }
    return [
      `[DELEGATION PLAN · plan_ref=${plan.plan_ref} · state=${plan.state}]`,
      'Tus tareas (ejecuta en orden, la primera pendiente):',
      ...lines,
      `PARADA: ${paradaText}`,
      'Regla: ejecuta solo tus tareas en orden. Si una tarea implica delegar a otro agente, delega SOLO el sub-tramo del receptor (nodo hijo) reescrito en segunda persona: su acción, entrada y entrega; NO copies el plan completo ni pasos de otros. Si es acción propia, ejecútala y entrega el resultado. Al recibir [DELEGATION RESULT|FINAL] integra el dato y completa la tarea; si hay fallo/bloqueo irrecuperable propaga el error al solicitante. No explores filesystem/código ni trates branch/depth/path como rutas. No repitas tareas resueltas.',
    ].join('\n');
  }

  // Global view (audit)
  formatForPrompt(plan: DelegationPlanState): string {
    const paradaText = paradaToText(plan.parada);
    const render = (nodes: DelegationNode[] | undefined, indent = ''): string[] => {
      if (!nodes) return [];
      const out: string[] = [];
      for (const n of nodes) {
        const st = `[${String(n.status || 'PENDING').toUpperCase()}]`;
        out.push(`${indent}${n.id} ${st} acción: ${n.action}${n.result_ref ? ` | resultado=#${n.result_ref}` : ''}${n.error ? ` | error=${n.error}` : ''}`);
        if (n.children?.length) out.push(...render(n.children, indent + '  '));
      }
      return out;
    };
    return [`[DELEGATION PLAN · plan_ref=${plan.plan_ref} · state=${plan.state}]`, `Solicitante/origen: ${plan.requester || 'solicitante'}.`, ...render(plan.nodes), `PARADA: ${paradaText}`].join('\n');
  }
}

