import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { TagModule } from 'primeng/tag';
import { LiveConsoleComponent } from '../../shared/live-console/live-console.component';
import { WorkspaceService } from '../../core/services/workspace.service';
import { TaskService } from '../../core/services/task.service';
import { ChatTranscriptService } from '../../core/services/chat-transcript.service';
import { AgentService } from '../../core/services/agent.service';
import { AgentSelectionService } from '../../core/services/agent-selection.service';
import { WebsocketService } from '../../core/services/websocket.service';
import { PromptDraftService } from '../../core/services/prompt-draft.service';
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
          @if (queueDepth > 0) { <span class="queue-badge">{{ queueDepth }} in queue</span> }
          @if (runStateMsg) { <span class="run-msg">{{ runStateMsg }}</span> }
          @if (selectedAgent?.status === 'WORKING' || hasActiveWork()) {
            <button pButton label="Parar" icon="pi pi-stop" severity="danger" class="p-button-sm p-button-outlined" (click)="stopAgent()"></button>
          }
        </div>
      }
      <app-live-console [selectedAgentId]="selectedAgentId"></app-live-console>

      <section class="panel">
        <div class="panel-header">
          <h3>Chat History</h3>
          <span class="count">{{ chatEvents.length }}</span>
        </div>
        <div class="chat-history">
          @for (ev of chatEvents; track (ev.id ?? ev.created_at ?? $index)) {
            <div class="chat-item" [class.system-ev]="ev.kind === 'system_prompt'" [class.inbound]="ev.direction==='INBOUND'" [class.outbound]="ev.direction==='OUTBOUND'">
              <div class="chat-meta">
                <span class="route">
                  @if (ev.kind === 'system_prompt') { <b>🧩 SYSTEM CONTEXT (inyectado por Pi-Hive)</b> }
                  @else if (ev.kind === 'request') { <b>→ Request</b> }
                  @else if (ev.kind === 'response') { <b>← Response</b> }
                  @else if (ev.kind === 'thinking') { <b>💭 Thinking</b> }
                  @else if (ev.kind === 'tool_call') { <b>🔧 Tool</b> }
                  @else { <b>{{ ev.kind }}</b> }
                </span>
                <span class="ts" *ngIf="ev.created_at">{{ ev.created_at | date:'HH:mm:ss' }}</span>
              </div>
              @if (ev.kind === 'system_prompt') {
                <details open class="sys-details"><summary>Prompt del sistema + identidad (contexto multiagente) — inyectado internamente</summary><pre>{{ ev.content }}</pre></details>
              } @else {
                <pre class="ev-body">{{ ev.content }}</pre>
              }
            </div>
          } @empty {
            <p class="empty">No messages yet (el prompt del sistema se mostrará al iniciar/limpiar sesión)</p>
          }
        </div>
      </section>

      <section class="panel prompt-buffer">
        <div class="panel-header">
          <h3>Prompt Buffer</h3>
          @if (hitlEnabled && holdTask) { <span class="badge hold">HOLD</span> } @else if (hitlEnabled) { <span class="badge" style="color:var(--accent-amber)">HITL enabled</span> }
          @else if (selectedAgentId) { <span class="badge compose">COMPOSE</span> }
        </div>
        <div class="prompt-wrap">
          <textarea pTextarea [ngModel]="promptText" (ngModelChange)="onPromptInput($event)" [disabled]="!holdTask && !selectedAgentId" rows="5"
            [placeholder]="holdTask ? 'Edit prompt and release…' : (selectedAgentId ? 'Escribe una tarea o /clear /compact /resume /stop /help' : 'Select an agent first')"></textarea>
          <div class="cmd-ac" *ngIf="showCmds && filteredCmds.length">
            <div class="cmd-item" *ngFor="let c of filteredCmds" (click)="pickCmd(c.cmd)"><b>{{c.cmd}}</b> <span>{{c.desc}}</span></div>
          </div>
        </div>
        <pre class="sysmsg" *ngIf="systemMsg">{{systemMsg}}</pre>
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
    .agent-status-bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-md); font-size: 13px; flex-wrap:wrap; }
    .status-text { color: var(--text-secondary); }
    .queue-badge { font-size: 11px; color: var(--accent-amber); font-family: var(--font-mono); background: rgba(210,153,34,0.12); padding: 2px 8px; border-radius: var(--radius-sm); }
    .run-msg { font-size:11px; color: var(--text-muted); font-family: var(--font-mono); }
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
    .actions { margin-top: 8px; }
    .empty { color: var(--text-muted); font-size: 12px; }
    .system-ev { background: rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.25); border-radius:6px; padding:8px; }
    .sys-details summary { cursor:pointer; font-size:12px; color: var(--accent-blue, #818cf8); margin-bottom:6px; }
    .sys-details pre { white-space: pre-wrap; margin:0; font-size:11px; font-family: var(--font-mono); color: var(--text-secondary); max-height: 240px; overflow:auto; }
    .ev-body { white-space: pre-wrap; margin:0; font-size:12px; font-family: var(--font-mono); }
    .ts { font-size:10px; color: var(--text-muted); font-family: var(--font-mono); }
    .sysmsg { white-space: pre-wrap; font-size:12px; color: var(--text-secondary); margin: 6px 0 0; }
    .prompt-wrap { position: relative; }
    .cmd-ac { position:absolute; left:0; right:0; bottom:100%; background: var(--bg-secondary); border:1px solid var(--border-color); border-radius:6px; margin-bottom:4px; z-index:5; }
    .cmd-item { padding:6px 8px; cursor:pointer; display:flex; gap:8px; font-size:12px; }
    .cmd-item:hover { background: rgba(255,255,255,0.04); }
  `],
})
export class SwarmMonitorComponent implements OnInit, OnDestroy {
  tasks: ITaskQueue[] = [];
  chatEvents: any[] = [];
  selectedAgentId: string | null = null;
  selectedAgent: any = null;
  promptText = '';
  commands = [
    {cmd:'/clear', desc:'Limpiar historial/sesión del agente (nueva sesión)'},
    {cmd:'/compact', desc:'Compactar sesión del agente (resumen, mantiene contexto)'},
    {cmd:'/resume', desc:'Reanudar/mostrar estado de sesión actual'},
    {cmd:'/stop', desc:'Detener tarea en curso del agente'},
    {cmd:'/help', desc:'Ver comandos disponibles'}
  ];
  showCmds = false;
  filteredCmds = this.commands;
  systemMsg = '';
  holdTask: ITaskQueue | null = null;
  hitlEnabled = false;
  queueDepth = 0;
  runStateMsg = '';
  private subs: Subscription[] = [];
  private pendingLoad: any = null;

  constructor(
    private taskService: TaskService,
    private transcript: ChatTranscriptService,
    private agentService: AgentService,
    private selection: AgentSelectionService,
    private ws: WebsocketService,
    private workspaceService: WorkspaceService,
    private drafts: PromptDraftService,
  ) {}

  ngOnInit(): void {
    this.subs.push(this.selection.selectedAgent$.subscribe((a) => {
      // persist draft of previously selected agent, restore draft for new agent (per-agent independent buffers)
      if (this.selectedAgentId) this.drafts.set(this.selectedAgentId, this.promptText);
      this.selectedAgent = a;
      this.selectedAgentId = a?.id ?? null;
      this.promptText = this.drafts.get(this.selectedAgentId);
      this.runStateMsg = '';
      this.queueDepth = 0;
      this.loadBaseline();
    }));

    this.subs.push(this.ws.statusChange$.subscribe((e: any) => {
      if (!e?.agentId) return;
      if (this.selectedAgent && e.agentId === this.selectedAgent.id) {
        this.selectedAgent = { ...this.selectedAgent, status: e.status };
        if (e.status === 'WORKING') this.runStateMsg = 'procesando…';
        if (e.status === 'IDLE') this.runStateMsg = '';
      }
    }));

    this.subs.push(this.ws.queueUpdated$.subscribe((e: any) => {
      if (e?.agentId === this.selectedAgentId) {
        this.queueDepth = e.pendingCount || 0;
        if (this.selectedAgent && this.queueDepth > 0) this.selectedAgent = { ...this.selectedAgent, status: 'WORKING' };
      }
    }));

    this.subs.push(this.ws.runEvent$.subscribe((e: any) => {
      if (e?.agentId !== this.selectedAgentId) return;
      if (e.type === 'started') this.runStateMsg = `trabajando (${e?.model?.raw || e?.model?.modelId || 'modelo'})…`;
      else if (e.type === 'model' && e.state === 'ready') this.runStateMsg = `modelo listo: ${e.provider}/${e.modelId}`;
      else if (e.type === 'warning') this.runStateMsg = `aviso: ${e.message || e.code}`;
      else if (e.type === 'error') this.runStateMsg = `error: ${e.message || e.code}`;
      else if (e.type === 'finished') { this.runStateMsg = e.outcome === 'completed' ? '' : `fin: ${e.outcome}${e.errorMessage ? ' — '+e.errorMessage : ''}`; this.scheduleBaseline(300); }
    }));

    const upsertTask = (t: any) => {
      if (!t || !this.selectedAgentId) return;
      if (t.receiver_agent_id && t.receiver_agent_id !== this.selectedAgentId) return;
      const idx = this.tasks.findIndex(x => x.id === t.id);
      if (idx >= 0) this.tasks[idx] = { ...this.tasks[idx], ...t } as any; else this.tasks = [...this.tasks, t];
      this.tasks.sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));
    };

    this.subs.push(this.ws.taskUpdated$.subscribe((t: any) => {
      const task = t?.task || t; // payload may be task or wrapper
      upsertTask(task);
      if (task?.receiver_agent_id === this.selectedAgentId && (task.status === 'COMPLETED' || task.status === 'HOLD' || task.status === 'STOPPED')) this.scheduleBaseline(250);
    }));
    this.subs.push(this.ws.taskChanged$.subscribe((e: any) => { if (e?.task) upsertTask(e.task); if (e?.status === 'COMPLETED' || e?.status === 'HOLD' || e?.status === 'STOPPED') this.scheduleBaseline(250); }));

    this.subs.push(this.ws.tasksCleared$.subscribe((e:any) => { if (!e?.workspaceId || e.workspaceId === this.workspaceService.active?.id) { this.tasks = []; } }));
    this.subs.push(this.ws.transcriptCleared$.subscribe((e:any)=>{ if(!this.selectedAgentId || e?.agentId===this.selectedAgentId){ this.tasks=[]; this.chatEvents=[]; this.systemMsg='Chat limpiado y archivado en Memory > Session History.'; this.scheduleBaseline(500); } }));

    // reconnect rehydration (fallback): baseline GET once per reconnect, not per event
    this.subs.push(this.ws.rehydrate$.subscribe(() => this.scheduleBaseline(150)));

    this.loadBaseline();
  }

  private scheduleBaseline(ms: number) {
    clearTimeout(this.pendingLoad);
    this.pendingLoad = setTimeout(() => this.loadBaseline(), ms);
  }

  loadBaseline(): void {
    // HTTP baseline/hydration only (initial, reconnect, explicit). Realtime uses WS patch events.
    if (this.selectedAgentId) {
      this.taskService.getByReceiver(this.selectedAgentId).subscribe({ next: (list) => { this.tasks = list || []; }, error: () => {} });
      this.transcript.getByAgent(this.selectedAgentId).subscribe({ next: (ev) => this.chatEvents = ev || [], error: () => {} });
    } else {
      this.taskService.getAll().subscribe({ next: (list) => { this.tasks = list || []; }, error: () => {} });
      this.chatEvents = [];
    }
  }

  statusClass(status: string): string {
    const s = (status || '').toLowerCase();
    return s === 'paused' ? 'hold' : s;
  }

  statusLabel(status: string): string {
    switch (status) {
      case 'WORKING': return 'Working — procesando (cargando modelo/razonando)…';
      case 'PAUSED': return 'Paused — waiting for human approval';
      case 'IDLE': return 'Idle — ready for tasks';
      default: return status || 'Unknown';
    }
  }

  onPromptInput(v: string): void {
    this.promptText = v;
    this.drafts.set(this.selectedAgentId, v); // per-agent live draft
    if (v.startsWith('/') && !v.includes(' ')) { this.showCmds = true; this.filteredCmds = this.commands.filter(c => c.cmd.startsWith(v)); }
    else this.showCmds = false;
  }
  pickCmd(c: string): void { this.promptText = c; this.drafts.set(this.selectedAgentId, c); this.showCmds = false; }
  runCommand(raw: string): boolean {
    const cmd = raw.trim().split(/\s+/)[0];
    if (!cmd.startsWith('/')) return false;
    const id = this.selectedAgentId;
    if (cmd === '/help') { this.systemMsg = this.commands.map(c=>`${c.cmd} — ${c.desc}`).join('\n'); return true; }
    if (!id) { this.systemMsg = 'Selecciona un agente.'; return true; }
    if (cmd === '/clear') { this.agentService.clearSession(id).subscribe({next:()=>{ this.tasks=[]; this.chatEvents=[]; this.systemMsg='Sesión limpiada y chat archivado en Memory > Session History. Próxima tarea abrirá sesión nueva (prompt del sistema reinyectado).'; this.scheduleBaseline(600); }, error:(e)=>this.systemMsg='Error: '+(e?.error?.message||e.message)}); return true; }
    if (cmd === '/compact') { this.agentService.compactSession(id).subscribe({next:()=>this.systemMsg='Sesión compactada (resumen aplicado).', error:(e)=>this.systemMsg='Error: '+(e?.error?.message||e.message)}); return true; }
    if (cmd === '/resume') { this.systemMsg = 'Sesión actual activa para el agente. Usa /compact para resumir contexto o /clear para nueva sesión.'; return true; }
    if (cmd === '/stop') { this.agentService.stop(id).subscribe({next:()=>this.systemMsg='Agente detenido (IDLE).', error:(e)=>this.systemMsg='Error: '+(e?.error?.message||e.message)}); return true; }
    return false;
  }

  liberar(): void {
    if (!this.holdTask) return;
    const id = this.holdTask.id;
    this.taskService.updatePayload(id, this.promptText).subscribe({
      next: () => { this.taskService.updateStatus(id, 'PENDING').subscribe(() => this.scheduleBaseline(150)); },
      error: () => {},
    });
  }

  sendTask(): void {
    if (!this.selectedAgentId || !this.promptText.trim()) return;
    if (this.runCommand(this.promptText)) { this.promptText=''; this.drafts.clear(this.selectedAgentId); this.showCmds=false; return; }
    const wsId = this.workspaceService.active?.id || null;
    const agentId = this.selectedAgentId;
    const payload = this.promptText.trim();
    const task: any = { sender_agent_id: 'user', receiver_agent_id: agentId, payload, status: 'PENDING', parent_task_id: null, workspace_id: wsId };
    // optimistic busy feedback
    if (this.selectedAgent) this.selectedAgent = { ...this.selectedAgent, status: 'WORKING' };
    this.runStateMsg = 'enviando tarea…';
    this.taskService.create(task).subscribe({
      next: (created) => {
        this.promptText = '';
        this.drafts.clear(agentId); // clear draft on successful send (per-agent independent)
        this.showCmds = false;
        if (created) this.tasks = [...this.tasks, created as any].sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));
        // no full reload; WS task:changed/status/queue/run events drive realtime state
      },
      error: (e) => { this.runStateMsg = 'error al enviar: ' + (e?.error?.message || e?.message || ''); /* keep draft on failure */ },
    });
  }

  short(id: string): string { return id ? id.slice(0, 8) : ''; }

  severity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' {
    switch (status) {
      case 'COMPLETED': return 'success';
      case 'PROCESSING': return 'info';
      case 'HOLD': case 'STOPPED': return 'warn';
      case 'PENDING': return 'secondary';
      default: return 'contrast';
    }
  }

  hasActiveWork(): boolean {
    if (this.selectedAgent?.status === 'WORKING') return true;
    return this.tasks.some(t => t.receiver_agent_id === this.selectedAgentId && (t.status === 'PROCESSING' || t.status === 'PENDING'));
  }

  stopAgent(): void {
    if (!this.selectedAgentId) return;
    this.agentService.stop(this.selectedAgentId).subscribe({ next: () => this.scheduleBaseline(150), error: () => {} });
  }

  ngOnDestroy(): void {
    if (this.selectedAgentId) this.drafts.set(this.selectedAgentId, this.promptText);
    clearTimeout(this.pendingLoad);
    this.subs.forEach((s) => s.unsubscribe());
  }
}