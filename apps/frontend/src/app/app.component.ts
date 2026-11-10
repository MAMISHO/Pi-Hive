import { Component, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { Subscription } from 'rxjs';
import { AgentSelectionService } from './core/services/agent-selection.service';
import { WorkspaceService, IWorkspace } from './core/services/workspace.service';
import { AgentService } from './core/services/agent.service';
import { WebsocketService } from './core/services/websocket.service';
import { IAgent } from './core/models/agent.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CommonModule, ButtonModule],
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
        <div class="ws-actions" *ngIf="activeWs">
          <span class="active-ws" title="{{activeWs.path}}">WS: {{ activeWs.name }}</span>
          <button pButton type="button" icon="pi pi-refresh" label="Limpiar sesiones" class="p-button-text p-button-sm" (click)="clearAllSessions()" [disabled]="anyBusy" title="Limpia todas las sesiones (desactivado si hay agentes trabajando)"></button>
          <button pButton type="button" icon="pi pi-stop-circle" label="Parar todo" class="p-button-text p-button-sm p-button-danger" (click)="stopAll()" [disabled]="!anyBusy" title="Detiene todas las tareas en curso (activo solo si hay agentes trabajando)"></button>
        </div>
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
    .ws-actions{margin-left:auto;display:flex;align-items:center;gap:6px}
    .active-ws{font-size:11px;color:var(--text-muted);font-family:var(--font-mono);padding:4px 8px;border:1px solid var(--border-color);border-radius:var(--radius-sm)}
    .selected-agent { margin-left:8px; display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .selected-agent .name { font-family: var(--font-mono); font-weight: 600; }
    .selected-agent .model { color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; }
    .app-body{flex:1;min-height:0;overflow:hidden}
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  activeWs: IWorkspace | null = null;
  agents: IAgent[] = [];
  anyBusy = false;
  private subs: Subscription[] = [];
  get selectedAgent(): IAgent | null { return this.selection.selectedAgent; }
  constructor(private selection: AgentSelectionService, private ws: WorkspaceService, private agentService: AgentService, private socket: WebsocketService) { this.ws.active$.subscribe(a=>{ this.activeWs=a; this.loadAgents(); }); }
  ngOnInit(): void {
    this.subs.push(this.socket.statusChange$.subscribe((e:any)=>{ const a=this.agents.find(x=>x.id===e?.agentId); if(a) (a as any).status = e.status; this.computeBusy(); }));
    this.subs.push(this.socket.queueUpdated$.subscribe((e:any)=>{ /* queue implies work soon; status events drive busy */ this.computeBusy(); }));
  }
  loadAgents(): void {
    const id = this.activeWs?.id; if(!id){ this.agents=[]; this.computeBusy(); return; }
    this.agentService.getAll().subscribe(list => { this.agents = (list||[]).filter((a:any)=>a.workspace_id===id); this.computeBusy(); });
  }
  computeBusy(): void { this.anyBusy = (this.agents||[]).some(a => (a.status as any) === 'WORKING'); }
  clearAllSessions(): void {
    if (!this.activeWs || this.anyBusy) return;
    if (!confirm('¿Limpiar todas las sesiones de los agentes del workspace (en orden)? Se archivará el historial.')) return;
    this.ws.clearAllSessions(this.activeWs.id).subscribe({ next: (r:any)=>{ alert(r?.ok ? `Sesiones limpiadas (${r.cleared||0}).` : `No se pudo limpiar: ${ (r?.busy||[]).join(', ') || 'agentes ocupados' }`); this.loadAgents(); }, error: (e)=> alert(e?.error?.message || 'Error limpiando sesiones') });
  }
  stopAll(): void {
    if (!this.activeWs || !this.anyBusy) return;
    if (!confirm('¿Parar todo el harness del workspace? Se detendrán las tareas en curso de todos los agentes.')) return;
    this.ws.stopAll(this.activeWs.id).subscribe({ next: (r:any)=>{ alert(`Stop enviado (agentes detenidos: ${r?.stopped ?? 0}).`); this.loadAgents(); }, error: (e)=> alert(e?.error?.message || 'Error deteniendo agentes') });
  }
  statusClass(status: string): string { const s = (status||'').toLowerCase(); return s === 'paused' ? 'hold' : s; }
  modelOf(agent: IAgent): string { const ts = agent.task_state as any; return ts?.model ? String(ts.model).split('/').pop() : ''; }
  ngOnDestroy(): void { this.subs.forEach(s=>s.unsubscribe()); }
}
