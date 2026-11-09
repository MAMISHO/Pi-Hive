import { Component } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AgentSelectionService } from './core/services/agent-selection.service';
import { WorkspaceService, IWorkspace } from './core/services/workspace.service';
import { IAgent } from './core/models/agent.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule],
  template: `
    <div class="app-root">
      <header class="app-header">
        <div class="brand"><span class="logo">π</span><h1>Pi-Hive</h1></div>
        <nav class="nav">
          <a routerLink="/workspaces" routerLinkActive="active">Workspaces</a>
          <a routerLink="/swarm-monitor" routerLinkActive="active">Swarm</a>
          <a routerLink="/memory-timeline" routerLinkActive="active">Memory</a>
          <a routerLink="/human-in-the-loop" routerLinkActive="active">HITL</a>
        </nav>
        <div class="active-ws" *ngIf="activeWs" title="{{activeWs.path}}">WS: {{ activeWs.name }}</div>
        <div class="selected-agent" *ngIf="selectedAgent">
          <span class="status-dot" [class]="statusClass(selectedAgent.status)"></span>
          <span class="name" [style.color]="selectedAgent.color || ''">{{ selectedAgent.nickname }}</span>
          <span class="model">{{ modelOf(selectedAgent) }}</span>
        </div>
      </header>
      <div class="app-body"><router-outlet /></div>
    </div>
  `,
  styles: [`
    .app-root{display:flex;flex-direction:column;height:100vh}
    .app-header { gap: 16px; padding: 0 20px; flex:0 0 var(--header-height); }
    .brand { display: flex; align-items: center; gap: 8px; }
    .logo { font-size: 20px; color: var(--accent-blue); font-weight: 700; }
    .app-header h1 { font-size: 16px; color: var(--text-primary); font-weight: 600; }
    .nav { display: flex; gap: 4px; margin-left: 16px; }
    .nav a { color: var(--text-secondary); text-decoration: none; font-size: 13px; padding: 6px 10px; border-radius: var(--radius-sm); }
    .nav a:hover,.nav a.active { color: var(--text-primary); background: var(--bg-tertiary); }
    .active-ws{margin-left:auto;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);padding:4px 8px;border:1px solid var(--border-color);border-radius:var(--radius-sm)}
    .selected-agent { margin-left:8px; display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .selected-agent .name { font-family: var(--font-mono); font-weight: 600; }
    .selected-agent .model { color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; }
    .app-body{flex:1;min-height:0;overflow:hidden}
  `],
})
export class AppComponent {
  activeWs: IWorkspace | null = null;
  get selectedAgent(): IAgent | null { return this.selection.selectedAgent; }
  constructor(private selection: AgentSelectionService, private ws: WorkspaceService) { this.ws.active$.subscribe(a=>this.activeWs=a); }
  statusClass(status: string): string { const s = (status||'').toLowerCase(); return s === 'paused' ? 'hold' : s; }
  modelOf(agent: IAgent): string { const ts = agent.task_state as any; return ts?.model ? String(ts.model).split('/').pop() : ''; }
}
