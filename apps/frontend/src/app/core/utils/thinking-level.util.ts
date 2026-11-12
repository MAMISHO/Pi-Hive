export type ThinkingLevel = 'off'|'minimal'|'low'|'medium'|'high'|'xhigh'|'max';

export const THINKING_LABELS: Record<ThinkingLevel, { short: string; full: string }> = {
  off: { short: '', full: 'off' },
  minimal: { short: 'min', full: 'minimal' },
  low: { short: 'low', full: 'low' },
  medium: { short: 'med', full: 'medium' },
  high: { short: 'xl', full: 'high' },
  xhigh: { short: 'xxl', full: 'xhigh' },
  max: { short: 'max', full: 'max' },
};

export function effortShort(level?: string | null): string {
  const l = (level || 'off') as ThinkingLevel;
  return THINKING_LABELS[l]?.short || '';
}
export function effortFull(level?: string | null): string {
  const l = (level || 'off') as ThinkingLevel;
  return THINKING_LABELS[l]?.full || 'off';
}
export function modelWithEffort(model?: string | null, level?: string | null): string {
  const m = model || '';
  const s = effortShort(level);
  return s ? `${m} · ${s}` : m;
}
export function pickDefaultEffort(available: string[]): ThinkingLevel {
  if (available.includes('minimal')) return 'minimal';
  if (available.includes('low')) return 'low';
  return 'off';
}
export function normalizeEffort(requested: string | null | undefined, available: string[]): ThinkingLevel {
  if (!available || available.length === 0) return 'off';
  const r = (requested || '') as ThinkingLevel;
  if (available.includes(r)) return r;
  return pickDefaultEffort(available);
}
