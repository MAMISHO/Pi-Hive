export interface ReceiverScopedPlanNode {
  id: string;
  owner: string;
  delegate_to: string | null;
  action: string;
  deliver_to: string;
  stop: string;
}

function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function deliveryLine(deliverTo: string, targetNickname: string): string {
  const d = norm(deliverTo);
  const t = norm(targetNickname);
  if (!d || d === 'solicitante' || d === 'user' || d === 'usuario' || d === t) {
    return 'Entrega: responde en tu turno con el resultado de tu tramo; el runtime lo enruta automáticamente al solicitante de este tramo.';
  }
  return `Entrega: responde en tu turno con el resultado de tu tramo; el runtime lo enruta automáticamente a ${deliverTo}.`;
}

export function buildReceiverScopedInstruction(params: {
  delegatorNickname: string;
  delegatorRole?: string;
  targetNickname: string;
  targetRole?: string;
  node: ReceiverScopedPlanNode;
  requester?: string | null;
}): string {
  const { delegatorNickname, delegatorRole, targetNickname, targetRole, node, requester } = params;
  const delegator = `${delegatorNickname}${delegatorRole ? ` (${delegatorRole})` : ''}`;
  const target = `${targetNickname}${targetRole ? ` (${targetRole})` : ''}`;
  const lines = [
    `Tramo asignado a ${target} — nodo ${node.id}.`,
    `Acción: ${String(node.action || '').trim()}`,
    deliveryLine(node.deliver_to, targetNickname),
    `Cierre: ${String(node.stop || '').trim()}`,
    `Contexto: te delega ${delegator}; solicitante/origen de la cadena: ${requester || 'solicitante'}.`,
    'Ejecuta solo este tramo. No copies el plan completo ni incluyas pasos de otros agentes; si tu nodo tiene subtareas, usa el [PLAN_SLICE] adjunto y delega solo el sub-tramo del receptor.',
  ];
  return lines.join('\n');
}
