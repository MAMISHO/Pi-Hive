import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { TagModule } from 'primeng/tag';
import { TaskService } from '../../core/services/task.service';
import { AgentSelectionService } from '../../core/services/agent-selection.service';
import { WebsocketService } from '../../core/services/websocket.service';
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
        <span class="count">{{ tasks.length }} pending</span>
      </div>
      @for (task of tasks; track task.id) {
        <div class="task-card">
          <div class="task-meta">
            <span class="task-id">#{{ task.id }}</span>
            <p-tag [value]="task.status" [severity]="severity(task.status)"></p-tag>
            <span class="route">{{ short(task.sender_agent_id) }} → {{ short(task.receiver_agent_id) }}</span>
          </div>
          <textarea pTextarea [(ngModel)]="prompts[task.id]" rows="6"></textarea>
          <div class="actions">
            <button pButton label="Liberar y Ejecutar" icon="pi pi-play" (click)="liberar(task)"></button>
            <button pButton label="Pausar" icon="pi pi-pause" severity="warn" (click)="pausar(task)"></button>
            <button pButton label="Eliminar" icon="pi pi-trash" severity="danger" (click)="eliminar(task)"></button>
          </div>
        </div>
      } @empty {
        <p class="empty">No pending/hold tasks</p>
      }
    </div>
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .header h2 { font-size: 16px; font-weight: 600; }
    .count { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
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
  private subs: Subscription[] = [];

  constructor(private taskService: TaskService, private selection: AgentSelectionService, private ws: WebsocketService) {}

  ngOnInit(): void {
    this.load();
    this.subs.push(this.selection.selectedAgent$.subscribe(() => this.load()));
    this.subs.push(this.ws.statusChange$.subscribe(() => this.load()));
  }

  load(): void {
    this.taskService.getAll().subscribe({
      next: (list) => {
        const agentId = this.selection.selectedAgent?.id;
        this.tasks = list.filter((t) => (t.status === 'HOLD' || t.status === 'PENDING') && (!agentId || t.receiver_agent_id === agentId));
        for (const t of this.tasks) {
          if (this.prompts[t.id] === undefined) this.prompts[t.id] = t.payload;
        }
      },
      error: () => (this.tasks = []),
    });
  }

  liberar(task: ITaskQueue): void {
    const payload = this.prompts[task.id];
    this.taskService.updatePayload(task.id, payload).subscribe({
      next: () => this.taskService.updateStatus(task.id, 'PENDING').subscribe(() => this.load()),
      error: () => {},
    });
  }

  pausar(task: ITaskQueue): void {
    this.taskService.updateStatus(task.id, 'HOLD').subscribe(() => this.load());
  }

  eliminar(task: ITaskQueue): void {
    if (!confirm(`¿Eliminar la tarea #${task.id}? Esta acción no se puede deshacer.`)) return;
    this.taskService.remove(task.id).subscribe(() => this.load());
  }

  short(id: string): string {
    return id ? id.slice(0, 8) : '';
  }

  severity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case 'COMPLETED': return 'success';
      case 'PROCESSING': return 'info';
      case 'HOLD': return 'warn';
      case 'PENDING': return 'secondary';
      default: return 'contrast';
    }
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }
}