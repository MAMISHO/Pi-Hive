import { Component, OnInit, OnDestroy, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';
import { WebsocketService } from '../../core/services/websocket.service';
import { AgentSelectionService } from '../../core/services/agent-selection.service';
import { LiveStreamCacheService, AgentLiveBuffer } from '../../core/services/live-stream-cache.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-live-console',
  standalone: true,
  imports: [CommonModule, ButtonModule, BadgeModule],
  template: `
    <div class="live-console" [class.has-activity]="hasActivity()" [class.inactive]="!hasActivity()" [class.collapsed]="collapsed">
      <div class="console-header">
        <div class="title" [class.live-active]="hasActivity()" [class.idle]="!hasActivity()">
          <span class="dot" [class.active]="hasActivity()"></span>
          <span class="title-label">Live Console</span>
          @if (hasActivity()) { <span class="pulse-badge" aria-hidden="true"></span> }
        </div>
        <div class="actions">
          <button pButton type="button" [label]="thinkingCollapsed ? 'Show thinking' : 'Hide thinking'" (click)="thinkingCollapsed = !thinkingCollapsed" class="p-button-text p-button-sm"></button>
          <button pButton type="button" [label]="collapsed ? 'Expand' : 'Collapse'" (click)="toggleCollapsed(!collapsed)" class="p-button-text p-button-sm"></button>
        </div>
      </div>
      @if (!collapsed) {
        <div class="console-block">
          <div class="thinking" [class.collapsed]="thinkingCollapsed" *ngIf="thinkingBuffer || (!textBuffer)">
            <div class="thinking-label">thinking</div>
            <pre class="thinking-content">{{ thinkingBuffer || 'Waiting for output…' }}</pre>
          </div>
          <div class="output" *ngIf="textBuffer">
            <div class="output-label">output</div>
            <pre class="output-content">{{ textBuffer }}</pre>
          </div>
          @if (tools.length) {
            <div class="tools">
              @for (tool of tools; track $index) {
                <span class="tool-badge"><i class="pi pi-wrench"></i> {{ tool.toolName }}</span>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .live-console { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
    .live-console.inactive { opacity: 0.55; }
    .live-console.has-activity { opacity: 1; }
    .live-console.has-activity:not(.collapsed) .console-block { border-color: rgba(88,166,255,0.55); box-shadow: 0 0 12px rgba(88,166,255,0.18); }
    .console-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
    .title { display: flex; align-items: center; gap: 10px; font-size: 13px; }
    .title-label { position: relative; color: var(--text-muted); transition: color var(--transition-fast); }
    .title.idle .title-label { color: var(--text-muted); }
    .title.live-active .title-label {
      color: var(--text-primary);
      background: linear-gradient(90deg, var(--text-primary) 0%, var(--accent-blue) 45%, var(--text-primary) 90%);
      background-size: 220% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: shimmer-label 1.8s ease-in-out infinite;
    }
    @keyframes shimmer-label { 0% { background-position: 100% 0; } 100% { background-position: -100% 0; } }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-muted); flex-shrink: 0; opacity: 0.6; transition: background var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast), opacity var(--transition-fast); }
    .dot.active { background: var(--accent-blue); opacity: 1; box-shadow: 0 0 0 0 rgba(88,166,255,0.55); animation: dot-breathe 1.4s ease-in-out infinite; }
    @keyframes dot-breathe { 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(88,166,255,0.45); } 50% { transform: scale(1.08); box-shadow: 0 0 0 5px rgba(88,166,255,0); } }
    .pulse-badge { width: 7px; height: 7px; border-radius: 50%; background: var(--accent-blue); animation: pulse 1.5s ease-in-out infinite; opacity: 0.9; }
    @keyframes pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.35; transform: scale(1.5); } }
    @media (prefers-reduced-motion: reduce) { .pulse-badge, .dot.active, .title.live-active .title-label { animation: none; } .title.live-active .title-label { color: var(--accent-blue); -webkit-text-fill-color: currentColor; background: none; } }
    .actions { display: flex; gap: 4px; }
    .console-block { background: var(--bg-console); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px; max-height: 140px; overflow-y: auto; transition: border-color var(--transition-normal), box-shadow var(--transition-normal); }
    .thinking-label, .output-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
    .thinking-content, .output-content { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: 12px; line-height: 1.55; color: #c9d1d9; }
    .thinking.collapsed .thinking-content { display: none; }
    .output { margin-top: 6px; }
    .output-content { color: #e6edf3; }
    .tools { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
    .tool-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--radius-sm); background: var(--bg-tertiary); border: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 12px; color: var(--accent-blue); }
  `],
})
export class LiveConsoleComponent implements OnInit, OnDestroy {
  @Input() selectedAgentId: string | null = null;
  @Input() collapsed: boolean = false;
  @Output() collapsedChange = new EventEmitter<boolean>();

  textBuffer = '';
  thinkingBuffer = '';
  tools: any[] = [];
  thinkingCollapsed = false;
  private subs: Subscription[] = [];

  constructor(private ws: WebsocketService, private selection: AgentSelectionService, private cache: LiveStreamCacheService) {}

  hasActivity(): boolean { return !!this.textBuffer || !!this.thinkingBuffer || this.tools.length > 0; }
  toggleCollapsed(v: boolean): void { this.collapsed = v; this.collapsedChange.emit(v); }

  private sync() {
    const b: AgentLiveBuffer = this.cache.get(this.selectedAgentId);
    this.textBuffer = b.text; this.thinkingBuffer = b.thinking; this.tools = b.tools;
  }

  ngOnInit(): void {
    this.subs.push(this.selection.selectedAgent$.subscribe((a) => { this.selectedAgentId = a?.id ?? null; this.sync(); }));
    this.subs.push(this.ws.runEvent$.subscribe((e: any) => {
      if (e?.agentId) {
        if (e.type === 'started') this.cache.resetRun(e.agentId, e.runId);
        if (e.type === 'finished' || e.type === 'error') this.cache.clearRun(e.agentId, e.runId);
      }
      if (e?.agentId === this.selectedAgentId) this.sync();
    }));
    this.subs.push(this.ws.streamText$.subscribe((e) => { this.cache.applyText(e); if (e.agentId === this.selectedAgentId) this.sync(); }));
    this.subs.push(this.ws.streamTool$.subscribe((e) => { this.cache.applyTool(e as any); if (e.agentId === this.selectedAgentId) this.sync(); }));
    this.subs.push(this.ws.transcriptCleared$.subscribe((e:any)=>{ if(e?.agentId===this.selectedAgentId){ this.cache.clear(this.selectedAgentId); this.sync(); } }));
  }

  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }
}
