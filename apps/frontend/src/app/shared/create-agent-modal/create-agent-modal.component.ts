import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { AgentService, ModelProvider } from '../../core/services/agent.service';
import { WorkspaceService, IWorkspace } from '../../core/services/workspace.service';
import { IAgent } from '../../core/models/agent.model';

@Component({
  selector: 'app-create-agent-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule],
  template: `
    <p-dialog [header]="isEdit ? 'Edit Agent' : 'Create Agent'" [(visible)]="visible" [modal]="true" [style]="{width:'460px'}" (onHide)="onHide()">
      <div class="form">
        <div class="warn" *ngIf="!activeWs && !isEdit">Abre un workspace antes de crear agentes (no hive sin workspace).</div>
        <div class="field"><label>Nickname</label><input [(ngModel)]="nickname" placeholder="e.g. Bob" /></div>
        <div class="field"><label>Role</label>
          <select [(ngModel)]="role"><option value="WORKER">WORKER</option><option value="CHIEF">CHIEF</option></select>
        </div>
        <div class="field"><label>Proveedor (Pi) *</label>
          <select [(ngModel)]="selectedProvider" (ngModelChange)="onProviderChange()">
            <option value="">-- Selecciona proveedor --</option>
            @for (p of modelProviders; track p.provider) { <option [value]="p.provider">{{ p.provider }}</option> }
          </select>
        </div>
        <div class="field"><label>Modelo *</label>
          <select [(ngModel)]="selectedModelId" [disabled]="!selectedProvider">
            <option value="">-- Selecciona modelo --</option>
            @for (m of currentModels(); track m) { <option [value]="m">{{ m }}</option> }
          </select>
        </div>
        <div class="field"><label>Color</label>
          <div class="color-row">
            <button type="button" class="color-btn" [style.background]="color" (click)="colorInput.click()" [title]="color"></button>
            <input #colorInput [(ngModel)]="color" type="color" class="color-hidden" />
            <span class="mono">{{ color }}</span>
          </div>
        </div>
        <div class="field check-field">
          <label class="check-label"><input type="checkbox" [(ngModel)]="injectContext" /> Inyectar contexto del sistema y del equipo</label>
          <div class="hint">Si se desactiva, el agente será independiente (sin system prompt, roster ni indicaciones agregadas) para tareas ligeras/transversales.</div>
        </div>
        <div class="field" [class.dimmed]="!injectContext"><label>Instrucción adicional (opcional)</label><textarea [(ngModel)]="instruction" rows="2" [disabled]="!injectContext"></textarea></div>
        <div class="err" *ngIf="error">{{ error }}</div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" (click)="onHide()" class="p-button-text"></button>
        <button pButton [label]="isEdit ? 'Save' : 'Create'" icon="pi pi-check" (click)="submit()" [disabled]="!nickname || !selectedProvider || !selectedModelId || (!activeWs && !isEdit)"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .form { display: flex; flex-direction: column; gap: 10px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
    input,textarea,select{padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border-color);color:var(--text-primary);border-radius:var(--radius-sm)}
    .color-row{display:flex;align-items:center;gap:8px}.color-btn{width:36px;height:28px;border-radius:6px;border:1px solid var(--border-color);cursor:pointer;padding:0}
    .color-hidden{position:absolute;opacity:0;width:0;height:0;pointer-events:none}.mono{font-size:11px;color:var(--text-muted);font-family:var(--font-mono)}
    .check-field{gap:6px}.check-label{display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:500;cursor:pointer}.check-label input{width:16px;height:16px}.hint{font-size:11px;color:var(--text-muted);line-height:1.35}.dimmed{opacity:.55}
    .err{color:var(--accent-red);font-size:12px}.warn{color:var(--accent-amber,#f59e0b);font-size:12px}
  `],
})
export class CreateAgentModalComponent implements OnInit {
  private _visible = false;
  private _agent: IAgent | null = null;
  @Input() set visible(v: boolean) { this._visible = v; if (v) { this.error = ''; if (!this._agent) this.color = this.randColor(); } }
  get visible() { return this._visible; }
  @Input() set agent(a: IAgent | null) {
    this._agent = a;
    if (a) {
      this.nickname = a.nickname || a.name || '';
      this.role = (a.role as any) || 'WORKER';
      const m = String((a.task_state as any)?.model || '');
      if (m.includes('/')) { this.selectedProvider = m.split('/')[0]; this.selectedModelId = m.split('/').slice(1).join('/'); }
      this.color = a.color || this.randColor();
      this.instruction = (a as any).additional_instruction || '';
      this.injectContext = (a as any).inject_context !== false;
    } else {
      this.nickname = ''; this.role = 'WORKER'; this.selectedProvider = ''; this.selectedModelId = ''; this.color = this.randColor(); this.instruction = ''; this.injectContext = true;
    }
  }
  get agent(): IAgent | null { return this._agent; }
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<IAgent>();
  @Output() updated = new EventEmitter<IAgent>();
  get isEdit(): boolean { return !!this._agent?.id; }

