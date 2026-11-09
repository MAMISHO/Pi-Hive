import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { AgentSelectionService } from '../../core/services/agent-selection.service';
import { MemoryService } from '../../core/services/memory.service';
import { SessionHistoryService } from '../../core/services/session-history.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { IAgentMemory } from '../../core/models/memory.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-memory-timeline',
  standalone: true,
  imports: [CommonModule, FormsModule, TagModule, ButtonModule],
  template: `
    <div class="memory-timeline">
      <div class="header">
        <h2>Memory & History</h2>
        <div class="tabs">
          <button pButton [label]="'Memories ('+memories.length+')'" [text]="tab!=='mem'" [severity]="tab==='mem'?'primary':'secondary'" (click)="tab='mem'"></button>
          <button pButton [label]="'Session History ('+history.length+')'" [text]="tab!=='hist'" [severity]="tab==='hist'?'primary':'secondary'" (click)="tab='hist'; loadHistory()"></button>
        </div>
      </div>
      <div *ngIf="tab==='mem'">
        @for (mem of memories; track mem.id) {
          <div class="card"><div class="meta">#{{ mem.id }} · {{ mem.session_id || 'no session' }} · {{ mem.created_at | date:'short' }}</div><p>{{ mem.compacted_summary }}</p></div>
        } @empty { <p class="empty">No memories for selected agent</p> }
      </div>
      <div *ngIf="tab==='hist'">
        <p class="hint">Historial archivado al limpiar/compactar sesiones (incluye chat archivado). Consulta por agente/workspace.</p>
        @for (h of history; track h.id) {
          <details class="card">
            <summary class="meta">#{{h.id}} · {{h.event_type}} · {{h.agent_id}} · {{h.created_at | date:'short'}} — {{h.summary}}</summary>
            <pre *ngIf="h.details">{{ pretty(h.details) }}</pre>
          </details>
        } @empty { <p class="empty">No session history</p> }
      </div>
    </div>
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap:8px; flex-wrap:wrap; }
    .header h2 { font-size: 16px; font-weight: 600; }
    .tabs{display:flex;gap:6px}
    .card { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; margin-bottom: 8px; }
    .meta { font-size: 11px; color: var(--text-muted); margin-bottom: 4px; font-family: var(--font-mono); cursor:pointer; }
    .card p { font-size: 13px; line-height: 1.5; white-space: pre-wrap; }
    .card pre { font-size: 11px; white-space: pre-wrap; margin-top:8px; color: var(--text-secondary); max-height:260px; overflow:auto; }
    .empty,.hint { color: var(--text-muted); font-size: 12px; }
  `],
})
export class MemoryTimelineComponent implements OnInit, OnDestroy {
  memories: IAgentMemory[] = []; history: any[] = []; tab: 'mem'|'hist'='mem';
  private subs: Subscription[] = [];
  constructor(private readonly selection: AgentSelectionService, private readonly memoryService: MemoryService, private readonly historyService: SessionHistoryService, private readonly wsSvc: WorkspaceService) {}
  ngOnInit(): void { this.subs.push(this.selection.selectedAgent$.subscribe((a) => { if (a) { this.memoryService.getByAgent(a.id).subscribe((m) => (this.memories = m)); if(this.tab==='hist') this.loadHistory(); } else { this.memories=[]; } })); this.subs.push(this.wsSvc.active$.subscribe(()=>{ if(this.tab==='hist') this.loadHistory(); })); }
  loadHistory(): void { const ws = this.wsSvc.active; if(!ws){ this.history=[]; return; } this.historyService.getByWorkspace(ws.id).subscribe((h)=>this.history=h||[]); }
  pretty(d:any){ try{return JSON.stringify(typeof d==='string'?JSON.parse(d):d,null,2)}catch{return String(d)} }
  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }
}
