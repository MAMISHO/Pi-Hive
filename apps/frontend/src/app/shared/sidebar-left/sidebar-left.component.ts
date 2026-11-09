import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { AgentService } from '../../core/services/agent.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { AgentSelectionService } from '../../core/services/agent-selection.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { IAgent, AgentStatus } from '../../core/models/agent.model';
import { Subscription } from 'rxjs';
import { CreateAgentModalComponent } from '../create-agent-modal/create-agent-modal.component';

import { DialogModule } from 'primeng/dialog';

@Component({
  selector: 'app-sidebar-left',
  standalone: true,
  imports: [CommonModule, ButtonModule, BadgeModule, CreateAgentModalComponent, DialogModule],
  template: `
    <div class="sidebar-left">
      <div class="header">
        <h2>Agent Roster</h2>
        <div class="header-actions">
          <button pButton type="button" icon="pi pi-cog" class="p-button-text p-button-sm" (click)="openManage()" title="Manage agents"></button>
          <button pButton type="button" label="Create" icon="pi pi-plus" (click)="showCreateModal = true"></button>
        </div>
      </div>
      @if (chiefAgents.length) { <div class="section-label">Chief</div>
        @for (agent of chiefAgents; track agent.id) {
          <div class="agent-card" [class.selected]="selectedId === agent.id" (click)="select(agent)">
            <span class="status-dot" [class]="statusClass(agent.status)" [style.background]="statusBg(agent)"></span>
            <div class="agent-info"><div class="agent-name" [style.color]="agent.color||''">{{ agent.nickname }}</div><div class="agent-model">{{ modelOf(agent) }}</div></div>
            <span class="agent-role">CHIEF</span>
          </div>
        }
      }
      <div class="section-label">Workers</div>
      @for (agent of workers; track agent.id) {
        <div class="agent-card" [class.selected]="selectedId === agent.id" (click)="select(agent)">
          <span class="status-dot" [class]="statusClass(agent.status)" [style.background]="statusBg(agent)"></span>
          <div class="agent-info"><div class="agent-name" [style.color]="agent.color||''">{{ agent.nickname }}</div><div class="agent-model">{{ modelOf(agent) }}</div></div>
        </div>
      } @empty { <div class="empty">No worker agents yet</div> }
      <app-create-agent-modal [(visible)]="showCreateModal" (created)="onAgentCreated($event)"></app-create-agent-modal>
      <p-dialog header="Manage Agents" [(visible)]="showManageModal" [modal]="true" [style]="{width:'640px'}">
        <div class="manage-list">
          @for (a of allAgentsAdmin; track a.id) {
            <div class="manage-row">
              <div class="manage-info"><div class="manage-name" [style.color]="a.color||''">{{ a.nickname }} <span class="manage-id">({{ a.id }})</span></div><div class="manage-meta">workspace: {{ a.workspace_id || '—' }} · role: {{ a.role }}</div></div>
              <button pButton type="button" label="Eliminar" icon="pi pi-trash" severity="danger" class="p-button-sm" (click)="deleteAgent(a)"></button>
            </div>
          }
          @if (!allAgentsAdmin.length) { <div class="empty">No agents</div> }
        </div>
      </p-dialog>
    </div>
  `,
  styles: [`
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.header h2{font-size:14px;font-weight:600;color:var(--text-primary)}
    .section-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px}
    .agent-info{display:flex;flex-direction:column;flex:1;min-width:0}.agent-model{font-size:10px;color:var(--text-muted);font-family:var(--font-mono)}
    .agent-role{font-size:9px;color:var(--accent-purple);font-weight:700}.empty{font-size:12px;color:var(--text-muted);padding:8px 0}
    .manage-list{display:flex;flex-direction:column;gap:8px;max-height:400px;overflow-y:auto}
    .manage-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px;border:1px solid var(--border-color);border-radius:6px}
    .manage-name{font-weight:600;font-size:13px}.manage-id{font-weight:400;font-size:11px;color:var(--text-muted)}.manage-meta{font-size:11px;color:var(--text-muted)}
  `],
})
export class SidebarLeftComponent implements OnInit, OnDestroy {
  chiefAgents: IAgent[] = []; workers: IAgent[] = []; agents: IAgent[] = []; allAgentsAdmin: IAgent[] = [];
  selectedId: string | null = null; showCreateModal = false; showManageModal = false; subs: Subscription[] = []; private _lastWsId: string|null=null;
  constructor(private readonly agentService: AgentService, private readonly ws: WebsocketService, private readonly selection: AgentSelectionService, private readonly workspace: WorkspaceService) {}
  ngOnInit(): void {
    this.loadAgents();
    this.workspace.refreshActive(); this.subs.push(this.workspace.active$.subscribe((ws)=>{ if(ws && ws.id!==this._lastWsId){ this._lastWsId=ws.id; this.loadAgents(); } }));
    this.subs.push(this.ws.statusChange$.subscribe((e) => { const a = this.agents.find((x) => x.id === e.agentId); if (a) a.status = e.status as AgentStatus; this.split(); if (this.selection.selectedAgent?.id === e.agentId && a) this.selection.select(a); }));
    this.subs.push(this.selection.selectedAgent$.subscribe((a) => { this.selectedId = a?.id ?? null; }));
  }
  loadAgents(): void {
    const ws=this.workspace.active;
    this.agentService.getAll().subscribe((list) => {
      const activeId = ws?.id || this.workspace.active?.id;
      this.agents = activeId ? list.filter((a:any)=>a.workspace_id===activeId) : list;
      this.split();
      if(this.agents.length && !this.selection.selectedAgent) this.selection.select(this.agents[0]);
    });
  }
  split(): void { this.chiefAgents = this.agents.filter((a) => a.role === 'CHIEF'); this.workers = this.agents.filter((a) => a.role !== 'CHIEF'); }
  statusClass(status: AgentStatus): string { const s = (status||'').toLowerCase(); return s === 'paused' ? 'hold' : s; }
  statusBg(agent: IAgent): string { return agent.status === 'WORKING' ? (agent.color || '#3b82f6') : ''; }
  modelOf(agent: IAgent): string { const ts = agent.task_state as any; return ts?.model ? String(ts.model).split('/').pop() : agent.name; }
  select(agent: IAgent): void { this.selection.select(agent); }
  onAgentCreated(agent: IAgent): void { this.agents = [...this.agents, agent]; this.split(); }
  openManage(): void { this.showManageModal = true; this.agentService.adminList().subscribe((list) => (this.allAgentsAdmin = list)); }
  deleteAgent(agent: IAgent): void { if (!confirm(`¿Eliminar/desactivar al agente "${agent.nickname}" (${agent.id})?`)) return; this.agentService.deactivate(agent.id).subscribe(() => { this.allAgentsAdmin = this.allAgentsAdmin.filter((a) => a.id !== agent.id); this.loadAgents(); if (this.selection.selectedAgent?.id === agent.id) this.selection.select(null as any); }); }
  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }
}
