export interface InstructionGuardResult {
  blocked: boolean;
  reasons: string[];
  message: string | null;
}

function norm(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function detectCopyPasteInstruction(params: {
  instruction: string;
  delegatorNickname: string;
  targetNickname: string;
}): InstructionGuardResult {
  const text = norm(params.instruction);
  const target = norm(params.targetNickname);
  const delegator = norm(params.delegatorNickname);
  const reasons: string[] = [];

  const asksSelf =
    text.includes(`preguntale a ${target}`) ||
    text.includes(`pregunta a ${target}`) ||
    text.includes(`consultale a ${target}`);
  if (asksSelf) reasons.push('target_asked_to_ask_itself');

  const asksDelegator =
    (text.includes(`preguntale a ${delegator}`) ||
      text.includes('preguntame a mi') ||
      text.includes('preguntame')) &&
    (text.includes('te respondera') ||
      text.includes('yo te respondere') ||
      text.includes('me responder'));
  if (asksDelegator) reasons.push('target_asked_to_ask_delegator');

  const asksUser =
    text.includes('preguntale al usuario') ||
    text.includes('preguntale a user') ||
    text.includes('preguntale al solicitante');
  if (asksUser) reasons.push('target_asked_to_ask_user');

  const reportsToUser =
    /\b(dile|reporta|devuelve|entrega|responde|informa)\b[^.]{0,100}\b(al usuario|a user|al solicitante)\b/.test(text) ||
    (text.includes('devuelveme') && text.includes('al usuario'));
  if (reportsToUser) reasons.push('reports_to_final_user');

  const copiedChecklist = /sigue exactamente|sigue estos pasos|pasos exactos|instrucciones exactas/.test(text);
  if (copiedChecklist) reasons.push('copied_checklist');

  const blocking = reasons.some((r) => r !== 'copied_checklist');
  if (!blocking) return { blocked: false, reasons, message: null };

  const message = [
    `Delegación bloqueada: la instrucción para ${params.targetNickname} contiene pasos/roles que no le corresponden (${reasons.join(', ')}).`,
    'Reescribe SOLO su tramo: acción concreta, dato de entrada y condición de entrega.',
    'No copies el plan completo, no incluyas pasos de otros agentes y no le pidas reportar al usuario final; el runtime enruta su respuesta a ti.',
  ].join(' ');
  return { blocked: true, reasons, message };
}
