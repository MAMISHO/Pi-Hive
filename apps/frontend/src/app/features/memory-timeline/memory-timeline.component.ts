import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-memory-timeline',
  standalone: true,
  template: `
    <h2>Memory Timeline</h2>
    <p>Per-agent consolidated memories from Engram</p>
    <div class="memory-list">
      @for (memory of memories(); track memory.id) {
        <div class="memory-card">
          <div class="header">
            <span class="agent">{{ memory.agent_id }}</span>
            <span class="session">{{ memory.session_id }}</span>
            <span class="date">{{ memory.created_at }}</span>
          </div>
          <p class="summary">{{ memory.compacted_summary }}</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .memory-list { display: flex; flex-direction: column; gap: 0.75rem; }
    .memory-card { padding: 1rem; border-radius: 8px; background: #1e1e2e; }
    .header { display: flex; gap: 1rem; margin-bottom: 0.5rem; }
    .agent { font-weight: bold; color: #fff; }
    .session { font-size: 0.8rem; color: #888; }
    .date { font-size: 0.8rem; color: #888; }
    .summary { color: #ccc; font-size: 0.9rem; }
  `],
})
export class MemoryTimelineComponent {
  memories = signal<any[]>([]);
}