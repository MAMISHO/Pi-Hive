import type { ITaskQueue } from '../task-queue/domain/models/task-queue.interface.js';

/** The direct request being resumed is authoritative; inherited callback context is older. */
export function stripDelegationEnvelope(value: string): string {
  return String(value || '').replace(/^\[DELEGATION[^\]]*\]\s*/i, '').trim();
}

export function selectCallbackInstruction(origin: Partial<ITaskQueue> | null, task: Partial<ITaskQueue>): string {
  const selected = String(origin?.payload ?? task.callback_context ?? (origin as any)?.callback_context ?? task.payload ?? '');
  return stripDelegationEnvelope(selected);
}

/** Progress callbacks are status events; never forward model narration as branch state. */
export function formatDelegationProgressSummary(targetNickname?: string | null, taskId?: number | null): string {
  const target = String(targetNickname || '').trim();
  const task = Number.isFinite(Number(taskId)) && Number(taskId) > 0 ? ` (task #${Number(taskId)})` : '';
  return target
    ? `Subdelegación registrada a ${target}${task}; esperando el resultado final.`
    : 'Subdelegación registrada; esperando el resultado final.';
}

/** A planner may assign local steps to its caller, but only active workspace agents may own/delegate nodes. */
export function buildPlannerRoster(
  current: { id: string; nickname: string; role?: string },
  activeAgents: Array<{ id: string; nickname: string; role?: string }>,
): Array<{ id: string; nickname: string; role?: string }> {
  const byId = new Map<string, { id: string; nickname: string; role?: string }>();
  for (const agent of activeAgents || []) {
    if (agent?.id && agent?.nickname) byId.set(String(agent.id), { id: String(agent.id), nickname: agent.nickname, role: agent.role });
  }
  if (current?.id && current.nickname) byId.set(String(current.id), { id: String(current.id), nickname: current.nickname, role: current.role });
  return [...byId.values()];
}

/** Expose all Pi-provided tools to every agent/session (no flow/role/task gating). */
export function allowedToolsForTaskFlow(_flow?: string | null, _role?: string | null, _planningAllowed = true, _terminalWorkerResult = false): string[] {
  return ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls', 'delegate_task', 'plan_delegation'];
}

/** Planning remains available in all sessions. */
export function canPlanDelegation(_input: { flow?: string | null; planState?: string | null; explicitlyAddressedRecipient?: boolean }): boolean {
  return true;
}

/** Resolve an explicitly addressed recipient from the active roster, without an LLM. */
export function explicitRecipientFromRequest(payload: string, roster: Array<{ nickname: string }>): string | null {
  const normalize = (value: string) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const text = normalize(payload);
  for (const agent of roster || []) {
    const nickname = normalize(agent.nickname).trim();
    if (!nickname) continue;
    const escaped = nickname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const es = new RegExp(`\\b(?:dile|diles|encarga(?:le)?|asigna(?:le)?|pide(?:le)?|ordena(?:le)?)\\s+a\\s+${escaped}\\b`);
    const en = new RegExp(`\\b(?:tell|ask|assign|instruct)\\s+${escaped}\\b`);
    if (es.test(text) || en.test(text)) return agent.nickname;
  }
  return null;
}
