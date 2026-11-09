import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PromptDraftService {
  private drafts = new Map<string, string>();

  get(agentId?: string | null): string {
    return agentId ? (this.drafts.get(agentId) ?? '') : '';
  }

  set(agentId: string | null | undefined, value: string): void {
    if (!agentId) return;
    this.drafts.set(agentId, value);
  }

  clear(agentId?: string | null): void {
    if (agentId) this.drafts.delete(agentId);
  }

  prune(validAgentIds: Set<string>): void {
    for (const k of Array.from(this.drafts.keys())) if (!validAgentIds.has(k)) this.drafts.delete(k);
  }
}