import { PromptBuilderService } from './prompt-builder.service.js';
import { allowedToolsForTaskFlow, buildPlannerRoster, canPlanDelegation, explicitRecipientFromRequest, formatDelegationProgressSummary, selectCallbackInstruction } from './delegation-runtime-policy.js';
import { DelegationPlanStore, type DelegationNode } from './delegation-plan.store.js';

const agent: any = { id: 'chief-id', nickname: 'Chief-X', role: 'CHIEF', workspace_id: 'ws', additional_instruction: 'Una sola vez' };
const worker: any = { id: 'worker-id', nickname: 'Alias-Now', role: 'WORKER', workspace_id: 'ws', archived_at: null };

describe('PromptBuilderService migration prompt layers', () => {
  let builder: PromptBuilderService;
  beforeEach(() => {
    builder = new PromptBuilderService({ get: async () => ({ id: 'ws', name: 'landing-template-harness', path: '/tmp/landing-template-harness', role_bindings: '{"orchestration":"worker-id","harness_engineering":"missing"}' } as any) } as any,
      { systemDefaultContent: '[BASE] rule', chiefDefaultContent: '[CHIEF] rule', renderChief: (content: string) => content, renderWorkerCoordination: () => '[ROLE] rule' } as any);
    jest.spyOn((builder as any), 'resolveSystemPrompt').mockResolvedValue('[BASE] rule');
  });

  it('composes workspace binding, current alias and additional instruction without embedding unrelated data', async () => {
    const prompt = await builder.buildSystem({ agent, team: [agent, worker] });
    expect(prompt).toContain('orchestration → Alias-Now');
    expect(prompt).not.toContain('harness_engineering →');
    expect(prompt.match(/Una sola vez/g)).toHaveLength(1);
    expect(prompt).toContain('orchestration → Alias-Now');
  });

  it('includes concise external memory guidance only when effective', async () => {
    const without = await builder.buildSystem({ agent, team: [agent, worker], memoryEffective: false });
    const withMem = await builder.buildSystem({ agent, team: [agent, worker], memoryEffective: true });
    expect(without).not.toContain('Nexo-Palace');
    expect(withMem).toContain('MEMORIA EXTERNA · Nexo-Palace');
    expect(withMem).toContain('tools MCP de Pi');
  });

  it('keeps invalid/absent bindings compatible and rejects agents from other workspaces', () => {
    const resolve = (builder as any).resolveRoleBindings.bind(builder);
    expect(resolve({ role_bindings: '{broken' } as any, [worker], 'ws')).toContain('sin bindings válidos');
    expect(resolve({ role_bindings: '{"ux_ui":"worker-id"}' } as any, [{ ...worker, workspace_id: 'other' }], 'ws')).toContain('sin bindings válidos');
  });

  it('uses compact progress and final callback deltas and estimates each section', async () => {
    const progress = await builder.build({ agent, team: [agent, worker], taskPayload: 'avance', isResumed: true, isDelegationProgress: true, callbackContext: 'full old plan' });
    const final = await builder.build({ agent, team: [agent, worker], taskPayload: 'resultado', isResumed: true, isDelegationResult: true, callbackContext: 'instrucción activa', origin: { nickname: 'User', rootUserPayload: 'objetivo raíz largo' } });
    expect(progress).toContain('espera RESULT final');
    expect(progress).not.toContain('full old plan');
    expect(final).toContain('instrucción activa');
    expect(final).not.toContain('objetivo raíz largo');
    const stats = builder.promptStats({ system: 'abcd', turn: 'abc' });
    expect(stats).toEqual({ system: { chars: 4, estimatedTokens: 1 }, turn: { chars: 3, estimatedTokens: 1 } });
  });

  it('resolves a roleKey to the active workspace agent and tolerates renamed aliases', async () => {
    const result = await builder.buildSystem({ agent, team: [agent, worker] });
    expect(result).toContain('orchestration → Alias-Now');
    const invalid = (builder as any).resolveRoleBindings({ role_bindings: '{"orchestration":"worker-id"}' }, [{ ...worker, archived_at: new Date() }], 'ws');
    expect(invalid).toContain('sin bindings válidos');
  });

  it('makes a callback length retry decisive without reopening the root objective', () => {
    const nudge = builder.buildLengthRetryNudge({ agent: worker, isDelegationResult: true, callbackContext: 'dile a Pam que diga ping y tráeme su pong', taskPayload: '[RESULT] Pam dijo ping' });
    expect(nudge).toContain('Instrucción activa: dile a Pam que diga ping y tráeme su pong');
    expect(nudge).toContain('Resultado recibido: [RESULT] Pam dijo ping');
    expect(nudge).toContain('No reinterpretes el objetivo raíz');
    expect(nudge).not.toContain('plan_delegation');
  });

  it('keeps a root final-result retry from reopening the delegation', () => {
    const nudge = builder.buildLengthRetryNudge({ agent, isDelegationResult: true, isRootUserCallback: true, isRootFinalCallback: true,
      callbackContext: 'Ask Pam what 2+2 is, add 100.', taskPayload: '[RESULT] Bob returned 104.' });
    expect(nudge).toContain('La rama delegada cerró, no necesariamente la solicitud raíz');
    expect(nudge).toContain('No repitas pasos');
  });

  it('routes a root callback with its active instruction and permits in-scope verification', async () => {
    const final = await builder.build({ agent, team: [agent, worker], taskPayload: '[RESULT] Pam respondió pong', isResumed: true,
      isDelegationResult: true, isRootUserCallback: true, callbackContext: 'Continúa la prueba: Bob pide ping a Pam; trae el pong y entrégamelo.' });
    expect(final).toContain('[RESULT CALLBACK en raíz]');
    expect(final).toContain('responde al usuario');
    expect(final).toContain('verifica la evidencia');
    expect(final).toContain('Pam respondió pong');
    expect(final).not.toContain('OBJETIVO RAÍZ');
  });

  it('treats a root final callback as branch closure and retains audit/remediation context', async () => {
    const final = await builder.build({ agent, team: [agent, worker], taskPayload: '[RESULT] Bob asked Pam, added 100, and returned 104.',
      isResumed: true, isDelegationResult: true, isRootUserCallback: true, isRootFinalCallback: true,
      callbackContext: '[DELEGATION | from=Chief | to=Bob]\nAsk Pam what 2+2 is, add 100, and return the result.',
      sender: { nickname: 'Bob', role: 'WORKER' } });
    expect(final).toContain('[RESULT FINAL DE RAMA, no de la solicitud raíz]');
    expect(final).toContain('si hay un requisito concreto incumplido o un defecto verificable');
    expect(final).toContain('delega únicamente esa reparación al responsable de esta rama (Bob)');
    expect(final).toContain('Ask Pam what 2+2 is');
    expect(final).not.toContain('[DELEGATION |');
  });

  it('offers planning after a result only for an unplanned remaining subchain', async () => {
    const callback = await builder.build({ agent: worker, team: [agent, worker], taskPayload: '[RESULT] subtask completed',
      isResumed: true, isDelegationResult: true, callbackContext: 'Complete the remaining workflow.' });
    expect(callback).toContain('solo ese tramo pendiente');
    expect(allowedToolsForTaskFlow('delegation_result', 'WORKER', true)).toContain('plan_delegation');
    expect(allowedToolsForTaskFlow('delegation_result', 'WORKER', false)).not.toContain('plan_delegation');
    expect(allowedToolsForTaskFlow('delegation_result', 'WORKER', false, true)).toEqual([]);
    expect(allowedToolsForTaskFlow('delegation_result', 'CHIEF', false, true)).toEqual(['read', 'delegate_task']);
  });

  it('does not reopen a route that already reached a terminal state', () => {
    expect(canPlanDelegation({ flow: 'delegation_result', planState: null })).toBe(true);
    expect(canPlanDelegation({ flow: 'delegation_result', planState: 'active' })).toBe(false);
    expect(canPlanDelegation({ flow: 'delegation_result', planState: 'done' })).toBe(false);
    expect(canPlanDelegation({ flow: 'delegation_progress', planState: null })).toBe(false);
    expect(canPlanDelegation({ flow: 'direct', planState: null, explicitlyAddressedRecipient: true })).toBe(false);
  });

  it('selects the active direct request over stale inherited callback context', () => {
    expect(selectCallbackInstruction(
      { payload: 'active QA instruction', callback_context: 'stale earlier result' } as any,
      { callback_context: 'another stale result', payload: 'latest callback' } as any,
    )).toBe('active QA instruction');
    expect(selectCallbackInstruction(
      { payload: '[DELEGATION | from=Chief | to=Bob]\nAsk Pam and add 100.' } as any,
      { payload: 'callback result' } as any,
    )).toBe('Ask Pam and add 100.');
  });

  it('limits Chief to read and orchestration tools while preserving worker tools', () => {
    expect(allowedToolsForTaskFlow('delegation_result', 'WORKER', true)).toEqual(['read', 'bash', 'edit', 'write', 'delegate_task', 'plan_delegation']);
    expect(allowedToolsForTaskFlow('delegation_progress')).toEqual([]);
    expect(allowedToolsForTaskFlow('direct')).toContain('plan_delegation');
    expect(allowedToolsForTaskFlow('direct', 'CHIEF')).toEqual(['read', 'delegate_task', 'plan_delegation']);
    expect(allowedToolsForTaskFlow('direct', 'CHIEF', false)).toEqual(['read', 'delegate_task']);
    expect(allowedToolsForTaskFlow('delegation_result', 'CHIEF', false)).toEqual(['read', 'delegate_task']);
    expect(allowedToolsForTaskFlow('delegation_result', 'CHIEF', true)).toEqual(['read', 'delegate_task', 'plan_delegation']);
    expect(allowedToolsForTaskFlow('delegation_progress', 'CHIEF')).toEqual([]);
  });

  it('resolves an explicitly named Chief recipient from the live roster', () => {
    const roster = [{ nickname: 'Bob' }, { nickname: 'Pam' }];
    expect(explicitRecipientFromRequest('Dile a Bob que le pregunte a Pam qué es 2+2', roster)).toBe('Bob');
    expect(explicitRecipientFromRequest('Tell Bob to ask Pam for the result', roster)).toBe('Bob');
    expect(explicitRecipientFromRequest('Bob y Pam pueden revisar esto', roster)).toBeNull();
  });

  it('adds the invoking agent as a deterministic plan entry and renders owners and handoffs', () => {
    const store = new DelegationPlanStore();
    const node = (id: string, owner: string, delegate_to: string | null): DelegationNode => ({
      id, owner, delegate_to, action: `step ${id}`, deliver_to: delegate_to || 'requester', stop: `stop ${id}`,
      status: 'PENDING', children: [],
    });
    const normalized = store.normalizeEntryOwnership([
      node('1', 'Bob', 'Pam'), node('2', 'Pam', null), node('3', 'Bob', null),
    ], 'Chief');
    expect(normalized.wrapped).toBe(1);
    expect(normalized.nodes[0]).toMatchObject({ owner: 'Chief', delegate_to: 'Bob' });
    expect(normalized.nodes[0].children?.map(n => n.id)).toEqual(['1', '3']);
    expect(normalized.nodes[0].children?.[0].children?.map(n => n.id)).toEqual(['2']);
    expect(store.collectOwnedPending(normalized.nodes, 'Chief').map(n => n.id)).toEqual(['__entry__1']);
    expect(store.collectOwnedPending(normalized.nodes, 'Bob').map(n => n.id)).toEqual(['1', '3']);
    expect(store.collectOwnedPending(normalized.nodes, 'Pam').map(n => n.id)).toEqual(['2']);
    const chiefView = store.formatForAgent({ plan_ref: 3, root_task_id: 1, workspace_id: 'ws', owner_agent_id: 'chief-id', requester: 'user',
      raw_text: '', schema: 'v2', nodes: normalized.nodes, parada: null, cursor: 0, state: 'active' }, 'Chief');
    expect(chiefView).toContain('__entry__1 [PENDING] Chief → Bob:');
    expect(chiefView).toContain('1 [PENDING] Bob → Pam:');
    expect(chiefView).toContain('Responsabilidad: Chief');
    expect(chiefView).toContain('No ejecutes nodos propiedad de otros');
  });

  it('closes delegated substeps only when the parent branch returns a final result', () => {
    const store = new DelegationPlanStore();
    const branch: DelegationNode = { id: '1', owner: 'Bob', delegate_to: 'Pam', action: 'ask', deliver_to: 'Pam', stop: 'answer', status: 'PENDING', children: [
      { id: '1.1', owner: 'Pam', delegate_to: null, action: 'answer', deliver_to: 'Bob', stop: 'delivered', status: 'PENDING', children: [] },
      { id: '1.2', owner: 'Pam', delegate_to: null, action: 'other', deliver_to: 'Bob', stop: 'done', status: 'FAILED', children: [] },
    ] };
    store.markDelegatedBranchDone(branch, 42);
    expect(branch.status).toBe('DONE');
    expect(branch.result_ref).toBe(42);
    expect(branch.children?.map(n => n.status)).toEqual(['DONE', 'FAILED']);
  });
});

describe('delegation progress summary', () => {
  it('reports the registered handoff and task id without model narration', () => {
    const summary = formatDelegationProgressSummary('Pam', 17);
    expect(summary).toBe('Subdelegación registrada a Pam (task #17); esperando el resultado final.');
    expect(summary).not.toContain('plan');
    expect(summary).not.toContain('razonamiento');
  });

  it('uses a concise generic status when handoff details are unavailable', () => {
    expect(formatDelegationProgressSummary()).toBe('Subdelegación registrada; esperando el resultado final.');
  });
});

describe('planner roster', () => {
  it('includes the active planner as a valid local step owner without duplicating it', () => {
    const roster = buildPlannerRoster({ id: 'bob-id', nickname: 'Bob', role: 'WORKER' }, [
      { id: 'bob-id', nickname: 'Bob-old', role: 'WORKER' },
      { id: 'pam-id', nickname: 'Pam', role: 'WORKER' },
    ]);
    expect(roster).toEqual([
      { id: 'bob-id', nickname: 'Bob', role: 'WORKER' },
      { id: 'pam-id', nickname: 'Pam', role: 'WORKER' },
    ]);
  });
});
