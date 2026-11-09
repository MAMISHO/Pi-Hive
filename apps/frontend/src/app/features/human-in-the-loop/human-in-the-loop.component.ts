import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { TagModule } from 'primeng/tag';
import { TaskService } from '../../core/services/task.service';
import { AgentSelectionService } from '../../core/services/agent-selection.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ITaskQueue } from '../../core/models/task.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-human-in-the-loop',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, TextareaModule, TagModule],
  template: `
    <div class="hitl">
      <div class="header">
        <h2>Human-in-the-Loop</h2>
        <span class="count">{{ tasks.length }} tareas</span>
      </div>
      <p *ngIf="!hitlEnabled" class="notice">HITL deshabilitado en este workspace: las peticiones y delegaciones se procesan automáticamente. Esta vista solo sirve para intervenir manualmente si una tarea queda atascada (HOLD/error).</p>
      @for (task of tasks; track task.id) {
        <div class="task-card">
          <div class="task-meta">
            <span class="task-id">#{{ task.id }}</span>
            <p-tag [value]="task.status" [severity]="severity(task.status)"></p-tag>
            <span class="route">{{ short(task.sender_agent_id) }} → {{ short(task.receiver_agent_id) }}</span>
          </div>
          <textarea pTextarea [(ngModel)]="prompts[task.id]" rows="6"></textarea>
          <div class="actions">
            <button *ngIf="hitlEnabled" pButton label="Liberar tarea (manual)" icon="pi pi-play" (click)="liberar(task)"></button>
            <button *ngIf="hitlEnabled" pButton label="Pausar (HOLD)" icon="pi pi-pause" severity="warn" (click)="pausar(task)"></button>
            <button pButton label="Eliminar" icon="pi pi-trash" severity="danger" (click)="eliminar(task)"></button>
          </div>
        </div>
      } @empty {
        <p class="empty">Sin tareas PENDING/HOLD</p>
      }
    </div>
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .header h2 { font-size: 16px; font-weight: 600; }
    .count { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .notice { font-size: 12px; color: var(--accent-amber, #f59e0b); background: rgba(245,158,11,.08); border: 1px solid rgba(245,158,11,.25); padding: 8px 10px; border-radius: 8px; margin-bottom: 12px; }
    .task-card { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; margin-bottom: 12px; }
    .task-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; font-size: 12px; color: var(--text-secondary); }
    .task-id { font-family: var(--font-mono); color: var(--text-muted); }
    .route { font-family: var(--font-mono); }
    .actions { display: flex; gap: 8px; margin-top: 8px; }
    .empty { color: var(--text-muted); font-size: 12px; }
  `],
})
export class HumanInTheLoopComponent implements OnInit, OnDestroy {
  tasks: ITaskQueue[] = [];
  prompts: Record<number, string> = {};
  hitlEnabled = false;
  private subs: Subscription[] = [];

  constructor(
    private readonly taskService: TaskService,
    private readonly selection: AgentSelectionService,
    private readonly ws: WebsocketService,
    public readonly workspace: WorkspaceService,
  ) {}

  ngOnInit(): void {
    this.workspace.active$.subscribe((w) => (this.hitlEnabled = !!w?.hitl_enabled));
    this.load();
    this.subs.push(this.selection.selectedAgent$.subscribe(() => this.load()));
    this.subs.push(this.ws.statusChange$.subscribe(() => this.load()));
  }

  load(): void {
    this.taskService.getAll().subscribe((tasks) => {
      this.tasks = tasks.filter((t) => t.status === 'PENDING' || t.status === 'HOLD');
      this.tasks.forEach((t) => { if (this.prompts[t.id] == null) this.prompts[t.id] = t.payload; });
    });
  }

  liberar(task: ITaskQueue): void {
    if (!this.hitlEnabled) return;
    this.taskService.updatePayload(task.id, this.prompts[task.id]).subscribe(() =>
      this.taskService.updateStatus(task.id, 'PENDING').subscribe(() => this.load()),
    );
  }
  pausar(task: ITaskQueue): void { if (this.hitlEnabled) this.taskService.updateStatus(task.id, 'HOLD').subscribe(() => this.load()); }
  eliminar(task: ITaskQueue): void {
    if (!confirm(`¿Eliminar tarea #${task.id}?`)) return;
    (this.taskService as any).delete ? (this.taskService as any).delete(task.id).subscribe(() => this.load()) : fetch(`http://localhost:8090/tasks/${task.id}`,{method:'DELETE'}).then(()=>this.load());
  }
  short(id?: string | null): string { return id ? id.substring(0, 8) : 'user'; }
  severity(s: string): 'success'|'warn'|'danger'|'info'|'secondary' {
    return ({ PENDING:'warn', HOLD:'secondary', COMPLETED:'success', FAILED:'danger', PROCESSING:'info' } as any)[s] || 'secondary';
  }
  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }
}
