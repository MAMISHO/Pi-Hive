import { explicitlyRequestsAgent, findMissingExplicitDelegation } from './delegation-plan-validation.js';

describe('delegation plan validation', () => {
  it('detects when a local step explicitly asks another roster agent to act', () => {
    expect(explicitlyRequestsAgent('Preguntar a Pam qué es 2+2 y esperar que Pam responda', 'Pam')).toBe(true);
  });

  it('rejects a local plan node that requires another agent', () => {
    expect(findMissingExplicitDelegation([
      { id: '1', owner: 'Bob', delegate_to: null, action: 'Preguntar a Pam qué es 2+2 y esperar que Pam responda' },
    ], [{ nickname: 'Bob' }, { nickname: 'Pam' }])).toBe('planner_explicit_agent_action_missing_delegate:1:Pam');
  });

  it('accepts explicit delegation and does not flag unrelated mentions', () => {
    expect(findMissingExplicitDelegation([
      { id: '1', owner: 'Bob', delegate_to: 'Pam', action: 'Pedir a Pam el resultado' },
      { id: '2', owner: 'Bob', delegate_to: null, action: 'Informar al usuario sobre la propuesta de Pam' },
    ], [{ nickname: 'Bob' }, { nickname: 'Pam' }])).toBeNull();
  });
});
