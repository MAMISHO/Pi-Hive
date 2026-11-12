import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { AgentService, ModelProvider } from '../../core/services/agent.service';
import { effortFull, effortShort, normalizeEffort, pickDefaultEffort } from '../../core/utils/thinking-level.util';
import { WorkspaceService, IWorkspace } from '../../core/services/workspace.service';
import { IAgent } from '../../core/models/agent.model';

@Component({
  selector: 'app-create-agent-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule],
  template: `
    <p-dialog [header]="isEdit ? 'Edit Agent' : 'Create Agent'" [(visible)]="visible" [modal]="true" [style]="{width:'720px', maxWidth:'96vw'}" [contentStyle]="{'max-height':'72vh','overflow':'auto'}" (onHide)="onHide()">
      <div class="form">
        <div class="warn field full" *ngIf="!activeWs && !isEdit">Abre un workspace antes de crear agentes (no hive sin workspace).</div>
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
          <select [(ngModel)]="selectedModelId" (ngModelChange)="onModelChange()" [disabled]="!selectedProvider">
            <option value="">-- Selecciona modelo --</option>
            @for (m of currentModels(); track m) { <option [value]="m">{{ m }}</option> }
          </select>
        </div>
        <div class="field" *ngIf="availableEfforts.length > 0"><label>Nivel de esfuerzo</label>
          <select [(ngModel)]="thinkingLevel">
            @for (lvl of availableEfforts; track lvl) { <option [value]="lvl" [title]="effortFullName(lvl)">{{ effortLabel(lvl) }}</option> }
          </select>
        </div>
        <div class="field"><label>Color</label>
          <div class="color-row">
            <button type="button" class="color-btn" [style.background]="color" (click)="colorInput.click()" [title]="color"></button>
            <input #colorInput [(ngModel)]="color" type="color" class="color-hidden" />
            <span class="mono">{{ color }}</span>
          </div>
        </div>
        <div class="field check-field full">
          <label class="check-label"><input type="checkbox" [(ngModel)]="injectContext" /> Inyectar contexto del sistema y del equipo</label>
          <div class="hint">Si se desactiva, el agente será independiente (sin system prompt, roster ni indicaciones agregadas) para tareas ligeras/transversales.</div>
        </div>
        <div class="field full" [class.dimmed]="!injectContext"><label>Instrucción adicional (opcional)</label><textarea [(ngModel)]="instruction" rows="6" [disabled]="!injectContext" class="instruction-input"></textarea></div>
        <div class="err field full" *ngIf="error">{{ error }}</div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" (click)="onHide()" class="p-button-text"></button>
        <button pButton [label]="isEdit ? 'Save' : 'Create'" icon="pi pi-check" (click)="submit()" [disabled]="!nickname || !selectedProvider || !selectedModelId || (!activeWs && !isEdit)"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; align-items: start; }
    .field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .field.full { grid-column: 1 / -1; }
    label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
    input,textarea,select{padding:7px 9px;background:var(--bg-secondary);border:1px solid var(--border-color);color:var(--text-primary);border-radius:var(--radius-sm);width:100%;box-sizing:border-box}
    textarea{resize:vertical}
    .instruction-input{min-height:140px;line-height:1.45}
    .color-row{display:flex;align-items:center;gap:8px}.color-btn{width:36px;height:30px;border-radius:6px;border:1px solid var(--border-color);cursor:pointer;padding:0;flex:0 0 auto}
    .color-hidden{position:absolute;opacity:0;width:0;height:0;pointer-events:none}.mono{font-size:11px;color:var(--text-muted);font-family:var(--font-mono)}
    .check-field{gap:6px}.check-label{display:flex;align-items:center;gap:8px;color:var(--text-primary);font-weight:500;cursor:pointer}.check-label input{width:16px;height:16px;flex:0 0 auto}.hint{font-size:11px;color:var(--text-muted);line-height:1.35}.dimmed{opacity:.55}
    .err{color:var(--accent-red);font-size:12px}.warn{color:var(--accent-amber,#f59e0b);font-size:12px}
    @media (max-width: 640px){ .form{ grid-template-columns: 1fr; } .field.full{ grid-column: auto; } }
  `],
})
export class CreateAgentModalComponent implements OnInit {
  private _visible = false;
  private _agent: IAgent | null = null;
  @Input() set visible(v: boolean) {
    this._visible = v;
    if (v) {
      this.error = '';
      // ensure effort options/level are loaded when opening (edit or create)
      if (this.selectedProvider && this.selectedModelId) this.loadThinkingLevels(!this._agent);
    }
  }
  get visible() { return this._visible; }
  @Input() set agent(a: IAgent | null) {
    this._agent = a;
    if (a) {
      this.nickname = a.nickname || a.name || '';
      this.role = (a.role as any) || 'WORKER';
      const m = String((a.task_state as any)?.model || '');
      if (m.includes('/')) { this.selectedProvider = m.split('/')[0]; this.selectedModelId = m.split('/').slice(1).join('/'); }
      else { this.selectedProvider = ''; this.selectedModelId = ''; }
      this.color = a.color || this.randColor();
      this.instruction = (a as any).additional_instruction || '';
      this.injectContext = (a as any).inject_context !== false;
      this.thinkingLevel = (a as any).thinkingLevel || (a.task_state as any)?.thinkingLevel || 'low';
      if (this.selectedProvider && this.selectedModelId) this.loadThinkingLevels(false);
      else { this.availableEfforts = []; }
    } else {
      this.resetCreateForm();
    }
  }
  get agent(): IAgent | null { return this._agent; }

