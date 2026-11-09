import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { AgentSelectionService } from './core/services/agent-selection.service';
import { SidebarLeftComponent } from './shared/sidebar-left/sidebar-left.component';
import { SidebarRightComponent } from './shared/sidebar-right/sidebar-right.component';
import { IAgent } from './core/models/agent.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, ButtonModule, SidebarLeftComponent, SidebarRightComponent],
  template: `
    <div class="app-shell">
      <header class="app-header">
        <div class="brand">
          <span class="logo">π</span>
          <h1>Pi-Hive</h1>
        </div>
        <nav class="nav">
          <a routerLink="/swarm-monitor" routerLinkActive="active">Swarm</a>
          <a routerLink="/memory-timeline" routerLinkActive="active">Memory</a>
          <a routerLink="/human-in-the-loop" routerLinkActive="active">HITL</a>
        </nav>
        <div class="selected-agent" *ngIf="selectedAgent">
          <span class="status-dot" [class]="statusClass(selectedAgent.status)"></span>
          <span class="name">{{ selectedAgent.nickname }}</span>
          <span class="model">{{ modelOf(selectedAgent) }}</span>
        </div>
      </header>
      <aside class="sidebar-left">
        <app-sidebar-left></app-sidebar-left>
      </aside>
      <main class="center-panel">
        <router-outlet />
      </main>
      <aside class="sidebar-right">
        <app-sidebar-right></app-sidebar-right>
      </aside>
    </div>
  `,
  styles: [`
    .app-header { gap: 16px; padding: 0 20px; }
    .brand { display: flex; align-items: center; gap: 8px; }
    .logo { font-size: 20px; color: var(--accent-blue); font-weight: 700; }
    .app-header h1 { font-size: 16px; color: var(--text-primary); font-weight: 600; letter-spacing: 0.02em; }
    .nav { display: flex; gap: 4px; margin-left: 16px; }
    .nav a { color: var(--text-secondary); text-decoration: none; font-size: 13px; padding: 6px 10px; border-radius: var(--radius-sm); transition: background var(--transition-fast); }
    .nav a:hover { color: var(--text-primary); background: var(--bg-tertiary); }
    .nav a.active { color: var(--text-primary); background: var(--bg-tertiary); }
    .selected-agent { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .selected-agent .name { color: var(--accent-green); font-family: var(--font-mono); font-weight: 600; }
    .selected-agent .model { color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; }
  `],
})
export class AppComponent {
  get selectedAgent(): IAgent | null {
    return this.selection.selectedAgent;
  }
  constructor(private selection: AgentSelectionService) {}
  statusClass(status: string): string {
    const s = status.toLowerCase();
    return s === 'paused' ? 'hold' : s;
  }
  modelOf(agent: IAgent): string {
    const ts = agent.task_state as any;
    return ts?.model ? String(ts.model).split('/').pop() : '';
  }
}