  nickname = ''; role: 'CHIEF' | 'WORKER' = 'WORKER';
  modelProviders: ModelProvider[] = []; selectedProvider = ''; selectedModelId = '';
  color = this.randColor(); instruction = ''; injectContext = true; error = ''; activeWs: IWorkspace | null = null;

  constructor(private agentService: AgentService, private ws: WorkspaceService) {}

  ngOnInit(): void {
    this.ws.active$.subscribe(w => this.activeWs = w);
    this.ws.refreshActive();
    this.agentService.getModels().subscribe({
      next: (providers) => { this.modelProviders = providers || []; this.onProviderChange(); },
      error: () => {},
    });
  }
  currentModels(): string[] { return (this.modelProviders.find(p=>p.provider===this.selectedProvider)?.models) || []; }
  onProviderChange(){ if(!this.selectedProvider && this.modelProviders[0]) this.selectedProvider=this.modelProviders[0].provider; const ms=this.currentModels(); if(!ms.includes(this.selectedModelId)) this.selectedModelId=ms[0]||''; }
  randColor(){ const p=['#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#ec4899','#84cc16','#14b8a6','#f43f5e','#6366f1','#0ea5e9','#10b981']; return p[Math.floor(Math.random()*p.length)]; }
  onHide(): void { this.visible = false; this.visibleChange.emit(false); this.error=''; }
  submit(): void {
    this.error='';
    if(!this.isEdit && !this.activeWs) { this.error='No hay workspace activo'; return; }
    if(!this.selectedProvider||!this.selectedModelId){ this.error='Proveedor y modelo son obligatorios'; return; }
    if (this.isEdit && this._agent) {
      const patch: any = {
        ...this._agent,
        name: this.nickname, nickname: this.nickname, role: this.role,
        task_state: { ...(this._agent.task_state || {}), model: `${this.selectedProvider}/${this.selectedModelId}` },
        color: this.color, additional_instruction: this.injectContext ? (this.instruction || null) : null, inject_context: this.injectContext,
      };
      this.agentService.update(this._agent.id, patch).subscribe({
        next: (saved) => { this.updated.emit(saved || patch); this.onHide(); },
        error: (e) => { this.error = e?.error?.message || e?.message || 'Error guardando agente'; },
      });
      return;
    }
    const agent: IAgent = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `agent-${Date.now()}`,
      name: this.nickname, nickname: this.nickname, role: this.role, status: 'IDLE',
      current_session_id: null, task_state: { model: `${this.selectedProvider}/${this.selectedModelId}` },
      workspace_id: this.activeWs!.id, color: this.color, additional_instruction: this.injectContext ? (this.instruction || null) : null, inject_context: this.injectContext,
    };
    this.agentService.create(agent).subscribe({
      next: (created) => { this.created.emit(created); this.onHide(); this.nickname=''; this.color=this.randColor(); this.instruction=''; this.injectContext = true; },
      error: (e) => { this.error = e?.error?.message || e?.message || 'Error creando agente'; },
    });
  }
}
