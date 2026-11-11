import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { AgentService } from '../../core/services/agent.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { AgentSelectionService } from '../../core/services/agent-selection.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { UiFeedbackService } from '../../core/services/ui-feedback.service';
import { IAgent, AgentStatus } from '../../core/models/agent.model';
import { Subscription } from 'rxjs';
import { CreateAgentModalComponent } from '../create-agent-modal/create-agent-modal.component';

@Component({
  selector: 'app-sidebar-left',
  standalone: true,
  imports: [CommonModule, ButtonModule, CreateAgentModalComponent],
  template: `
    <div class="sidebar-left">
      <div class="header">
        <h2>Agent Roster</h2>
        <div class="header-actions">
          <button pButton type="button" label="Create" icon="pi pi-plus" class="p-button-sm" (click)="openCreate()"></button>
        </div>
      </div>
      @if (chiefAgents.length) { <div class="section-label">Chief</div>
        @for (agent of chiefAgents; track agent.id) {
          <div class="agent-card" [class.selected]="selectedId === agent.id" (click)="select(agent)">
            <span class="status-dot" [class]="statusClass(agent.status)" [class.is-active]="isActive(agent)" [style.--agent-color]="agent.color || statusBg(agent)"></span>
            <span class="agent-kind" [class.independent]="!hasContext(agent)" [title]="hasContext(agent) ? 'Agente con contexto de equipo' : 'Agente independiente (sin contexto)'">
              @if (hasContext(agent)) {
                <svg viewBox="0 0 16 16" aria-hidden="true" class="kind-icon hive"><polygon points="8,1.5 12.8,4.2 12.8,9.8 8,12.5 3.2,9.8 3.2,4.2" /><polygon points="3.2,1 5.6,2.4 5.6,5 3.2,6.4 0.8,5 0.8,2.4" transform="translate(1.2,0.2) scale(0.7)" /><polygon points="12.8,1 15.2,2.4 15.2,5 12.8,6.4 10.4,5 10.4,2.4" transform="translate(-0.4,0.2) scale(0.7)" /></svg>
              } @else {
                <svg viewBox="0 0 16 16" aria-hidden="true" class="kind-icon bot"><rect x="3" y="5" width="10" height="7" rx="2" /><circle cx="6" cy="8.5" r="1" /><circle cx="10" cy="8.5" r="1" /><path d="M8 3v2M5.5 12v1.5M10.5 12v1.5M1.8 8.5h1.2M13 8.5h1.2" /></svg>
              }
            </span>
            <div class="agent-info">
              <div class="name-row"><span class="agent-name" [style.color]="agent.color||''">{{ agent.nickname }}</span><span class="agent-role">CHIEF</span></div>
              <div class="status-line" [class.live]="isActive(agent)">
                <span class="status-label">{{ statusLabel(agent) }}</span>
                @if (queueDepth(agent.id) > 0) { <span class="q-mini">{{ queueDepth(agent.id) }} in queue</span> }
              </div>
              <div class="agent-model">{{ modelOf(agent) }}</div>
            </div>
            <div class="row-actions">
              <button type="button" class="more-btn" title="Opciones del agente" aria-label="Opciones del agente" (click)="toggleMenu(agent, $event)">
                <i class="pi pi-ellipsis-v"></i>
              </button>
              @if (menuFor === agent.id) {
                <div class="agent-menu" (click)="$event.stopPropagation()">
                  <button type="button" class="menu-item" (click)="editAgent(agent, $event)"><i class="pi pi-pencil"></i><span>Editar agente</span></button>
                  <button type="button" class="menu-item danger" [disabled]="isBusy(agent)" (click)="deleteAgent(agent, $event)"><i class="pi pi-trash"></i><span>Eliminar agente</span></button>
                </div>
              }
            </div>
          </div>
        }
      }
      <div class="section-label">Workers</div>
      @for (agent of workers; track agent.id) {
        <div class="agent-card" [class.selected]="selectedId === agent.id" (click)="select(agent)">
          <span class="status-dot" [class]="statusClass(agent.status)" [class.is-active]="isActive(agent)" [style.--agent-color]="agent.color || statusBg(agent)"></span>
          <span class="agent-kind" [class.independent]="!hasContext(agent)" [title]="hasContext(agent) ? 'Agente con contexto de equipo' : 'Agente independiente (sin contexto)'">
            @if (hasContext(agent)) {
              <svg viewBox="0 0 16 16" aria-hidden="true" class="kind-icon hive"><polygon points="8,1.5 12.8,4.2 12.8,9.8 8,12.5 3.2,9.8 3.2,4.2" /><polygon points="3.2,1 5.6,2.4 5.6,5 3.2,6.4 0.8,5 0.8,2.4" transform="translate(1.2,0.2) scale(0.7)" /><polygon points="12.8,1 15.2,2.4 15.2,5 12.8,6.4 10.4,5 10.4,2.4" transform="translate(-0.4,0.2) scale(0.7)" /></svg>
            } @else {
              <svg viewBox="0 0 16 16" aria-hidden="true" class="kind-icon bot"><rect x="3" y="5" width="10" height="7" rx="2" /><circle cx="6" cy="8.5" r="1" /><circle cx="10" cy="8.5" r="1" /><path d="M8 3v2M5.5 12v1.5M10.5 12v1.5M1.8 8.5h1.2M13 8.5h1.2" /></svg>
            }
          </span>
          <div class="agent-info">
            <div class="name-row"><span class="agent-name" [style.color]="agent.color||''">{{ agent.nickname }}</span></div>
            <div class="status-line" [class.live]="isActive(agent)">
              <span class="status-label">{{ statusLabel(agent) }}</span>
              @if (queueDepth(agent.id) > 0) { <span class="q-mini">{{ queueDepth(agent.id) }} in queue</span> }
            </div>
            <div class="agent-model">{{ modelOf(agent) }}</div>
          </div>
          <div class="row-actions">
            <button type="button" class="more-btn" title="Opciones del agente" aria-label="Opciones del agente" (click)="toggleMenu(agent, $event)">
              <i class="pi pi-ellipsis-v"></i>
            </button>
            @if (menuFor === agent.id) {
              <div class="agent-menu" (click)="$event.stopPropagation()">
                <button type="button" class="menu-item" (click)="editAgent(agent, $event)"><i class="pi pi-pencil"></i><span>Editar agente</span></button>
                <button type="button" class="menu-item danger" [disabled]="isBusy(agent)" (click)="deleteAgent(agent, $event)"><i class="pi pi-trash"></i><span>Eliminar agente</span></button>
              </div>
            }
          </div>
        </div>
      } @empty { <div class="empty">No worker agents yet</div> }
      <app-create-agent-modal [(visible)]="showCreateModal" [agent]="editingAgent" (created)="onAgentCreated($event)" (updated)="onAgentUpdated($event)"></app-create-agent-modal>
    </div>
  `,
  styles: [`
    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}.header h2{font-size:14px;font-weight:600;color:var(--text-primary)}
    .section-label{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px}
    .agent-card{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:10px;cursor:pointer;border:1px solid transparent;position:relative}
    .agent-card:hover{background:rgba(255,255,255,0.03);border-color:var(--border-color)} .agent-card.selected{background:rgba(59,130,246,0.08);border-color:rgba(59,130,246,0.25)}
    .agent-info{display:flex;flex-direction:column;flex:1;min-width:0;gap:2px}
    .name-row{display:flex;align-items:center;gap:6px}
    .agent-name{font-weight:600;font-size:14px;line-height:1.2}
    .agent-model{font-size:10px;color:var(--text-muted);font-family:var(--font-mono)}

    .agent-kind{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;color:var(--accent-amber,#f59e0b)}
    .agent-kind.independent{color:var(--text-secondary)}
    .kind-icon{width:14px;height:14px;display:block}
    .kind-icon.hive polygon{fill:currentColor;fill-opacity:.18;stroke:currentColor;stroke-width:1.1;stroke-linejoin:round}
    .kind-icon.bot rect,.kind-icon.bot circle,.kind-icon.bot path{fill:none;stroke:currentColor;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}
    .kind-icon.bot circle{fill:currentColor;stroke:none}
    .status-line{display:flex;align-items:center;gap:6px;min-height:16px}
    .status-label{font-size:11px;color:var(--text-secondary);line-height:1.2}
    .status-line.live .status-label{background:linear-gradient(90deg,var(--text-secondary) 0%,var(--agent-color,var(--accent-blue)) 45%,var(--text-secondary) 90%);background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:shimmer-agent 1.8s ease-in-out infinite}
    @keyframes shimmer-agent{0%{background-position:100% 0}100%{background-position:-100% 0}}
    .q-mini{font-size:10px;color:var(--accent-amber);font-family:var(--font-mono);background:rgba(210,153,34,0.12);padding:1px 6px;border-radius:999px}
    .agent-role{font-size:9px;color:var(--accent-purple);font-weight:700;letter-spacing:.04em}
    .empty{font-size:12px;color:var(--text-muted);padding:8px 0}
    .row-actions{position:relative;margin-left:auto;flex-shrink:0}
    .more-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;color:var(--text-muted);border-radius:6px;cursor:pointer}
    .more-btn:hover{background:rgba(255,255,255,0.05);color:var(--text-primary);border-color:var(--border-color)}
    .agent-menu{position:absolute;right:0;top:30px;min-width:170px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:10px;box-shadow:var(--shadow-md);padding:6px;z-index:20}
    .menu-item{width:100%;display:flex;align-items:center;gap:8px;padding:8px 10px;border:0;background:transparent;color:var(--text-primary);font-size:13px;border-radius:8px;cursor:pointer;text-align:left}
    .menu-item:hover{background:rgba(255,255,255,0.05)}
    .menu-item.danger{color:var(--accent-red,#f85149)}
    .menu-item:disabled{opacity:.45;cursor:not-allowed}
    .status-dot{width:10px;height:10px;border-radius:50%;margin-top:5px;flex-shrink:0;background:var(--text-muted)}
    .status-dot.is-active{background:var(--agent-color,var(--accent-blue));box-shadow:0 0 0 0 rgba(88,166,255,0.45);animation:agent-pulse 1.4s ease-in-out infinite}
    @keyframes agent-pulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(88,166,255,0.45)}50%{transform:scale(1.08);box-shadow:0 0 0 5px rgba(88,166,255,0)}}
    @media (prefers-reduced-motion: reduce){.status-line.live .status-label,.status-dot.is-active{animation:none}.status-line.live .status-label{color:var(--agent-color,var(--accent-blue));background:none;-webkit-text-fill-color:currentColor}}
  `],
})
export class SidebarLeftComponent implements OnInit, OnDestroy {
  chiefAgents: IAgent[] = []; workers: IAgent[] = []; agents: IAgent[] = [];
  selectedId: string | null = null; showCreateModal = false; editingAgent: IAgent | null = null; subs: Subscription[] = []; private _lastWsId: string|null=null;
  menuFor: string | null = null;
  private queueCounts = new Map<string, number>();
  constructor(private readonly agentService: AgentService, private readonly ws: WebsocketService, private readonly selection: AgentSelectionService, private readonly workspace: WorkspaceService, private readonly feedback: UiFeedbackService) {}
  ngOnInit(): void {
    this.loadAgents();
    this.workspace.refreshActive(); this.subs.push(this.workspace.active$.subscribe((ws)=>{ if(ws && ws.id!==this._lastWsId){ this._lastWsId=ws.id; this.loadAgents(); } }));
    this.subs.push(this.ws.statusChange$.subscribe((e) => { const a = this.agents.find((x) => x.id === e.agentId); if (a) a.status = e.status as AgentStatus; this.split(); if (this.selection.selectedAgent?.id === e.agentId && a) this.selection.select(a); }));
    this.subs.push(this.selection.selectedAgent$.subscribe((a) => { this.selectedId = a?.id ?? null; }));
    this.subs.push(this.ws.queueUpdated$.subscribe((e: any) => { if (e?.agentId) this.queueCounts.set(e.agentId, e.pendingCount || 0); }));
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
  statusBg(agent: IAgent): string { return agent.color || 'var(--accent-blue)'; }
  isActive(agent: IAgent): boolean { return agent.status === 'WORKING'; }
  queueDepth(id: string): number { return this.queueCounts.get(id) || 0; }
  hasContext(agent: IAgent): boolean { return (agent as any).inject_context !== false; }
  statusLabel(agent: IAgent): string {
    switch (agent.status) {
      case 'WORKING': return 'Working — procesando';
      case 'PAUSED': return 'Paused — en espera de aprobación';
      case 'IDLE': return 'Idle — disponible';
      default: return agent.status || 'Desconocido';
    }
  }
  toggleMenu(agent: IAgent, ev: Event): void { ev.stopPropagation(); this.menuFor = this.menuFor === agent.id ? null : agent.id; }
  @HostListener('document:click') closeMenu(): void { this.menuFor = null; }
  modelOf(agent: IAgent): string { const ts = agent.task_state as any; return ts?.model ? String(ts.model).split('/').pop() : agent.name; }
  select(agent: IAgent): void { this.selection.select(agent); }
  isBusy(agent: IAgent): boolean { return (agent.status as any) === 'WORKING'; }
  openCreate(): void { this.editingAgent = null; this.showCreateModal = true; }
  editAgent(agent: IAgent, ev?: Event): void { ev?.stopPropagation(); this.menuFor = null; this.editingAgent = { ...agent }; this.showCreateModal = true; }
  onAgentCreated(agent: IAgent): void { this.agents = [...this.agents, agent]; this.split(); this.editingAgent = null; }
  onAgentUpdated(agent: IAgent): void { this.agents = this.agents.map(a => a.id === agent.id ? { ...a, ...agent } : a); this.split(); if (this.selection.selectedAgent?.id === agent.id) this.selection.select(this.agents.find(a=>a.id===agent.id) as any); this.editingAgent = null; this.loadAgents(); }
  async deleteAgent(agent: IAgent, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    this.menuFor = null;
    if (this.isBusy(agent)) return;
    const ok = await this.feedback.confirm({ title: 'Eliminar agente', message: `¿Eliminar al agente "${agent.nickname}"?\nEsta acción no se puede deshacer.`, confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    this.agentService.deactivate(agent.id).subscribe({
      next: () => {
        this.agents = this.agents.filter((a) => a.id !== agent.id); this.split();
        if (this.selection.selectedAgent?.id === agent.id) this.selection.select(this.agents[0] || null as any);
        this.feedback.success(`Agente "${agent.nickname}" eliminado.`);
        this.loadAgents();
      },
      error: () => this.feedback.error('No se pudo eliminar el agente.')
    });
  }
  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }
}
