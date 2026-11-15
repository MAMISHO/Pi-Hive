/** True when a local plan action explicitly assigns work to the named roster agent. */
export function explicitlyRequestsAgent(action: string, nickname: string): boolean {
  const normalize = (value: string) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const text = normalize(action);
  const name = normalize(nickname).trim();
  if (!text || !name || !new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) return false;

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const actionToAgent = new RegExp(`\\b(?:pregunt\\w*|consult\\w*|ped\\w*|solicit\\w*|encarg\\w*|dil\\w*|dec\\w*|ask\\w*|tell\\w*|request\\w*)\\b.{0,60}\\b${escaped}\\b`, 'i');
  const agentMustRespond = new RegExp(`\\b${escaped}\\b.{0,60}\\b(?:respond\\w*|contest\\w*|answer\\w*|reply\\w*)`, 'i');
  return actionToAgent.test(text) || agentMustRespond.test(text);
}

export function findMissingExplicitDelegation(
  nodes: Array<{ id: string; owner: string; delegate_to: string | null; action: string; children?: any[] }>,
  roster: Array<{ nickname: string }>,
): string | null {
  const normalize = (value: string) => String(value || '').trim().toLowerCase();
  for (const node of nodes || []) {
    if (!node.delegate_to) {
      const requiredAgent = roster.find((candidate) =>
        normalize(candidate.nickname) !== normalize(node.owner) && explicitlyRequestsAgent(node.action, candidate.nickname));
      if (requiredAgent) return `planner_explicit_agent_action_missing_delegate:${node.id}:${requiredAgent.nickname}`;
    }
    const childError = findMissingExplicitDelegation(node.children || [], roster);
    if (childError) return childError;
  }
  return null;
}
