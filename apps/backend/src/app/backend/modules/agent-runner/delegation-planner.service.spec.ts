jest.mock('@earendil-works/pi-coding-agent', () => ({}), { virtual: true });

import { parsePlanV2 } from './delegation-planner.service.js';

describe('delegation plan v2 normalization', () => {
  const roster = [
    { nickname: 'Bob', role: 'WORKER' },
    { nickname: 'Pam', role: 'WORKER' },
    { nickname: 'Dev', role: 'WORKER' },
  ];

  it('accepts the planning agent as owner and infers omitted mechanical fields', () => {
    const parsed = parsePlanV2({
      schema: 'v2',
      nodes: [{
        owner: 'Bob', delegate_to: 'Pam', action: 'Ask Pam for the result', children: [
          { owner: 'Pam', instruction: 'Get the requested result' },
        ],
      }],
    }, roster, 'Bob');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.nodes[0]).toMatchObject({ owner: 'Bob', delegate_to: 'Pam', status: 'PENDING' });
    expect(parsed.nodes[0].children?.[0]).toMatchObject({ owner: 'Pam', action: 'Get the requested result', deliver_to: 'Bob', status: 'PENDING' });
  });

  it('preserves nested ownership so each delegated depth belongs to its parent target', () => {
    const parsed = parsePlanV2({ schema: 'v2', nodes: [{
      owner: 'Bob', delegate_to: 'Pam', action: 'Coordinate the requested work', stop: 'Return result', children: [{
        owner: 'Pam', delegate_to: 'Dev', action: 'Ask Dev to perform the subtask', stop: 'Receive subtask result', children: [{
          owner: 'Dev', action: 'Perform the subtask', stop: 'Return result to Pam',
        }],
      }],
    }] }, roster, 'Bob');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.nodes[0].children?.[0].children?.[0].owner).toBe('Dev');
  });

  it('still rejects an explicitly named owner outside the active roster', () => {
    const parsed = parsePlanV2({ schema: 'v2', nodes: [{
      owner: 'SomebodyElse', action: 'Do the requested work', stop: 'Return result',
    }] }, roster, 'Bob');
    expect(parsed).toMatchObject({ ok: false, reason: 'invalid_node_1_owner_not_in_roster:SomebodyElse' });
  });
});
