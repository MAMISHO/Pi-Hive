import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { Router } from '@angular/router';
import { WorkspaceService, IWorkspace } from '../../core/services/workspace.service';
import { UiFeedbackService } from '../../core/services/ui-feedback.service';
import { AgentService } from '../../core/services/agent.service';
import { SystemPromptsService, ISystemPrompt } from '../../core/services/system-prompts.service';

@Component({
  selector: 'app-workspaces',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule],
  template: `
  <div class="page">
    <div class="page-head">
      <div>
        <h2>Workspaces</h2>
        <p class="sub">Cada workspace es un Hive independiente. Solo se puede abrir un workspace a la vez; para abrir otro usa otra pestaña del navegador.</p>
      </div>
      <button pButton label="Añadir workspace" icon="pi pi-plus" (click)="openCreate()"></button>
    </div>

    <div class="list">
      @for (w of workspaces; track w.id) {
        <div class="card" [class.active]="w.is_active">
          <div class="info">
            <div class="name">{{ w.name }} @if (w.is_active) { <span class="pill">activo</span> }</div>
            <div class="path">{{ w.path }}</div>
          </div>
          <div class="actions">
            <button pButton [label]="w.is_active ? 'Ir al workspace' : 'Abrir'" class="p-button-sm" (click)="openWorkspace(w)"></button>
            <button pButton label="Editar" class="p-button-sm p-button-outlined" (click)="openEdit(w)"></button>
            <button pButton label="Eliminar" class="p-button-sm p-button-danger p-button-outlined" (click)="deleteWorkspace(w)"></button>
          </div>
        </div>
      }
      @if (!workspaces.length) { <div class="empty">No hay workspaces. Añade uno para iniciar el Hive.</div> }
    </div>
  </div>

  <p-dialog [header]="editWs ? 'Editar workspace' : 'Configurar nuevo workspace'" [(visible)]="wizardOpen" [modal]="true" [style]="{width:'860px'}" (onHide)="resetWizard()">
    <div class="wizard">
      <div class="step"><strong>1) Workspace</strong></div>
      @if (!editWs) {
        <label>Carpeta (obligatorio)
          <div class="row"><input class="flex" [(ngModel)]="newPath" placeholder="Ruta absoluta" /><button pButton label="Browse" class="p-button-outlined" (click)="browse(newPath||'')"></button></div>
        </label>
        <div class="browser" *ngIf="browseVisible">
          <div class="browse-header"><span>{{ browseCurrent }}</span><button pButton label="Up" class="p-button-text p-button-sm" (click)="browse(browseParent||'')"></button></div>
          <div class="dirs">@for (d of browseDirs; track d.path) { <div class="dir" (click)="browse(d.path)">📁 {{ d.name }}</div> }</div>
          <div class="browse-actions"><button pButton label="Usar esta carpeta" class="p-button-sm" (click)="useFolder()"></button></div>
        </div>
      } @else { <div class="mono">{{ editWs.path }}</div> }
      <label>Nombre <input [(ngModel)]="wsName" /></label>

      <div class="step"><strong>2) System prompt</strong></div>
      <select [(ngModel)]="selectedPromptId">@for (p of prompts; track p.id) { <option [value]="p.id">{{ p.name }}{{ p.is_default ? ' (default, immutable)' : '' }}</option> }</select>

      @if (!editWs) {
        <div class="step"><strong>3) Chief (requerido)</strong></div>
        <label>Nickname (propuesto) <input [(ngModel)]="chiefNickname" /></label>
        <label>Proveedor (Pi) *
          <select [(ngModel)]="selectedProvider" (ngModelChange)="onProviderChange()">
            <option value="">-- Selecciona proveedor --</option>
            @for (p of modelProviders; track p.provider) { <option [value]="p.provider">{{ p.provider }}</option> }
          </select>
        </label>
        <label>Modelo *
          <select [(ngModel)]="selectedModelId" (ngModelChange)="chiefModel=selectedProvider+'/'+selectedModelId" [disabled]="!selectedProvider">
            <option value="">-- Selecciona modelo --</option>
            @for (m of currentModels(); track m) { <option [value]="m">{{ m }}</option> }
          </select>
        </label>
        <label>Color
          <div class="color-row">
            <button type="button" class="color-btn" [style.background]="chiefColor" (click)="colorInput.click()" [title]="chiefColor"></button>
            <input #colorInput [(ngModel)]="chiefColor" type="color" class="color-hidden" />
            <span class="mono">{{ chiefColor }}</span>
          </div>
        </label>
        <label>Instrucción adicional <textarea [(ngModel)]="chiefInstruction" rows="2"></textarea></label>
        <label class="row"><input type="checkbox" [(ngModel)]="useCustomChiefPrompt" /> Usar chief prompt custom</label>
        <textarea *ngIf="useCustomChiefPrompt" [(ngModel)]="customChiefPrompt" rows="3" placeholder="Custom chief prompt (soporta TEAM_ROSTER)"></textarea>
      }

      <div class="step"><strong>4) HITL & comportamiento</strong></div>
      <label class="row"><input type="checkbox" [(ngModel)]="hitlEnabled" /> Habilitar Human-in-the-loop (por defecto: off). Si está off, las comunicaciones son automáticas.</label>

      <div class="actions">
        <button pButton label="Cancelar" class="p-button-text" (click)="wizardOpen=false"></button>
        <button pButton [label]="editWs ? 'Guardar' : 'Inicializar Workspace'" icon="pi pi-check" (click)="save()" [disabled]="saving"></button>
      </div>
      <div class="err" *ngIf="error">{{ error }}</div>
    </div>
  </p-dialog>
  `,
  styles: [`
    .page{padding:24px;max-width:1100px;margin:0 auto;color:var(--text-primary)}
    .page-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:18px}
    h2{margin:0 0 4px}.sub{margin:0;color:var(--text-secondary);font-size:12px}
    .list{display:flex;flex-direction:column;gap:10px}
    .card{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px;border:1px solid var(--border-color);border-radius:var(--radius-md);background:var(--bg-secondary)}
    .card.active{border-color:var(--accent-blue)}
    .name{font-weight:600;display:flex;align-items:center;gap:8px}.path,.mono{font-size:11px;color:var(--text-muted);font-family:var(--font-mono)}
    .pill{font-size:10px;padding:2px 6px;border-radius:999px;background:rgba(59,130,246,.2);color:var(--accent-blue)}
    .actions{display:flex;gap:8px}.empty{color:var(--text-muted);padding:24px;text-align:center;border:1px dashed var(--border-color);border-radius:var(--radius-md)}
    .wizard{display:flex;flex-direction:column;gap:10px}.step{margin-top:6px;font-size:13px}
    label{display:flex;flex-direction:column;gap:4px;font-size:12px} label.row,.row{flex-direction:row;align-items:center;gap:8px;display:flex}
    input,textarea,select{padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border-color);color:var(--text-primary);border-radius:var(--radius-sm)}
    .flex{flex:1}.browser{border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:8px;background:var(--bg-secondary)}
    .browse-header{display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);font-family:var(--font-mono)}
    .dirs{max-height:160px;overflow:auto;display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin:6px 0}
    .dir{padding:4px 6px;border-radius:4px;cursor:pointer;font-size:12px}.dir:hover{background:var(--bg-tertiary)}
    .err{color:var(--accent-red);font-size:12px}.color-row{display:flex;align-items:center;gap:8px}
    .color-btn{width:36px;height:28px;border-radius:6px;border:1px solid var(--border-color);cursor:pointer;padding:0}
    .color-hidden{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
  `]
})
export class WorkspacesComponent implements OnInit {
  workspaces: IWorkspace[] = [];
  wizardOpen=false; editWs: IWorkspace|null=null; saving=false; error='';
  newPath=''; browseVisible=false; browseCurrent=''; browseParent:string|null=null; browseDirs:any[]=[];
  wsName=''; prompts: ISystemPrompt[]=[]; selectedPromptId='default-system-prompt';
  chiefNickname=''; modelProviders: Array<{provider:string;models:string[]}>=[]; selectedProvider=''; selectedModelId=''; chiefModel=''; chiefColor=this.randColor(); chiefInstruction=''; useCustomChiefPrompt=false; customChiefPrompt=''; hitlEnabled=false;
  constructor(private ws: WorkspaceService, private agents: AgentService, private sp: SystemPromptsService, private router: Router, private feedback: UiFeedbackService) {}
  ngOnInit(){ this.load(); this.agents.getModels().subscribe(m=>{this.modelProviders=(m as any)||[]; this.onProviderChange();}); }
  load(){ this.ws.getAll().subscribe(l=>this.workspaces=l); }
  openWorkspace(w:IWorkspace){ this.ws.activate(w.id).subscribe(()=>{ this.load(); this.router.navigateByUrl('/swarm-monitor'); }); }
  async deleteWorkspace(w:IWorkspace){ const ok = await this.feedback.confirm({ title: 'Eliminar workspace', message: `Eliminar workspace "${w.name}" (${w.path})?\nEsto eliminará sus agentes y tareas.`, confirmLabel: 'Eliminar', danger: true }); if(!ok) return; this.ws.delete(w.id).subscribe({ next: ()=>{ this.feedback.success(`Workspace "${w.name}" eliminado.`); this.load(); }, error: ()=> this.feedback.error('No se pudo eliminar el workspace.') }); }
  openCreate(){ this.editWs=null; this.resetWizard(); this.wizardOpen=true; this.chiefNickname='Chief-'+Math.random().toString(36).slice(2,5); this.chiefColor=this.randColor(); this.prompts=[{id:'default-system-prompt',workspace_id:null,name:'Default Hive System Prompt',content:'',is_default:true}]; }
  openEdit(w:IWorkspace){ this.editWs=w; this.wizardOpen=true; this.wsName=w.name; this.hitlEnabled=!!w.hitl_enabled; this.selectedPromptId=w.active_system_prompt_id||'default-system-prompt'; }
  resetWizard(){ this.error=''; this.saving=false; this.newPath=''; this.browseVisible=false; this.wsName=''; this.chiefNickname=''; this.selectedProvider=''; this.selectedModelId=''; this.chiefModel=''; this.chiefInstruction=''; this.useCustomChiefPrompt=false; this.customChiefPrompt=''; this.hitlEnabled=false; }
  browse(p:string){ this.browseVisible=true; this.ws.browseDirs(p||undefined).subscribe(r=>{ this.browseCurrent=r.current; this.browseParent=r.parent; this.browseDirs=r.dirs||[]; if(r.error) this.error=r.error; }); }
  useFolder(){ this.newPath=this.browseCurrent; this.browseVisible=false; this.wsName=this.newPath.split('/').filter(Boolean).pop()||'workspace'; }
  currentModels(): string[] { const p=this.modelProviders.find(x=>x.provider===this.selectedProvider); return p?p.models:[]; }
  onProviderChange(){ if(!this.selectedProvider && this.modelProviders[0]) this.selectedProvider=this.modelProviders[0].provider; const ms=this.currentModels(); if(!ms.includes(this.selectedModelId)) this.selectedModelId = ms[0]||''; if(this.selectedProvider&&this.selectedModelId) this.chiefModel=`${this.selectedProvider}/${this.selectedModelId}`; }
  randColor(){ const p=['#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#ec4899','#84cc16','#14b8a6','#f43f5e','#6366f1','#0ea5e9','#10b981']; return p[Math.floor(Math.random()*p.length)]; }
  save(){
    this.error='';
    if(this.editWs){
      this.saving=true;
      this.ws.update(this.editWs.id,{name:this.wsName||this.editWs.name, hitl_enabled:this.hitlEnabled, active_system_prompt_id:this.selectedPromptId||null}).subscribe({next:()=>{this.wizardOpen=false; this.saving=false; this.load(); this.ws.refreshActive();}, error:(e)=>{this.error=e?.error?.message||'Error'; this.saving=false;}});
      return;
    }
    if(!this.newPath.trim()) { this.error='La carpeta es obligatoria'; return; }
    if(!this.selectedProvider||!this.selectedModelId){ this.error='Proveedor y modelo son obligatorios'; return; }
    if(!this.chiefColor) this.chiefColor=this.randColor();
    this.saving=true; this.chiefModel=`${this.selectedProvider}/${this.selectedModelId}`;
    this.ws.create(this.wsName||'workspace', this.newPath.trim(), this.hitlEnabled).subscribe({
      next:(ws)=>{
        const finish=()=>{ const chief:any={ id:`chief-${Date.now().toString(36)}`, name:this.chiefNickname||'Chief', nickname:this.chiefNickname||'Chief', role:'CHIEF', status:'IDLE', workspace_id:ws.id, color:this.chiefColor, additional_instruction:this.chiefInstruction||null, inject_context:true, task_state:{model:this.chiefModel} };
          this.agents.create(chief).subscribe({ next:()=>{ this.ws.refreshActive(); this.wizardOpen=false; this.saving=false; this.load(); setTimeout(()=>this.router.navigateByUrl('/swarm-monitor'), 50); }, error:(e)=>{this.error=e?.error?.message||'Error creando chief (¿color duplicado?)'; this.saving=false;} });
        };
        if(this.useCustomChiefPrompt && this.customChiefPrompt.trim()) this.ws.update(ws.id,{custom_chief_prompt:this.customChiefPrompt}).subscribe({next:finish,error:finish}); else finish();
      }, error:(e)=>{ this.error=e?.error?.message||'Error creando workspace'; this.saving=false; }
    });
  }
}
