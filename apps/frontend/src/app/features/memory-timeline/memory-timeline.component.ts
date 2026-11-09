import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { AgentService } from '../../core/services/agent.service';
import { MemoryService } from '../../core/services/memory.service';
import { IAgent } from '../../core/models/agent.model';
import { IAgentMemory } from '../../core/models/memory.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-memory-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, SelectModule],
  template: `
    <div class="memory-timeline">
      <div class="toolbar">
        <p-select [(ngModel)]="selectedAgentId" [options]="agentOptions" optionLabel="label" optionValue="value" (onChange)="loadMemories()" [style]="{minWidth:'220px'}"></p-select>
        <button pButton label="Refresh" icon="pi pi-refresh" (click)="loadMemories()" class="p-button-sm"></button>
      </div>
      <div class="memory-list">
        @for (m of memories; track m.id) {
          <div class="memory-card">
            <div class="memory-header">
              <span class="session-id">{{ m.session_id }}</span>
              <span class="created">{{ m.created_at }}</span>
            </div>
            <p class="summary">{{ m.compacted_summary }}</p>
          </div>
        } @empty {
          <p class="empty">No memories</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
    .memory-list { display: flex; flex-direction: column; gap: 8px; }
    .memory-card { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; }
    .memory-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .session-id { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); }
    .created { font-size: 10px; color: var(--text-muted); }
    .summary { font-size: 13px; color: var(--text-secondary); margin: 0; white-space: pre-wrap; }
    .empty { color: var(--text-muted); font-size: 12px; }
  `],
})
export class MemoryTimelineComponent implements OnInit, OnDestroy {
  agents: IAgent[] = [];
  agentOptions: { label: string; value: string }[] = [];
  selectedAgentId: string | null = null;
  memories: IAgentMemory[] = [];
  private subs: Subscription[] = [];

  constructor(private agentService: AgentService, private memoryService: MemoryService) {}

  ngOnInit(): void {
    this.agentService.getAll().subscribe({
      next: (list) => {
        this.agents = list;
        this.agentOptions = list.map((a) => ({ label: a.nickname, value: a.id }));
        if (list.length && !this.selectedAgentId) {
          this.selectedAgentId = list[0].id;
          this.loadMemories();
        }
      },
      error: () => {},
    });
  }

  loadMemories(): void {
    if (!this.selectedAgentId) return;
    this.memoryService.getByAgent(this.selectedAgentId).subscribe({
      next: (list) => (this.memories = list),
      error: () => (this.memories = []),
    });
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }
}