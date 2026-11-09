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
    <p-dialog header="Create Agent" [(visible)]="visible" [modal]="true" [style]="{width:'460px'}" (onHide)="onHide()">
      <div class="form">
        <div class="warn" *ngIf="!activeWs">Abre un workspace antes de crear agentes (no hive sin workspace).</div>
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
        <div class="field"><label>Instrucción adicional (opcional)</label><textarea [(ngModel)]="instruction" rows="2"></textarea></div>
        <div class="err" *ngIf="error">{{ error }}</div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" (click)="onHide()" class="p-button-text"></button>
        <button pButton label="Create" icon="pi pi-check" (click)="submit()" [disabled]="!nickname || !selectedProvider || !selectedModelId || !activeWs"></button>
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
    .err{color:var(--accent-red);font-size:12px}.warn{color:var(--accent-amber,#f59e0b);font-size:12px}
  `],
})
export class CreateAgentModalComponent implements OnInit {
  private _visible = false;
  @Input() set visible(v: boolean) { this._visible = v; if (v) { this.color = this.randColor(); this.error = ''; } }
  get visible() { return this._visible; }
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<IAgent>();

  nickname = ''; role: 'CHIEF' | 'WORKER' = 'WORKER';
  modelProviders: ModelProvider[] = []; selectedProvider = ''; selectedModelId = '';
  color = this.randColor(); instruction = ''; error = ''; activeWs: IWorkspace | null = null;

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
    if(!this.activeWs) { this.error='No hay workspace activo'; return; }
    if(!this.selectedProvider||!this.selectedModelId){ this.error='Proveedor y modelo son obligatorios'; return; }
    const agent: IAgent = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `agent-${Date.now()}`,
      name: this.nickname, nickname: this.nickname, role: this.role, status: 'IDLE',
      current_session_id: null, task_state: { model: `${this.selectedProvider}/${this.selectedModelId}` },
      workspace_id: this.activeWs.id, color: this.color, additional_instruction: this.instruction || null,
    };
    this.agentService.create(agent).subscribe({
      next: (created) => { this.created.emit(created); this.onHide(); this.nickname=''; this.color=this.randColor(); this.instruction=''; },
      error: (e) => { this.error = e?.error?.message || e?.message || 'Error creando agente'; },
    });
  }
}
