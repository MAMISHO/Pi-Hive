import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { TagModule } from 'primeng/tag';
import { LiveConsoleComponent } from '../../shared/live-console/live-console.component';
import { TaskService } from '../../core/services/task.service';
import { AgentService } from '../../core/services/agent.service';
import { AgentSelectionService } from '../../core/services/agent-selection.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { ITaskQueue } from '../../core/models/task.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-swarm-monitor',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, TextareaModule, TagModule, LiveConsoleComponent],
  template: `
    <div class="swarm-monitor">
      @if (selectedAgent) {
        <div class="agent-status-bar">
          <span class="status-dot" [class]="statusClass(selectedAgent.status)"></span>
          <span class="status-text">{{ statusLabel(selectedAgent.status) }}</span>
          @if (pendingCount > 0) {
            <span class="queue-badge">{{ pendingCount }} in queue</span>
          }
          @if (selectedAgent?.status === 'WORKING') {
            <button pButton label="Parar" icon="pi pi-stop" severity="danger" class="p-button-sm p-button-outlined" (click)="stopAgent()"></button>
          }
        </div>
      }
      <app-live-console [selectedAgentId]="selectedAgentId"></app-live-console>

      <section class="panel">
        <div class="panel-header">
          <h3>Chat History</h3>
          <span class="count">{{ tasks.length }}</span>
        </div>
        <div class="chat-history">
          @for (task of tasks; track task.id) {
            <div class="chat-item">
              <div class="chat-meta">
                <span class="route">{{ short(task.sender_agent_id) }} → {{ short(task.receiver_agent_id) }}</span>
                <p-tag [value]="task.status" [severity]="severity(task.status)"></p-tag>
              </div>
              <div class="chat-payload">
                <div class="label">Request</div>
                <p>{{ task.payload }}</p>
              </div>
              @if (task.status === 'COMPLETED' && task.response) {
                <div class="chat-response">
                  <div class="label">Response</div>
                  <pre>{{ task.response }}</pre>
                </div>
              }
            </div>
          } @empty {
            <p class="empty">No messages yet</p>
          }
        </div>
      </section>

      <section class="panel prompt-buffer">
        <div class="panel-header">
          <h3>Prompt Buffer</h3>
          @if (holdTask) { <span class="badge hold">HOLD</span> }
          @else if (selectedAgentId) { <span class="badge compose">COMPOSE</span> }
        </div>
        <textarea pTextarea [(ngModel)]="promptText" [disabled]="!holdTask && !selectedAgentId" rows="6" [placeholder]="holdTask ? 'Edit prompt and release…' : (selectedAgentId ? 'Write a prompt for the selected agent…' : 'Select an agent first')"></textarea>
        <div class="actions">
          @if (holdTask) {
            <button pButton label="Liberar y Ejecutar" icon="pi pi-play" (click)="liberar()"></button>
          } @else {
            <button pButton label="Send Task" icon="pi pi-send" (click)="sendTask()" [disabled]="!selectedAgentId || !promptText.trim()"></button>
          }
        </div>
      </section>
    </div>
  `,
  styles: [`
    .swarm-monitor { display: flex; flex-direction: column; gap: 16px; }
    .agent-status-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 13px; }
    .status-text { color: var(--text-secondary); }
    .queue-badge { margin-left: auto; font-size: 11px; color: var(--accent-amber); font-family: var(--font-mono); background: rgba(210,153,34,0.12); padding: 2px 8px; border-radius: var(--radius-sm); }
    .panel { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .panel-header h3 { font-size: 14px; font-weight: 600; }
    .count { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .badge.hold { font-size: 10px; color: var(--accent-amber); font-weight: 700; }
    .badge.compose { font-size: 10px; color: var(--accent-blue); font-weight: 700; }
    .chat-history { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
    .chat-item { padding: 8px 0; border-bottom: 1px solid var(--border-color); }
    .chat-item:last-child { border-bottom: none; }
    .chat-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .route { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); }
    .chat-payload { font-size: 13px; color: var(--text-primary); margin: 0; }
    .chat-payload p { white-space: pre-wrap; margin: 0; }
    .chat-response { margin-top: 8px; padding: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); }
    .chat-response pre { white-space: pre-wrap; margin: 0; font-family: var(--font-mono); font-size: 12px; color: #e6edf3; }
    .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); margin-bottom: 4px; }
    .actions { margin-top: 8px; }
    .empty { color: var(--text-muted); font-size: 12px; }
  `],
})
export class SwarmMonitorComponent implements OnInit, OnDestroy {
  tasks: ITaskQueue[] = [];
  selectedAgentId: string | null = null;
  selectedAgent: any = null;
  promptText = '';
  holdTask: ITaskQueue | null = null;
  pendingCount = 0;
  private subs: Subscription[] = [];

  constructor(
    private taskService: TaskService,
    private agentService: AgentService,
    private selection: AgentSelectionService,
    private ws: WebsocketService
  ) {}

  ngOnInit(): void {
    this.subs.push(this.selection.selectedAgent$.subscribe((a) => {
      this.selectedAgent = a;
      this.selectedAgentId = a?.id ?? null;
      this.load();
    }));
    this.subs.push(this.ws.statusChange$.subscribe(() => this.load()));
    this.load();
  }

  load(): void {
    this.taskService.getAll().subscribe({
      next: (list) => {
        this.tasks = this.selectedAgentId ? list.filter((t) => t.receiver_agent_id === this.selectedAgentId) : list;
        this.pendingCount = this.tasks.filter((t) => t.status === 'PENDING' || t.status === 'PROCESSING').length;
        this.holdTask = this.tasks.find((t) => t.status === 'HOLD') ?? null;
        if (this.holdTask) this.promptText = this.holdTask.payload;
      },
      error: () => {},
    });
  }

  statusClass(status: string): string {
    const s = (status || '').toLowerCase();
    return s === 'paused' ? 'hold' : s;
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'WORKING': return 'Working — processing task…';
      case 'PAUSED': return 'Paused — waiting for human approval';
      case 'IDLE': return 'Idle — ready for tasks';
      default: return status || 'Unknown';
    }
  }

  liberar(): void {
    if (!this.holdTask) return;
    const id = this.holdTask.id;
    this.taskService.updatePayload(id, this.promptText).subscribe({
      next: () => {
        this.taskService.updateStatus(id, 'PENDING').subscribe(() => this.load());
      },
      error: () => {},
    });
  }

  sendTask(): void {
    if (!this.selectedAgentId || !this.promptText.trim()) return;
    const task: Partial<ITaskQueue> = {
      sender_agent_id: 'user',
      receiver_agent_id: this.selectedAgentId,
      payload: this.promptText.trim(),
      status: 'PENDING',
      parent_task_id: null,
    };
    this.taskService.create(task as ITaskQueue).subscribe({
      next: () => {
        this.promptText = '';
        this.load();
      },
      error: () => {},
    });
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

  stopAgent(): void {
    if (!this.selectedAgentId) return;
    this.agentService.stop(this.selectedAgentId).subscribe({
      next: () => this.load(),
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }
}