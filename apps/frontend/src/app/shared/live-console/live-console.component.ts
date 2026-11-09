import { Component, OnInit, OnDestroy, Input } from '@angular/core';
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
    <div class="live-console">
      <div class="console-header">
        <div class="title">
          <span class="dot" [class.active]="textBuffer || thinkingBuffer"></span>
          <span>Live Console</span>
        </div>
        <div class="actions">
          <button pButton type="button" [label]="thinkingCollapsed ? 'Show thinking' : 'Hide thinking'" (click)="thinkingCollapsed = !thinkingCollapsed" class="p-button-text p-button-sm"></button>
          <button pButton type="button" [label]="collapsed ? 'Expand' : 'Collapse'" (click)="collapsed = !collapsed" class="p-button-text p-button-sm"></button>
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
    .live-console { display: flex; flex-direction: column; gap: 8px; }
    .console-header { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
    .title { display: flex; align-items: center; gap: 8px; font-size: 14px; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-muted); }
    .dot.active { background: var(--accent-blue); box-shadow: 0 0 6px var(--accent-blue); }
    .actions { display: flex; gap: 4px; }
    .console-block { background: var(--bg-console); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; max-height: 320px; overflow-y: auto; }
    .thinking-label, .output-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px; }
    .thinking-content, .output-content { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: 13px; line-height: 1.6; color: #c9d1d9; }
    .thinking.collapsed .thinking-content { display: none; }
    .output { margin-top: 8px; }
    .output-content { color: #e6edf3; }
    .tools { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 4px; }
    .tool-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--radius-sm); background: var(--bg-tertiary); border: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 12px; color: var(--accent-blue); }
  `],
})
export class LiveConsoleComponent implements OnInit, OnDestroy {
  @Input() selectedAgentId: string | null = null;
  textBuffer = '';
  thinkingBuffer = '';
  tools: any[] = [];
  collapsed = false;
  thinkingCollapsed = false;
  private subs: Subscription[] = [];

  constructor(private ws: WebsocketService, private selection: AgentSelectionService, private cache: LiveStreamCacheService) {}

  private sync() {
    const b: AgentLiveBuffer = this.cache.get(this.selectedAgentId);
    this.textBuffer = b.text; this.thinkingBuffer = b.thinking; this.tools = b.tools;
  }

  ngOnInit(): void {
    this.subs.push(this.selection.selectedAgent$.subscribe((a) => { this.selectedAgentId = a?.id ?? null; this.sync(); }));
    this.subs.push(this.ws.runEvent$.subscribe((e: any) => { if (e?.type === 'started' && e.agentId) this.cache.resetRun(e.agentId, e.runId); if (e?.agentId === this.selectedAgentId) this.sync(); }));
    this.subs.push(this.ws.streamText$.subscribe((e) => { this.cache.applyText(e); if (e.agentId === this.selectedAgentId) this.sync(); }));
    this.subs.push(this.ws.streamTool$.subscribe((e) => { this.cache.applyTool(e as any); if (e.agentId === this.selectedAgentId) this.sync(); }));
    this.subs.push(this.ws.transcriptCleared$.subscribe((e:any)=>{ if(e?.agentId===this.selectedAgentId){ this.cache.clear(this.selectedAgentId); this.sync(); } }));
  }

  ngOnDestroy(): void { this.subs.forEach((s) => s.unsubscribe()); }
}
