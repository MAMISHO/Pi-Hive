import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { Subscription, filter } from 'rxjs';
import { AgentSelectionService } from './core/services/agent-selection.service';
import { WorkspaceService, IWorkspace } from './core/services/workspace.service';
import { AgentService } from './core/services/agent.service';
import { WebsocketService } from './core/services/websocket.service';
import { UiLayoutService } from './core/services/ui-layout.service';
import { UiFeedbackService } from './core/services/ui-feedback.service';
import { UiFeedbackComponent } from './shared/ui-feedback/ui-feedback.component';
import { IAgent } from './core/models/agent.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, ButtonModule, UiFeedbackComponent],
  template: `
    <div class="app-root">
      <header class="app-header">
        <div class="brand"><span class="logo">π</span><h1>Pi-Hive</h1></div>
        <nav class="nav">
          <a routerLink="/workspaces" routerLinkActive="active">Workspaces</a>
          @if (!onWorkspacesPage) {
            <a routerLink="/swarm-monitor" routerLinkActive="active">Swarm</a>
            <a routerLink="/memory-timeline" routerLinkActive="active">Memory</a>
            <a routerLink="/human-in-the-loop" routerLinkActive="active">HITL</a>
          }
        </nav>
        <div class="ws-actions" *ngIf="activeWs && !onWorkspacesPage">
          <span class="ws-context" [title]="activeWs.path">
            <span class="ws-path">{{ shortPath(activeWs.path) }}</span>
            <span class="ws-sep">/</span>
            <span class="ws-name">{{ activeWs.name }}</span>
          </span>
          <button pButton type="button" icon="pi pi-refresh" label="Limpiar sesiones" class="p-button-text p-button-sm" (click)="clearAllSessions()" [disabled]="anyBusy" title="Limpia todas las sesiones (desactivado si hay agentes trabajando)"></button>
          <button pButton type="button" icon="pi pi-stop-circle" label="Parar todo" class="p-button-text p-button-sm p-button-danger" (click)="stopAll()" [disabled]="!anyBusy" title="Detiene todas las tareas en curso (activo solo si hay agentes trabajando)"></button>
        </div>
        <div class="header-right">
          <div class="selected-agent" *ngIf="selectedAgent && !onWorkspacesPage">
            <span class="status-dot" [class]="statusClass(selectedAgent.status)"></span>
            <span class="name" [style.color]="selectedAgent.color || ''">{{ selectedAgent.nickname }}</span>
            <span class="model">{{ modelOf(selectedAgent) }}</span>
          </div>
          <button *ngIf="!onWorkspacesPage" type="button" class="panel-toggle" (click)="ui.toggleRightPanel()" [attr.aria-expanded]="ui.rightPanelOpen" [title]="ui.rightPanelOpen ? 'Cerrar Task lineage' : 'Abrir Task lineage'" [attr.aria-label]="ui.rightPanelOpen ? 'Cerrar Task lineage' : 'Abrir Task lineage'">
            <span class="panel-icon" [class.open]="ui.rightPanelOpen" aria-hidden="true">
              <span class="bar"></span>
              <span class="arrow"></span>
            </span>
          </button>
        </div>
      </header>
      <div class="app-body"><router-outlet /></div>
      <app-ui-feedback />
    </div>
  `,
  styles: [`
    .app-root{display:flex;flex-direction:column;height:100vh}
    .app-header { gap: 16px; padding: 0 16px 0 20px; flex:0 0 var(--header-height); }
    .brand { display: flex; align-items: center; gap: 8px; }
    .logo { font-size: 20px; color: var(--accent-blue); font-weight: 700; }
    .app-header h1 { font-size: 16px; color: var(--text-primary); font-weight: 600; }
    .nav { display: flex; gap: 4px; margin-left: 16px; }
    .nav a { color: var(--text-secondary); text-decoration: none; font-size: 13px; padding: 6px 10px; border-radius: var(--radius-sm); }
    .nav a:hover,.nav a.active { color: var(--text-primary); background: var(--bg-tertiary); }
    .ws-actions{display:flex;align-items:center;gap:8px;min-width:0;margin-left:auto}
    .ws-context{display:inline-flex;align-items:center;gap:4px;max-width:340px;min-width:0;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);padding:4px 8px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:rgba(255,255,255,0.01)}
    .ws-path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.8}
    .ws-sep{opacity:.5}
    .ws-name{color:var(--text-secondary);font-weight:600;white-space:nowrap}
    .header-right{display:flex;align-items:center;gap:10px;margin-left:auto}
    .ws-actions + .header-right{margin-left:8px}
    .panel-toggle{width:34px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--border-color);background:rgba(255,255,255,0.02);color:var(--text-secondary);border-radius:8px;cursor:pointer;transition:background var(--transition-fast),color var(--transition-fast),border-color var(--transition-fast);flex:0 0 auto}
    .panel-toggle:hover{background:rgba(255,255,255,0.06);color:var(--text-primary);border-color:var(--text-muted)}
    .panel-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:12px}
    .panel-icon .bar{position:absolute;right:0;top:0;bottom:0;width:4px;border:1.5px solid currentColor;border-radius:2px;box-sizing:border-box}
    .panel-icon .arrow{position:absolute;left:0;top:50%;width:7px;height:1.5px;background:currentColor;border-radius:2px;transform:translateY(-50%) rotate(180deg)}
    .panel-icon .arrow::after{content:'';position:absolute;right:0;top:50%;width:5px;height:5px;border-top:1.5px solid currentColor;border-right:1.5px solid currentColor;transform:translateY(-50%) rotate(45deg)}
    .panel-icon.open .arrow{left:0;right:auto;transform:translateY(-50%) rotate(0deg)}
    .selected-agent { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .selected-agent .name { font-family: var(--font-mono); font-weight: 600; }
    .selected-agent .model { color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; }
    .app-body{flex:1;min-height:0;overflow:hidden}
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  activeWs: IWorkspace | null = null;
  agents: IAgent[] = [];
  anyBusy = false;
  onWorkspacesPage = false;
  private subs: Subscription[] = [];
  get selectedAgent(): IAgent | null { return this.selection.selectedAgent; }
  constructor(private selection: AgentSelectionService, private ws: WorkspaceService, private agentService: AgentService, private socket: WebsocketService, private router: Router, public ui: UiLayoutService, private feedback: UiFeedbackService) {
    this.ws.active$.subscribe(a=>{ this.activeWs=a; this.loadAgents(); });
    this.onWorkspacesPage = this.router.url.startsWith('/workspaces');
    this.subs.push(this.router.events.pipe(filter(e => e instanceof NavigationEnd)).subscribe((e: any) => {
      this.onWorkspacesPage = (e.urlAfterRedirects || e.url || '').startsWith('/workspaces');
    }));
  }
  ngOnInit(): void {
    this.subs.push(this.socket.statusChange$.subscribe((e:any)=>{ const a=this.agents.find(x=>x.id===e?.agentId); if(a) (a as any).status = e.status; this.computeBusy(); }));
    this.subs.push(this.socket.queueUpdated$.subscribe((e:any)=>{ this.computeBusy(); }));
  }
  loadAgents(): void {
    const id = this.activeWs?.id; if(!id){ this.agents=[]; this.computeBusy(); return; }
    this.agentService.getAll().subscribe(list => { this.agents = (list||[]).filter((a:any)=>a.workspace_id===id); this.computeBusy(); });
  }
  shortPath(p: string): string {
    if (!p) return '';
    const parts = p.split('/').filter(Boolean);
    if (parts.length <= 2) return p;
    return '…/' + parts.slice(-2, -1).join('/');
  }
  computeBusy(): void { this.anyBusy = (this.agents||[]).some(a => (a.status as any) === 'WORKING'); }
  async clearAllSessions(): Promise<void> {
    if (!this.activeWs || this.anyBusy) return;
    const ok = await this.feedback.confirm({ title: 'Limpiar sesiones', message: '¿Limpiar todas las sesiones de los agentes del workspace (en orden)?\nSe archivará el historial.', confirmLabel: 'Limpiar sesiones', danger: true });
    if (!ok) return;
    this.ws.clearAllSessions(this.activeWs.id).subscribe({
      next: (r:any)=>{ if (r?.ok) this.feedback.success(`Sesiones limpiadas (${r.cleared||0}).`); else this.feedback.warn(`No se pudo limpiar: ${ (r?.busy||[]).join(', ') || 'agentes ocupados' }`); this.loadAgents(); },
      error: (e)=> this.feedback.error(e?.error?.message || 'Error limpiando sesiones')
    });
  }
  async stopAll(): Promise<void> {
    if (!this.activeWs || !this.anyBusy) return;
    const ok = await this.feedback.confirm({ title: 'Parar todo', message: '¿Parar todo el harness del workspace?\nSe detendrán las tareas en curso de todos los agentes.', confirmLabel: 'Parar todo', danger: true });
    if (!ok) return;
    this.ws.stopAll(this.activeWs.id).subscribe({
      next: (r:any)=>{ this.feedback.success(`Stop enviado (agentes detenidos: ${r?.stopped ?? 0}).`); this.loadAgents(); },
      error: (e)=> this.feedback.error(e?.error?.message || 'Error deteniendo agentes')
    });
  }
  statusClass(status: string): string { const s = (status||'').toLowerCase(); return s === 'paused' ? 'hold' : s; }
  modelOf(agent: IAgent): string { const ts = agent.task_state as any; return ts?.model ? String(ts.model).split('/').pop() : ''; }
  ngOnDestroy(): void { this.subs.forEach(s=>s.unsubscribe()); }
}
