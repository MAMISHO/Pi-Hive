import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TagModule } from 'primeng/tag';
import { TaskService } from '../../core/services/task.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { ITaskQueue } from '../../core/models/task.model';
import { Subscription } from 'rxjs';

interface TaskNode extends ITaskQueue {
  depth: number;
}

@Component({
  selector: 'app-sidebar-right',
  standalone: true,
  imports: [CommonModule, TagModule],
  template: `
    <div class="sidebar-right">
      <div class="header">
        <h2>Task Lineage</h2>
        <span class="count">{{ tasks.length }}</span>
      </div>
      <div class="timeline">
        @for (task of ordered; track task.id) {
          <div class="task-timeline-item" [class]="task.status.toLowerCase()" [style.padding-left.px]="16 + task.depth * 18">
            <div class="task-header">
              <span class="task-id">#{{ task.id }}</span>
              <p-tag [value]="task.status" [severity]="severity(task.status)"></p-tag>
            </div>
            <div class="task-route">{{ short(task.sender_agent_id) }} → {{ short(task.receiver_agent_id) }}</div>
            @if (task.parent_task_id) {
              <div class="parent">parent: #{{ task.parent_task_id }}</div>
            }
            <div class="payload">{{ preview(task.payload) }}</div>
          </div>
        } @empty {
          <div class="empty">No tasks yet</div>
        }
      </div>
    </div>
  `,
  styles: [`
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
    .header h2 { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .count { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .task-timeline-item { position: relative; padding-bottom: 14px; border-left: 2px solid var(--border-color); margin-left: 4px; }
    .task-timeline-item::before { content: ''; position: absolute; left: -6px; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent-blue); border: 2px solid var(--bg-secondary); }
    .task-timeline-item.completed::before { background: var(--accent-green); }
    .task-timeline-item.hold::before { background: var(--accent-amber); }
    .task-timeline-item.processing::before { background: var(--accent-purple); }
    .task-header { display: flex; align-items: center; gap: 8px; }
    .task-id { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); }
    .task-route { font-size: 12px; color: var(--text-secondary); margin: 2px 0; font-family: var(--font-mono); }
    .parent { font-size: 10px; color: var(--text-muted); }
    .payload { font-size: 12px; color: var(--text-secondary); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 290px; }
    .empty { font-size: 12px; color: var(--text-muted); padding: 8px 0; }
  `],
})
export class SidebarRightComponent implements OnInit, OnDestroy {
  tasks: ITaskQueue[] = [];
  ordered: TaskNode[] = [];
  private subs: Subscription[] = [];

  constructor(private taskService: TaskService, private ws: WebsocketService) {}

  ngOnInit(): void {
    this.load();
    this.subs.push(this.ws.statusChange$.subscribe(() => this.load()));
  }

  load(): void {
    this.taskService.getAll().subscribe({
      next: (list) => {
        this.tasks = list;
        this.ordered = this.buildLineage(list);
      },
      error: () => {
        this.tasks = [];
        this.ordered = [];
      },
    });
  }

  buildLineage(list: ITaskQueue[]): TaskNode[] {
    const byId = new Map(list.map((t) => [t.id, t]));
    const depth = (t: ITaskQueue, seen = new Set<number>()): number => {
      if (!t.parent_task_id) return 0;
      if (seen.has(t.id)) return 0;
      seen.add(t.id);
      const parent = byId.get(t.parent_task_id);
      return parent ? 1 + depth(parent, seen) : 0;
    };
    return list
      .map((t) => ({ ...t, depth: depth(t) }))
      .sort((a, b) => a.depth - b.depth || a.id - b.id);
  }

  short(id: string): string {
    return id ? id.slice(0, 8) : '';
  }

  preview(p: string): string {
    if (!p) return '';
    return p.length > 80 ? p.slice(0, 80) + '…' : p;
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