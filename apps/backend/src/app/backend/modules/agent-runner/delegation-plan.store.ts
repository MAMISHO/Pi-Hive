import { Injectable } from '@nestjs/common';
import { DelegationPlanEntity } from './infra/persistence/sequalize/entities/delegation-plan.schema.js';

export interface DelegationStep {
  id: number;
  destino: string;
  accion: string;
  entrega: string;
  stop: string;
  status: 'pending' | 'active' | 'done' | 'skipped';
  result_ref?: number | null;
}

export interface DelegationPlanState {
  plan_ref: number;
  root_task_id: number;
  workspace_id: string | null;
  owner_agent_id: string;
  requester: string | null;
  raw_text: string;
  steps: DelegationStep[];
  parada: string | null;
  cursor: number;
  state: 'active' | 'done' | 'aborted';
}

@Injectable()
export class DelegationPlanStore {
  async create(plan: Omit<DelegationPlanState, 'steps'> & { steps: DelegationStep[] }): Promise<void> {
    const existing = await DelegationPlanEntity.findByPk(plan.plan_ref).catch(() => null);
    if (existing) return; // idempotent per plan_ref
    await DelegationPlanEntity.create({
      plan_ref: plan.plan_ref,
      root_task_id: plan.root_task_id,
      workspace_id: plan.workspace_id ?? null,
      owner_agent_id: plan.owner_agent_id,
      requester: plan.requester ?? null,
      raw_text: plan.raw_text,
      steps_json: JSON.stringify(plan.steps || []),
      parada: plan.parada ?? null,
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
    let steps: DelegationStep[] = [];
    try { steps = JSON.parse((row as any).steps_json || '[]'); } catch { steps = []; }
    return {
      plan_ref: Number((row as any).plan_ref),
      root_task_id: Number((row as any).root_task_id),
      workspace_id: (row as any).workspace_id ?? null,
      owner_agent_id: (row as any).owner_agent_id,
      requester: (row as any).requester ?? null,
      raw_text: (row as any).raw_text || '',
      steps,
      parada: (row as any).parada ?? null,
      cursor: Number((row as any).cursor ?? 0),
      state: ((row as any).state || 'active') as any,
    };
  }

  async save(plan: DelegationPlanState): Promise<void> {
    const row = await DelegationPlanEntity.findByPk(plan.plan_ref).catch(() => null);
    if (!row) return;
    (row as any).steps_json = JSON.stringify(plan.steps || []);
    (row as any).cursor = plan.cursor;
    (row as any).state = plan.state;
    (row as any).parada = plan.parada ?? null;
    (row as any).raw_text = plan.raw_text;
    (row as any).updated_at = new Date();
    await row.save().catch(() => {});
  }

  formatForPrompt(plan: DelegationPlanState): string {
    const steps = plan.steps || [];
    const cur = Math.max(0, Math.min(plan.cursor, Math.max(steps.length - 1, 0)));
    const current = steps[cur];
    const next = steps[cur + 1];
    const lines = steps.map((s, i) => {
      const mark = i < cur ? '[done]' : i === cur ? '[current]' : '[pending]';
      return `${i + 1}. ${mark} destino=${s.destino} | acción=${s.accion} | entrega=${s.entrega} | stop=${s.stop}${s.result_ref ? ` | result_ref=#${s.result_ref}` : ''}`;
    });
    const action = plan.state !== 'active' || !current
      ? `Plan ${plan.state}.`
      : `Paso actual (${cur + 1}/${steps.length}): destino=${current.destino}, entrega=${current.entrega}, stop=${current.stop}.`;
    const nextAction = !current
      ? 'No hay pasos.'
      : current.stop?.toLowerCase().includes('final') || !next
        ? 'Si el paso actual está resuelto/cumple PARADA: sintetiza y entrega el resultado final al solicitante original. No delegues más ni explores.'
        : `Siguiente paso permitido tras completar el actual: ${cur + 2}. destino=${next.destino} (respeta intermediarios; no acortes la cadena).`;
    return [
      `[DELEGATION TRACKING · plan_ref=${plan.plan_ref} · state=${plan.state} · cursor=${cur + 1}/${steps.length || 0}]`,
      `Solicitante/origen: ${plan.requester || 'desconocido'}. request/origin=#${plan.root_task_id}.`,
      'Pasos:',
      ...(lines.length ? lines : ['- (sin pasos estructurados)']),
      `PARADA: ${plan.parada || '(según stop de pasos)'}`,
      `Acción ahora: ${action}`,
      `Regla: ejecuta SOLO el paso actual; al recibir [DELEGATION RESULT|state=FINAL] integra el dato en el paso actual, avanza y ejecuta el siguiente; no explores filesystem/código/entorno ni trates branch/depth/path como rutas. No re-delegues pasos done ni replanifiques.`,
      nextAction,
    ].join('\n');
  }
}
