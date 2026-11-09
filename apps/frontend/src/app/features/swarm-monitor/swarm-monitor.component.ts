import { Component, signal } from '@angular/core';

@Component({
  selector: 'app-swarm-monitor',
  standalone: true,
  template: `
    <h2>Swarm Monitor</h2>
    <p>Real-time task queue visualization</p>
    <div class="task-list">
      @for (task of tasks(); track task.id) {
        <div class="task-card" [class]="'status-' + task.status.toLowerCase()">
          <span class="agent">{{ task.receiver_agent_id }}</span>
          <span class="status">{{ task.status }}</span>
          <p class="payload">{{ task.payload }}</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .task-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .task-card { padding: 0.75rem; border-radius: 8px; background: #1e1e2e; border-left: 4px solid #555; }
    .status-pending { border-left-color: #f0ad4e; }
    .status-processing { border-left-color: #5bc0de; }
    .status-completed { border-left-color: #5cb85c; }
    .status-hold { border-left-color: #d9534f; }
    .agent { font-weight: bold; color: #fff; }
    .status { font-size: 0.8rem; color: #aaa; margin-left: 0.5rem; }
    .payload { font-size: 0.85rem; color: #ccc; margin-top: 0.25rem; }
  `],
})
export class SwarmMonitorComponent {
  tasks = signal<any[]>([]);
}