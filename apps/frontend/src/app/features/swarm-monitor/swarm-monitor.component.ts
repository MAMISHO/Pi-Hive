import { Component, OnInit, OnDestroy, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { TagModule } from 'primeng/tag';
import { render as renderMermaid } from 'grok-mermaid';
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
    <div class="swarm-monitor" [class.prompt-expanded]="isPromptExpanded()">
      <section class="panel chat-panel">
        <div class="panel-header chat-header">
          <h3 class="chat-title">Chat</h3>
          <span class="count">{{ chatEvents.length }}</span>
        </div>
        <div class="chat-history" #chatHistory (scroll)="onChatScroll($event)">
          @for (ev of chatEvents; track eventKey(ev, $index); let i = $index) {
            <div class="chat-item" [class.system-ev]="ev.kind === 'system_prompt'" [class.inbound]="ev.direction==='INBOUND'" [class.outbound]="ev.direction==='OUTBOUND'" [class.kind-request]="ev.kind==='request'" [class.user-request]="ev.kind==='request' && !isDelegatedRequest(ev)" [class.delegated-request]="ev.kind==='request' && isDelegatedRequest(ev)" [class.kind-response]="ev.kind==='response'" [class.kind-thinking]="ev.kind==='thinking'" [class.kind-tool]="ev.kind==='tool_group' || ev.kind==='tool_call'" [class.kind-plan]="ev.kind==='plan'">
              <div class="chat-meta">
                <span class="route">
                  @if (ev.kind === 'system_prompt') { <span class="kchip sys">SYSTEM</span><span class="klabel">Contexto del sistema</span> }
                  @else if (ev.kind === 'plan') { <span class="kchip plan">PLAN</span><span class="klabel">Plan de delegación</span> }
                  @else if (ev.kind === 'request' && isDelegatedRequest(ev)) {
                    <span class="req-icon agent" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="10" height="8" rx="2"/><path d="M6 4V2.8M10 4V2.8M5.5 8h.01M10.5 8h.01M6.2 10.2c.5.5 1.1.8 1.8.8s1.3-.3 1.8-.8"/><path d="M3 8H1.8M14.2 8H13"/></svg></span>
                    <span class="kchip req delegated">REQUEST</span><span class="klabel">Solicitud delegada</span>
                  }
                  @else if (ev.kind === 'request') {
                    <span class="req-icon user" aria-hidden="true"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="5" r="2.6"/><path d="M3.2 13.2c.6-2.4 2.5-3.7 4.8-3.7s4.2 1.3 4.8 3.7"/></svg></span>
                    <span class="kchip req user">REQUEST</span><span class="klabel">Solicitud del usuario</span>
                  }
                  @else if (ev.kind === 'response') { <span class="kchip resp">RESPONSE</span><span class="klabel">Respuesta del agente</span> }
                  @else if (ev.kind === 'thinking') { <span class="kchip think">THINKING</span><span class="klabel">Razonamiento</span> }
                  @else if (ev.kind === 'tool_group') { <span class="kchip tool">TOOLS</span><span class="klabel">Herramientas</span> }
                  @else { <span class="kchip other">{{ ev.kind }}</span> }
                </span>
                <span class="ts" *ngIf="ev.created_at">{{ ev.created_at | date:'HH:mm:ss' }}</span>
              </div>
              @if (ev.kind === 'system_prompt') {
                <details class="sys-details"><summary>Prompt del sistema</summary><pre>{{ ev.content }}</pre></details>
              } @else if (ev.kind === 'plan') {
                <details class="collapsible-item">
                  <summary>Ver plan{{ planStepsLabel(ev.meta) }}</summary>
                  <pre class="ev-body">{{ ev.content }}</pre>
                </details>
              } @else if (ev.kind === 'thinking') {
                <details class="collapsible-item">
                  <summary>{{ thinkingSummary(ev.content) }}</summary>
                  <pre class="ev-body">{{ thinkingText(ev.content) }}</pre>
                </details>
              } @else if (ev.kind === 'tool_group') {
                <details class="collapsible-item" [title]="'Ver detalles de las ' + toolGroupCount(ev.content) + ' herramienta(s) ejecutadas'">
                  <summary>{{ toolGroupSummary(ev.content) }}</summary>
                  <pre class="ev-body">{{ toolGroupText(ev.content) }}</pre>
                </details>
              } @else if (ev.kind === 'response') {
                <div class="response-wrap">
                  <div class="response-actions">
                    <button type="button" class="mini-action" (click)="toggleResponseMarkdown(eventKey(ev,i))" [title]="isResponseRaw(eventKey(ev,i)) ? 'Activar markdown' : 'Desactivar markdown'" [attr.aria-label]="isResponseRaw(eventKey(ev,i)) ? 'Activar markdown' : 'Desactivar markdown'">
                      <span class="mini-ico">MD</span>
                    </button>
                    <button type="button" class="mini-action" (click)="copyResponse(ev, eventKey(ev,i))" [title]="copiedKey === eventKey(ev,i) ? 'Copiado' : 'Copiar contenido'" [attr.aria-label]="copiedKey === eventKey(ev,i) ? 'Copiado' : 'Copiar contenido'">
                      <span class="mini-ico">{{ copiedKey === eventKey(ev,i) ? '✓' : '⧉' }}</span>
                    </button>
                  </div>
                  @if (isResponseRaw(eventKey(ev,i))) {
                    <pre class="ev-body response-plain">{{ asText(ev.content) }}</pre>
                  } @else {
                    <div class="response-body markdown-body" [innerHTML]="renderMarkdown(ev.content)"></div>
                  }
                </div>
              } @else if (ev.kind === 'request') {
                <pre class="ev-body request-body" [title]="asText(ev.content)">{{ asText(ev.content) }}</pre>
              } @else {
                <pre class="ev-body" [title]="ev.content">{{ ev.content }}</pre>
              }
            </div>
          } @empty {
            <p class="empty">Sin mensajes todavía.</p>
          }
        </div>
      </section>

      <div class="bottom-dock">
        <app-live-console [selectedAgentId]="selectedAgentId" [collapsed]="liveConsoleCollapsed" (collapsedChange)="liveConsoleCollapsed = $event"></app-live-console>

        <section class="panel prompt-buffer" [class.expanded]="isPromptExpanded()">
          <div class="queue-accordion" *ngIf="selectedAgentId">
            <button type="button" class="queue-toggle" (click)="queueOpen = !queueOpen">
              <span class="q-left"><span class="q-chev">{{ queueOpen ? '▾' : '▸' }}</span> Cola</span>
              <span class="q-count" [class.has]="queueDepth>0">{{ queueDepth }}</span>
            </button>
            <div class="queue-list" *ngIf="queueOpen">
              <div class="queue-meta" *ngIf="queueCurrentTaskId">En proceso: tarea #{{ queueCurrentTaskId }}</div>
              @for (it of queueItems; track (it.taskId ?? $index)) {
                <div class="queue-item">
                  <div class="qi-top"><b>#{{it.taskId ?? '—'}}</b> <span class="qi-flow">{{it.task_flow || 'direct'}}{{it.callback_final ? ' (final)' : ''}}</span> @if (it.plan_ref) { <span class="qi-plan">plan #{{it.plan_ref}}</span> } <span class="qi-who">de {{ requestorLabel(it.sender_agent_id) }}</span></div>
                  <div class="qi-payload">{{ it.preview || it.payload || '' }}</div>
                </div>
              } @empty { <div class="queue-empty">{{ queueDepth>0 ? (queueDepth + ' en cola (detalle no disponible)') : 'Sin peticiones en cola' }}</div> }
            </div>
          </div>
          <div class="composer-row">
            <div class="prompt-wrap" [class.focused]="promptFocused" [class.multiline]="isPromptMultiline()">
              <textarea pTextarea class="prompt-input" [ngModel]="promptText" (ngModelChange)="onPromptInput($event)" (focus)="promptFocused=true" (blur)="promptFocused=false" [disabled]="!holdTask && !selectedAgentId" [rows]="isPromptExpanded() ? 4 : 1"
                [placeholder]="holdTask ? 'Edit prompt and release…' : (selectedAgentId ? 'Escribe una tarea o /clear /compact /resume /stop /help' : 'Selecciona un agente')"></textarea>
              <div class="cmd-ac" *ngIf="showCmds && filteredCmds.length">
                <div class="cmd-item" *ngFor="let c of filteredCmds" (click)="pickCmd(c.cmd)"><b>{{c.cmd}}</b> <span>{{c.desc}}</span></div>
              </div>
            </div>
            <div class="action-row">
              @if ((selectedAgent?.status === 'WORKING' || hasActiveWork()) && selectedAgentId) {
                <button pButton type="button" severity="danger" class="p-button-outlined btn-stop" title="Detener agente" aria-label="Detener agente" (click)="stopAgent()">
                  <span class="stop-icon" aria-hidden="true"></span>
                </button>
              }
              @if (holdTask) {
                <button pButton type="button" class="send-btn release-btn" icon="pi pi-play" label="Liberar" (click)="liberar()"></button>
              } @else {
                <button pButton type="button" class="send-btn" (click)="sendTask()" [disabled]="!selectedAgentId || !promptText.trim()" title="Enviar (Return)" aria-label="Enviar tarea">
                  <span class="send-label">Enviar</span>
                  <span class="return-key" aria-hidden="true"><span class="ret-sym">↵</span></span>
                </button>
              }
            </div>
          </div>
          <pre class="sysmsg" *ngIf="systemMsg">{{systemMsg}}</pre>
        </section>
      </div>
    </div>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; height: 100%; }
    .swarm-monitor { display: flex; flex-direction: column; flex: 1 1 auto; height: 100%; min-height: 0; gap: 10px; overflow: hidden; }
    .panel { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 12px; }
    .chat-panel { flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; padding: 14px 14px 10px; overflow: hidden; }
    .panel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
    .chat-header { margin-bottom: 10px; flex: 0 0 auto; }
    .chat-title { font-size: 13px; font-weight: 600; letter-spacing: .01em; color: var(--text-secondary); margin: 0; }
    .count { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .chat-history { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; scroll-behavior: smooth; padding: 2px 4px 8px 0; }
    .chat-item { padding: 12px 14px; border: 1px solid var(--border-color); border-radius: 12px; background: rgba(255,255,255,0.015); }
    .chat-item.kind-response { border-color: rgba(88,166,255,0.35); background: linear-gradient(180deg, rgba(88,166,255,0.11), rgba(88,166,255,0.03)); box-shadow: inset 3px 0 0 var(--accent-blue); }
    .chat-item.kind-request.user-request { border-color: rgba(63,185,80,0.38); background: linear-gradient(180deg, rgba(63,185,80,0.12), rgba(63,185,80,0.03)); box-shadow: inset 3px 0 0 var(--accent-green, #3fb950); }
    .chat-item.kind-request.delegated-request { border-color: rgba(210,153,34,0.38); background: linear-gradient(180deg, rgba(210,153,34,0.12), rgba(210,153,34,0.03)); box-shadow: inset 3px 0 0 var(--accent-amber, #d29922); }
    .chat-item.kind-thinking { border-color: rgba(188,140,255,0.28); background: rgba(188,140,255,0.045); }
    .chat-item.kind-tool { border-color: rgba(210,153,34,0.25); background: rgba(210,153,34,0.045); }
    .chat-item.kind-plan { border-color: rgba(63,185,80,0.24); background: rgba(63,185,80,0.045); }
    .chat-item.system-ev { background: rgba(99,102,241,0.08); border-color: rgba(99,102,241,0.25); }
    .chat-meta { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; gap: 8px; }
    .route { font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .req-icon { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-secondary); flex: 0 0 auto; }
    .req-icon.user { color: #dfffe9; border-color: rgba(63,185,80,0.45); background: rgba(63,185,80,0.18); }
    .req-icon.agent { color: #fff0cc; border-color: rgba(210,153,34,0.45); background: rgba(210,153,34,0.18); }
    .req-icon svg { display: block; }
    .kchip { font-size: 10px; font-weight: 700; letter-spacing: .06em; padding: 2px 7px; border-radius: 999px; border: 1px solid var(--border-color); color: var(--text-secondary); background: var(--bg-tertiary); }
    .kchip.resp { color: #e9f4ff; border-color: rgba(88,166,255,0.5); background: rgba(88,166,255,0.22); }
    .kchip.req.user { color: #eafff0; border-color: rgba(63,185,80,0.5); background: rgba(63,185,80,0.2); }
    .kchip.req.delegated { color: #fff4d6; border-color: rgba(210,153,34,0.5); background: rgba(210,153,34,0.2); }
    .kchip.think { color: #efe3ff; border-color: rgba(188,140,255,0.45); background: rgba(188,140,255,0.16); }
    .kchip.tool { color: #ffecc0; border-color: rgba(210,153,34,0.45); background: rgba(210,153,34,0.16); }
    .kchip.plan { color: #d9ffe3; border-color: rgba(63,185,80,0.45); background: rgba(63,185,80,0.16); }
    .kchip.sys { color: #dfe4ff; border-color: rgba(99,102,241,0.45); background: rgba(99,102,241,0.16); }
    .klabel { font-size: 12px; color: var(--text-secondary); }
    .ts { font-size:10px; color: var(--text-muted); font-family: var(--font-mono); }
    .response-wrap { position: relative; }
    .response-actions { position: absolute; top: -2px; right: 0; display: inline-flex; gap: 4px; opacity: 0.55; transition: opacity .15s ease; z-index: 2; }
    .response-wrap:hover .response-actions, .response-actions:focus-within { opacity: 1; }
    .mini-action { border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-muted); border-radius: 6px; padding: 2px 6px; font-size: 10px; line-height: 1.2; cursor: pointer; font-family: var(--font-mono); }
    .mini-action:hover { color: var(--text-primary); border-color: var(--text-muted); background: rgba(255,255,255,0.06); }
    .mini-ico { display: inline-block; min-width: 14px; text-align: center; }
    .response-body { font-size: 14px; line-height: 1.7; color: var(--text-primary); padding-right: 72px; }
    .response-plain { padding-right: 72px; }
    .request-body { font-size: 13px; line-height: 1.65; color: var(--text-primary); font-family: var(--font-mono); }
    .empty { color: var(--text-muted); font-size: 13px; padding: 16px 4px; }
    .sys-details summary { cursor:pointer; font-size:12px; color: var(--accent-blue, #818cf8); margin-bottom:6px; }
    .sys-details pre { white-space: pre-wrap; margin:0; font-size:11px; font-family: var(--font-mono); color: var(--text-secondary); max-height: 240px; overflow:auto; }
    .ev-body { white-space: pre-wrap; margin:0; font-size:12px; line-height:1.6; font-family: var(--font-mono); color: var(--text-secondary); }
    .collapsible-item summary { cursor: pointer; font-size: 12px; color: var(--text-secondary); }

    .markdown-body { word-wrap: break-word; overflow-wrap: anywhere; }
    .markdown-body :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, hr, .mermaid-block) { margin: 0 0 0.8em; }
    .markdown-body :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, hr, .mermaid-block):last-child { margin-bottom: 0; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 { line-height: 1.25; font-weight: 650; color: var(--text-primary); letter-spacing: -.01em; }
    .markdown-body h1 { font-size: 1.35em; margin-top: .2em; }
    .markdown-body h2 { font-size: 1.18em; padding-bottom: .2em; border-bottom: 1px solid rgba(255,255,255,0.06); }
    .markdown-body h3 { font-size: 1.05em; }
    .markdown-body h4 { font-size: 1em; color: var(--text-secondary); }
    .markdown-body ul, .markdown-body ol { padding-left: 1.4em; }
    .markdown-body li { margin: 0.25em 0; }
    .markdown-body li > :last-child { margin-bottom: 0; }
    .markdown-body a { color: var(--accent-blue); text-decoration: none; border-bottom: 1px solid rgba(88,166,255,0.35); }
    .markdown-body a:hover { border-bottom-color: rgba(88,166,255,0.8); }
    .markdown-body code { font-family: var(--font-mono); font-size: 0.9em; background: rgba(110,118,129,0.22); border: 1px solid rgba(110,118,129,0.25); border-radius: 6px; padding: 0.12em 0.38em; color: #e6edf3; }
    .markdown-body pre { background: #0b1220; border: 1px solid rgba(110,118,129,0.35); border-radius: 10px; padding: 12px 14px; overflow: auto; }
    .markdown-body pre code { background: none; border: 0; padding: 0; font-size: 12.5px; line-height: 1.6; color: #e6edf3; white-space: pre; }
    .markdown-body pre.mermaid-diagram { background: linear-gradient(180deg, #0b1220, #0a1020); border-color: rgba(88,166,255,0.25); }
    .markdown-body pre.mermaid-diagram code { color: #cfe7ff; }
    .markdown-body .mermaid-block .mermaid-label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); margin: 0 0 4px 2px; font-family: var(--font-mono); }
    .markdown-body .mermaid-fallback-note { font-size: 11px; color: var(--text-muted); margin: 4px 0 0 2px; }
    .markdown-body blockquote { border-left: 3px solid rgba(88,166,255,0.5); margin-left: 0; padding: 2px 0 2px 12px; color: var(--text-secondary); background: rgba(88,166,255,0.04); border-radius: 0 6px 6px 0; }
    .markdown-body table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; }
    .markdown-body th, .markdown-body td { border-bottom: 1px solid var(--border-color); border-right: 1px solid var(--border-color); padding: 8px 10px; text-align: left; vertical-align: top; }
    .markdown-body th:last-child, .markdown-body td:last-child { border-right: 0; }
    .markdown-body tr:last-child td { border-bottom: 0; }
    .markdown-body th { background: rgba(255,255,255,0.04); color: var(--text-primary); font-weight: 600; }
    .markdown-body hr { border: 0; border-top: 1px solid var(--border-color); margin: 1em 0; }
    .markdown-body img { max-width: 100%; border-radius: 8px; }

    .bottom-dock { flex: 0 0 auto; z-index: 5; display: flex; flex-direction: column; gap: 8px; padding-top: 4px; background: linear-gradient(to bottom, rgba(13,17,23,0), var(--bg-primary) 22%); }
    .prompt-buffer { transition: padding .2s ease, box-shadow .2s ease; }
    .prompt-buffer.expanded { box-shadow: 0 -6px 22px rgba(0,0,0,0.2); }
    .queue-accordion { border:1px solid var(--border-color); border-radius:8px; margin-bottom:8px; overflow:hidden; background: var(--bg-tertiary,#0f172a); }
    .queue-toggle { width:100%; display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:transparent; border:0; color:var(--text-primary); cursor:pointer; font-size:12px; }
    .q-left{display:flex; align-items:center; gap:6px;} .q-chev{color:var(--text-muted); font-size:11px; width:10px; display:inline-block}
    .q-count{font-family:var(--font-mono); font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(148,163,184,.15); color:var(--text-muted);}
    .q-count.has{background:rgba(245,158,11,.18); color:var(--accent-amber,#f59e0b);}
    .queue-list{padding:8px 10px; border-top:1px solid var(--border-color); display:flex; flex-direction:column; gap:6px; max-height:160px; overflow:auto;}
    .queue-item{padding:6px 8px; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary);}
    .qi-top{display:flex; gap:8px; align-items:center; font-size:11px; color:var(--text-secondary);} .qi-flow{font-size:10px; color:var(--accent-blue);} .qi-plan{font-size:10px; color:var(--accent-green, #22c55e); border:1px solid var(--border-color); border-radius:999px; padding:0 6px;} .qi-who{margin-left:auto; font-size:10px; color:var(--text-muted);} .qi-payload{font-size:12px; color:var(--text-primary); margin-top:2px; white-space:pre-wrap;}
    .queue-empty,.queue-meta{font-size:11px; color:var(--text-muted);}

    .composer-row { display: flex; align-items: flex-end; justify-content: center; gap: 10px; }
    .prompt-wrap { position: relative; flex: 1 1 560px; width: 100%; max-width: 560px; transition: max-width .22s ease, flex-basis .22s ease; }
    .prompt-buffer.expanded .prompt-wrap, .prompt-wrap.focused, .prompt-wrap.multiline { flex-basis: 100%; max-width: 100%; }
    .prompt-input { width: 100%; resize: none; min-height: 38px; max-height: 140px; line-height: 1.5; transition: min-height .18s ease, padding .18s ease; border-radius: 10px; }
    .prompt-buffer.expanded .prompt-input { min-height: 88px; }
    .cmd-ac { position:absolute; left:0; right:0; bottom:100%; background: var(--bg-secondary); border:1px solid var(--border-color); border-radius:8px; margin-bottom:6px; z-index:10; box-shadow: var(--shadow-md); overflow: hidden; }
    .cmd-item { padding:7px 10px; cursor:pointer; display:flex; gap:8px; font-size:12px; }
    .cmd-item:hover { background: rgba(255,255,255,0.05); }

    .action-row { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .send-btn { display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px 0 14px; border-radius: 10px !important; }
    .send-label { font-weight: 600; font-size: 13px; }
    .return-key { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; height: 22px; padding: 0 6px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.08); color: inherit; font-size: 14px; line-height: 1; }
    .ret-sym { transform: translateY(-1px); display: inline-block; }
    .release-btn { height: 38px; }

    .btn-stop { width:38px; height:38px; padding:0; display:inline-flex; align-items:center; justify-content:center; position:relative; border-radius: 10px !important; }
    .btn-stop::before { content:''; position:absolute; inset:-3px; border-radius:12px; border:2px solid var(--accent-red,#ef4444); animation: stopPulse 1.6s ease-in-out infinite; opacity:0.5; }
    .stop-icon { width: 12px; height: 12px; border-radius: 2px; background: var(--accent-red, #ef4444); display: inline-block; box-shadow: 0 0 0 1px rgba(0,0,0,0.15) inset; }
    @keyframes stopPulse { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.15); opacity: 0; } }
    .sysmsg { white-space: pre-wrap; font-size:12px; color: var(--text-secondary); margin: 8px 0 0; text-align: center; }

    @media (prefers-reduced-motion: reduce) { .btn-stop::before { animation: none; } .prompt-wrap, .prompt-input { transition: none; } }
  `],
})
export class SwarmMonitorComponent implements OnInit, OnDestroy, AfterViewInit {
  tasks: ITaskQueue[] = [];
  chatEvents: any[] = [];
  @ViewChild('chatHistory') chatHistoryRef?: ElementRef<HTMLDivElement>;
  private autoStickChat = true;
  private lastChatLen = 0;
  selectedAgentId: string | null = null;
  selectedAgent: any = null;
  promptText = '';
  commands = [
    { cmd: '/clear', desc: 'Limpiar historial/sesión del agente (nueva sesión)' },
    { cmd: '/compact', desc: 'Compactar sesión del agente (resumen, mantiene contexto)' },
    { cmd: '/resume', desc: 'Reanudar/mostrar estado de sesión actual' },
    { cmd: '/stop', desc: 'Detener tarea en curso del agente' },
    { cmd: '/help', desc: 'Ver comandos disponibles' }
  ];
  showCmds = false;
  filteredCmds = this.commands;
  systemMsg = '';
  holdTask: ITaskQueue | null = null;
  hitlEnabled = false;
  queueDepth = 0;
  queueItems: any[] = [];
  queueCurrentTaskId: number | null = null;
  queueOpen = false;
  allAgents: any[] = [];
  runStateMsg = '';
  liveConsoleCollapsed = true;
  stopActive = false;
  promptFocused = false;
  rawResponseKeys = new Set<string>();
  copiedKey: string | null = null;
  private copiedTimer: any = null;
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
    private sanitizer: DomSanitizer,
  ) {}

  isPromptMultiline(): boolean { return (this.promptText || '').includes('\n'); }
  isPromptExpanded(): boolean { return this.promptFocused || !!(this.promptText && this.promptText.trim().length) || this.isPromptMultiline(); }

  ngOnInit(): void {
    this.subs.push(this.selection.selectedAgent$.subscribe((a) => {
      if (this.selectedAgentId) this.drafts.set(this.selectedAgentId, this.promptText);
      this.selectedAgent = a;
      this.selectedAgentId = a?.id ?? null;
      this.promptText = this.drafts.get(this.selectedAgentId);
      this.runStateMsg = '';
      this.queueDepth = 0;
      this.queueItems = [];
      this.queueCurrentTaskId = null;
      this.autoStickChat = true;
      this.lastChatLen = 0;
      this.loadBaseline();
    }));

    this.subs.push(this.ws.statusChange$.subscribe((e: any) => {
      if (!e?.agentId) return;
      if (this.selectedAgent && e.agentId === this.selectedAgent.id) {
        this.selectedAgent = { ...this.selectedAgent, status: e.status };
        if (e.status === 'WORKING') this.runStateMsg = 'procesando…';
        if (e.status === 'IDLE') { this.runStateMsg = ''; this.autoStickChat = true; this.maybeScrollChat(true); }
      }
    }));

    this.subs.push(this.ws.queueUpdated$.subscribe((e: any) => {
      if (e?.agentId === this.selectedAgentId) {
        this.queueDepth = e.pendingCount || 0;
        this.queueItems = e.items || [];
        this.queueCurrentTaskId = e.currentTaskId ?? null;
        if (this.selectedAgent && this.queueDepth > 0) this.selectedAgent = { ...this.selectedAgent, status: 'WORKING' };
      }
    }));

    this.agentService.getAllAdmin().subscribe({ next: (list) => this.allAgents = list || [], error: () => this.agentService.getAll().subscribe({ next: (l) => this.allAgents = l || [], error: () => {} }) });

    this.subs.push(this.ws.runEvent$.subscribe((e: any) => {
      if (e?.agentId !== this.selectedAgentId) return;
      if (e.type === 'started') this.runStateMsg = `trabajando (${e?.model?.raw || e?.model?.modelId || 'modelo'})…`;
      else if (e.type === 'model' && e.state === 'ready') this.runStateMsg = `modelo listo: ${e.provider}/${e.modelId}`;
      else if (e.type === 'warning') this.runStateMsg = `aviso: ${e.message || e.code}`;
      else if (e.type === 'error') this.runStateMsg = `error: ${e.message || e.code}`;
      else if (e.type === 'finished') { this.runStateMsg = e.outcome === 'completed' ? '' : `fin: ${e.outcome}${e.errorMessage ? ' — ' + e.errorMessage : ''}`; this.autoStickChat = true; this.scheduleBaseline(300); }
    }));

    const upsertTask = (t: any) => {
      if (!t || !this.selectedAgentId) return;
      if (t.receiver_agent_id && t.receiver_agent_id !== this.selectedAgentId) return;
      const idx = this.tasks.findIndex(x => x.id === t.id);
      if (idx >= 0) this.tasks[idx] = { ...this.tasks[idx], ...t } as any; else this.tasks = [...this.tasks, t];
      this.tasks.sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));
    };

    this.subs.push(this.ws.taskUpdated$.subscribe((t: any) => {
      const task = t?.task || t;
      upsertTask(task);
      if (task?.receiver_agent_id === this.selectedAgentId && (task.status === 'COMPLETED' || task.status === 'HOLD' || task.status === 'STOPPED')) { this.autoStickChat = true; this.scheduleBaseline(250); }
    }));
    this.subs.push(this.ws.taskChanged$.subscribe((e: any) => { if (e?.task) upsertTask(e.task); if (e?.status === 'COMPLETED' || e?.status === 'HOLD' || e?.status === 'STOPPED') { this.autoStickChat = true; this.scheduleBaseline(250); } }));

    this.subs.push(this.ws.tasksCleared$.subscribe((e: any) => { if (!e?.workspaceId || e.workspaceId === this.workspaceService.active?.id) { this.tasks = []; } }));
    this.subs.push(this.ws.transcriptCleared$.subscribe((e: any) => { if (!this.selectedAgentId || e?.agentId === this.selectedAgentId) { this.tasks = []; this.chatEvents = []; this.lastChatLen = 0; this.autoStickChat = true; this.systemMsg = 'Chat limpiado y archivado en Memory > Session History.'; this.scheduleBaseline(500); } }));

    this.subs.push(this.ws.rehydrate$.subscribe(() => this.scheduleBaseline(150)));

    this.loadBaseline();
  }

  private scheduleBaseline(ms: number) {
    clearTimeout(this.pendingLoad);
    this.pendingLoad = setTimeout(() => this.loadBaseline(), ms);
  }

  ngAfterViewInit(): void { this.lastChatLen = this.chatEvents.length; this.scrollChatToBottom(); }

  onChatScroll(ev: Event): void {
    const el = ev.target as HTMLElement;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.autoStickChat = dist < 32;
  }

  private scrollChatToBottom(): void {
    const el = this.chatHistoryRef?.nativeElement;
    if (!el) return;
    requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  private maybeScrollChat(force = false): void {
    const grew = this.chatEvents.length > this.lastChatLen;
    if (force || (grew && this.autoStickChat)) this.scrollChatToBottom();
    if (grew) this.lastChatLen = this.chatEvents.length;
  }

  eventKey(ev: any, index: number): string {
    if (ev?.id != null) return `id:${ev.id}`;
    if (ev?.created_at != null) return `ts:${ev.created_at}:${index}`;
    return `i:${index}`;
  }

  asText(content: any): string {
    if (content == null) return '';
    return typeof content === 'string' ? content : String(content);
  }

  isDelegatedRequest(ev: any): boolean {
    if (!ev || ev.kind !== 'request') return false;
    const c = this.asText(ev.content).trimStart();
    return c.startsWith('[DELEGATION') || c.includes('[DELEGATION |');
  }

  isResponseRaw(key: string): boolean { return this.rawResponseKeys.has(key); }

  toggleResponseMarkdown(key: string): void {
    if (this.rawResponseKeys.has(key)) this.rawResponseKeys.delete(key); else this.rawResponseKeys.add(key);
    // trigger change detection-friendly update
    this.rawResponseKeys = new Set(this.rawResponseKeys);
  }

  async copyResponse(ev: any, key: string): Promise<void> {
    const text = this.asText(ev?.content);
    try {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      this.copiedKey = key;
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => { if (this.copiedKey === key) this.copiedKey = null; }, 1500);
    } catch {}
  }

  private escapeHtml(s: string): string {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  private sanitizeUrl(u: string): string {
    try {
      const url = new URL(u, 'https://example.invalid');
      if (url.protocol === 'http:' || url.protocol === 'https:') return this.escapeHtml(u);
    } catch {}
    return '#';
  }

  renderMarkdown(content: any): SafeHtml {
    const src = typeof content === 'string' ? content : (content == null ? '' : String(content));
    if (!src.trim()) return this.sanitizer.bypassSecurityTrustHtml('');
    const esc = (t: string) => this.escapeHtml(t);
    const inline = (raw: string) => {
      let t = esc(raw);
      const slots: string[] = [];
      const slot = (html: string) => { slots.push(html); return `%%S${slots.length - 1}%%`; };
      t = t.replace(/`([^`\n]+)`/g, (_m, c) => slot(`<code>${c}</code>`));
      t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => slot(`<a href="${this.sanitizeUrl(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`));
      t = t.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      t = t.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
      t = t.replace(/%%S(\d+)%%/g, (_m, i) => slots[+i] || '');
      return t;
    };
    const lines = src.replace(/\r\n?/g, '\n').split('\n');
    let html = '';
    let inCode = false; let codeLang = ''; let codeBuf: string[] = []; let list: 'ul' | 'ol' | null = null; let para: string[] = []; let bq: string[] = [];
    const flushPara = () => { if (para.length) { html += `<p>${inline(para.join(' '))}</p>`; para = []; } };
    const flushList = () => { if (list) { html += `</${list}>`; list = null; } };
    const flushBq = () => { if (bq.length) { html += `<blockquote>${bq.map(l => `<p>${inline(l)}</p>`).join('')}</blockquote>`; bq = []; } };
    const renderMermaidBlock = (code: string) => {
      try {
        const art = renderMermaid(code);
        if (art && Array.isArray((art as any).lines)) {
          const diagram = esc((art as any).lines.join('\n'));
          return `<div class="mermaid-block"><div class="mermaid-label">Mermaid</div><pre class="mermaid-diagram"><code>${diagram}</code></pre></div>`;
        }
      } catch {}
      return `<div class="mermaid-block"><div class="mermaid-label">Mermaid</div><pre class="mermaid-diagram mermaid-fallback"><code>${esc(code)}</code></pre><div class="mermaid-fallback-note">Vista de código (no se pudo renderizar el diagrama).</div></div>`;
    };
    const flushCode = () => {
      const code = codeBuf.join('\n');
      const lang = (codeLang || '').trim().toLowerCase();
      if (lang === 'mermaid') html += renderMermaidBlock(code);
      else {
        const cls = lang ? ` class="language-${esc(lang.replace(/[^a-z0-9_-]/g, ''))}"` : '';
        html += `<pre><code${cls}>${esc(code)}</code></pre>`;
      }
      codeBuf = []; inCode = false; codeLang = '';
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (inCode) { if (/^\s*```/.test(line)) { flushCode(); } else { codeBuf.push(line); } continue; }
      const fence = line.match(/^\s*```([\w-]*)\s*$/);
      if (fence) { flushPara(); flushList(); flushBq(); inCode = true; codeLang = fence[1] || ''; codeBuf = []; continue; }
      if (/^\s*\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:.-]+\|[\s|:.-]*$/.test(lines[i + 1])) {
        flushPara(); flushList(); flushBq();
        const split = (r: string) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
        const head = split(line); i++;
        const rows: string[][] = [];
        while (i + 1 < lines.length && /^\s*\|.+\|\s*$/.test(lines[i + 1])) { i++; rows.push(split(lines[i])); }
        html += '<table><thead><tr>' + head.map(h => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>' + rows.map(r => '<tr>' + head.map((_, ci) => `<td>${inline(r[ci] || '')}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
        continue;
      }
      const hm = line.match(/^(#{1,4})\s+(.*)$/);
      if (hm) { flushPara(); flushList(); flushBq(); const lvl = hm[1].length; html += `<h${lvl}>${inline(hm[2])}</h${lvl}>`; continue; }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushPara(); flushList(); flushBq(); html += '<hr>'; continue; }
      const bqm = line.match(/^\s*>\s?(.*)$/);
      if (bqm) { flushPara(); flushList(); bq.push(bqm[1]); continue; } else flushBq();
      const ulm = line.match(/^\s*[-*+]\s+(.*)$/);
      const olm = line.match(/^\s*\d+\.\s+(.*)$/);
      if (ulm || olm) { flushPara(); flushBq(); const want = ulm ? 'ul' : 'ol'; if (list && list !== want) flushList(); if (!list) { list = want as any; html += `<${list}>`; } html += `<li>${inline((ulm || olm)![1])}</li>`; continue; } else flushList();
      if (!line.trim()) { flushPara(); continue; }
      para.push(line.trim());
    }
    if (inCode) flushCode(); flushPara(); flushList(); flushBq();
    return this.sanitizer.bypassSecurityTrustHtml(html || `<p>${inline(src)}</p>`);
  }

  loadBaseline(): void {
    if (this.selectedAgentId) {
      this.taskService.getByReceiver(this.selectedAgentId).subscribe({ next: (list) => { this.tasks = list || []; }, error: () => {} });
      this.transcript.getByAgent(this.selectedAgentId).subscribe({ next: (ev) => { this.chatEvents = ev || []; this.lastChatLen = this.chatEvents.length; this.maybeScrollChat(true); }, error: () => {} });
    } else {
      this.taskService.getAll().subscribe({ next: (list) => { this.tasks = list || []; }, error: () => {} });
      this.chatEvents = [];
      this.lastChatLen = 0;
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
    this.drafts.set(this.selectedAgentId, v);
    if (v.startsWith('/') && !v.includes(' ')) { this.showCmds = true; this.filteredCmds = this.commands.filter(c => c.cmd.startsWith(v)); }
    else this.showCmds = false;
  }

  pickCmd(c: string): void { this.promptText = c; this.drafts.set(this.selectedAgentId, c); this.showCmds = false; }

  runCommand(raw: string): boolean {
    const cmd = raw.trim().split(/\s+/)[0];
    if (!cmd.startsWith('/')) return false;
    const id = this.selectedAgentId;
    if (cmd === '/help') { this.systemMsg = this.commands.map(c => `${c.cmd} — ${c.desc}`).join('\n'); return true; }
    if (!id) { this.systemMsg = 'Selecciona un agente.'; return true; }
    if (cmd === '/clear') { this.agentService.clearSession(id).subscribe({ next: () => { this.tasks = []; this.chatEvents = []; this.systemMsg = 'Sesión limpiada y chat archivado en Memory > Session History. Próxima tarea abrirá sesión nueva (prompt del sistema reinyectado).'; this.scheduleBaseline(600); }, error: (e) => this.systemMsg = 'Error: ' + (e?.error?.message || e.message) }); return true; }
    if (cmd === '/compact') { this.agentService.compactSession(id).subscribe({ next: () => this.systemMsg = 'Sesión compactada (resumen aplicado).', error: (e) => this.systemMsg = 'Error: ' + (e?.error?.message || e.message) }); return true; }
    if (cmd === '/resume') { this.systemMsg = 'Sesión actual activa para el agente. Usa /compact para resumir contexto o /clear para nueva sesión.'; return true; }
    if (cmd === '/stop') { this.agentService.stop(id).subscribe({ next: () => this.systemMsg = 'Agente detenido (IDLE).', error: (e) => this.systemMsg = 'Error: ' + (e?.error?.message || e.message) }); return true; }
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
    if (this.runCommand(this.promptText)) { this.promptText = ''; this.drafts.clear(this.selectedAgentId); this.showCmds = false; return; }
    const wsId = this.workspaceService.active?.id || null;
    const agentId = this.selectedAgentId;
    const payload = this.promptText.trim();
    const task: any = { sender_agent_id: 'user', receiver_agent_id: agentId, payload, status: 'PENDING', parent_task_id: null, workspace_id: wsId };
    if (this.selectedAgent) this.selectedAgent = { ...this.selectedAgent, status: 'WORKING' };
    this.runStateMsg = 'enviando tarea…';
    this.autoStickChat = true;
    this.taskService.create(task).subscribe({
      next: (created) => {
        this.promptText = '';
        this.drafts.clear(agentId);
        this.showCmds = false;
        if (created) this.tasks = [...this.tasks, created as any].sort((a: any, b: any) => (a.id ?? 0) - (b.id ?? 0));
      },
      error: (e) => { this.runStateMsg = 'error al enviar: ' + (e?.error?.message || e?.message || ''); },
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

  requestorLabel(id: string): string {
    if (!id) return '—'; if (id === 'user') return 'user';
    const a = (this.allAgents || []).find(x => x.id === id);
    return a ? (a.nickname || a.name || id) : id;
  }
  private tryParse(v: any): any { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return null; } }
  thinkingSummary(c: any): string { const o = this.tryParse(c); if (o?.summary) return String(o.summary) + (String(o.text || '').length > 80 ? '…' : ''); const t = o?.text || String(c || ''); return (t.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Thinking') + (t.length > 80 ? '…' : ''); }
  thinkingText(c: any): string { const o = this.tryParse(c); return o?.text || String(c || ''); }
  toolSummary(c: any): string { const o = this.tryParse(c); if (o?.toolName) return `${o.toolName} (${o.phase || 'call'})`; const t = String(c || ''); try { const j = JSON.parse(t); if (j.tool || j.toolName) return `${j.tool || j.toolName}`; } catch {} return t.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Tool call'; }
  toolText(c: any): string { const o = this.tryParse(c); return o ? JSON.stringify(o, null, 2) : String(c || ''); }
  toolGroupCount(content: any): number {
    try { const j = typeof content === 'string' ? JSON.parse(content) : content; return Array.isArray(j) ? j.length : 1; } catch { return 1; }
  }
  toolGroupSummary(content: any): string {
    try { const j = typeof content === 'string' ? JSON.parse(content) : content; if (Array.isArray(j)) return `Tools: ${j.map((x: any) => x.tool || x.toolName || '?').join(', ')}`; if (content?.toolName) return `${content.toolName} (${content.phase})`; return 'Tools'; } catch { return 'Tools'; }
  }
  toolGroupText(content: any): string {
    try { const j = typeof content === 'string' ? JSON.parse(content) : content; return Array.isArray(j) ? JSON.stringify(j, null, 2) : (content ? JSON.stringify(content, null, 2) : String(content)); } catch { return String(content); }
  }

  planStepsLabel(meta: any): string {
    try {
      const m = typeof meta === 'string' ? JSON.parse(meta) : meta;
      const n = m?.steps;
      return n != null ? ` (${n} paso${Number(n) === 1 ? '' : 's'})` : '';
    } catch { return ''; }
  }

  ngOnDestroy(): void {
    if (this.selectedAgentId) this.drafts.set(this.selectedAgentId, this.promptText);
    clearTimeout(this.pendingLoad);
    clearTimeout(this.copiedTimer);
    this.subs.forEach((s) => s.unsubscribe());
  }
}