  private resetCreateForm(): void {
    this.nickname = ''; this.role = 'WORKER';
    this.selectedProvider = ''; this.selectedModelId = '';
    this.color = this.randColor();
    this.instruction = ''; this.injectContext = true;
    this.thinkingLevel = 'low'; this.availableEfforts = [];
    this.error = '';
  }
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<IAgent>();
  @Output() updated = new EventEmitter<IAgent>();
  get isEdit(): boolean { return !!this._agent?.id; }

  nickname = ''; role: 'CHIEF' | 'WORKER' = 'WORKER';
  modelProviders: ModelProvider[] = []; selectedProvider = ''; selectedModelId = '';
  availableEfforts: string[] = []; thinkingLevel: any = 'low';
  color = this.randColor(); instruction = ''; injectContext = true; error = ''; activeWs: IWorkspace | null = null;

  constructor(private agentService: AgentService, private ws: WorkspaceService) {}

  ngOnInit(): void {
    this.ws.active$.subscribe(w => this.activeWs = w);
    this.ws.refreshActive();
    this.agentService.getModels().subscribe({
      next: (providers) => {
        this.modelProviders = providers || [];
        if (this.isEdit && this.selectedProvider && this.selectedModelId) {
          // keep agent's model/effort; just ensure levels loaded
          this.loadThinkingLevels(false);
        } else {
          this.onProviderChange();
        }
      },
      error: () => { if (this.selectedProvider && this.selectedModelId) this.loadThinkingLevels(!this.isEdit); },
    });
  }
  currentModels(): string[] { return (this.modelProviders.find(p=>p.provider===this.selectedProvider)?.models) || []; }
  effortLabel(lvl: string){ return effortShort(lvl as any) || lvl; }
  effortFullName(lvl: string){ return effortFull(lvl as any); }
  private loadThinkingLevels(pickDefault = false): void {
    if(!this.selectedProvider || !this.selectedModelId){ this.availableEfforts=[]; this.thinkingLevel='off'; return; }
    this.agentService.getModelThinkingLevels(this.selectedProvider, this.selectedModelId).subscribe({
      next: (caps) => {
        this.availableEfforts = caps?.available || [];
        if (pickDefault) this.thinkingLevel = (caps as any)?.default || pickDefaultEffort(this.availableEfforts as any) || 'off';
        else this.thinkingLevel = normalizeEffort(this.thinkingLevel, this.availableEfforts);
      },
      error: () => { this.availableEfforts = []; this.thinkingLevel = 'off'; }
    });
  }
  onProviderChange(){
    if(!this.selectedProvider && this.modelProviders[0]) this.selectedProvider=this.modelProviders[0].provider;
    const ms=this.currentModels();
    if(!ms.includes(this.selectedModelId)) this.selectedModelId=ms[0]||'';
    this.loadThinkingLevels(!this.isEdit);
  }
  onModelChange(){ this.loadThinkingLevels(!this.isEdit); }
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
        task_state: { ...(this._agent.task_state || {}), model: `${this.selectedProvider}/${this.selectedModelId}`, thinkingLevel: this.availableEfforts.length ? this.thinkingLevel : 'off' },
        color: this.color, additional_instruction: this.injectContext ? (this.instruction || null) : null, inject_context: this.injectContext, thinkingLevel: this.availableEfforts.length ? this.thinkingLevel : 'off',
      };
      this.agentService.update(this._agent.id, patch).subscribe({
        next: (saved) => { this.updated.emit(saved || patch); this.onHide(); },
        error: (e) => { this.error = e?.error?.message || e?.message || 'Error guardando agente'; },
      });
      return;
    }
    const agent: any = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `agent-${Date.now()}`,
      name: this.nickname, nickname: this.nickname, role: this.role, status: 'IDLE',
      current_session_id: null, task_state: { model: `${this.selectedProvider}/${this.selectedModelId}`, thinkingLevel: this.availableEfforts.length ? this.thinkingLevel : 'off' },
      workspace_id: this.activeWs!.id, color: this.color, additional_instruction: this.injectContext ? (this.instruction || null) : null, inject_context: this.injectContext, thinkingLevel: this.availableEfforts.length ? this.thinkingLevel : 'off',
    };
    this.agentService.create(agent).subscribe({
      next: (created) => { this.created.emit(created); this.onHide(); },
      error: (e) => { this.error = e?.error?.message || e?.message || 'Error creando agente'; },
    });
  }
}
