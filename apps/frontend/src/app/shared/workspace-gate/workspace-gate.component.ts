import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { WorkspaceService, IWorkspace } from '../../core/services/workspace.service';
import { UiFeedbackService } from '../../core/services/ui-feedback.service';
import { AgentService } from '../../core/services/agent.service';
import { SystemPromptsService, ISystemPrompt } from '../../core/services/system-prompts.service';

@Component({
  selector: 'app-workspace-gate',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule],
  template: `
  <p-dialog header="Pi-Hive — Workspace" [(visible)]="visible" [modal]="true" [closable]="false" [style]="{width:'860px'}">
    <div class="gate" *ngIf="!wizardOpen">
      <p class="hint">No hive without a workspace. Open an existing workspace or create a new one.</p>
      <div class="ws-list">
        @for (w of workspaces; track w.id) {
          <div class="ws-row">
            <div class="ws-info" (click)="openWorkspace(w)">
              <div class="ws-name">{{ w.name }}</div>
              <div class="ws-path">{{ w.path }}</div>
            </div>
            <button pButton label="Open" class="p-button-sm" (click)="openWorkspace(w)"></button>
            <button pButton label="Delete" class="p-button-sm p-button-danger p-button-outlined" (click)="deleteWorkspace(w)"></button>
          </div>
        }
        @if (!workspaces.length) { <div class="empty">No workspaces yet.</div> }
      </div>
      <div class="actions">
        <input class="path-input" [(ngModel)]="newPath" placeholder="Absolute folder path (e.g. /Users/you/project)" />
        <button pButton label="Browse & Configure" icon="pi pi-folder-open" (click)="startNew()"></button>
      </div>
      <div class="browser" *ngIf="browseVisible">
        <div class="browse-header"><span>{{ browseCurrent }}</span><button pButton label="Up" class="p-button-text p-button-sm" (click)="browse(browseParent||'')"></button></div>
        <div class="dirs">@for (d of browseDirs; track d.path) { <div class="dir" (click)="browse(d.path)">📁 {{ d.name }}</div> }</div>
        <div class="browse-actions"><button pButton label="Use this folder" class="p-button-sm" (click)="useFolder()"></button></div>
      </div>
    </div>

    <div class="wizard" *ngIf="wizardOpen">
      <div class="step"><strong>1) Workspace</strong> <span class="mono">{{ newPath }}</span></div>
      <label>Name <input [(ngModel)]="wsName" /></label>
      <div class="step"><strong>2) System prompt</strong></div>
      <select [(ngModel)]="selectedPromptId">@for (p of prompts; track p.id) { <option [value]="p.id">{{ p.name }}{{ p.is_default ? ' (default, immutable)' : '' }}</option> }</select>
      <div class="step"><strong>3) Chief (required)</strong></div>
      <label>Nickname (proposed) <input [(ngModel)]="chiefNickname" /></label>
      <label>Provider (from Pi) *
        <select [(ngModel)]="selectedProvider" (ngModelChange)="onProviderChange()">
          <option value="">-- Select provider --</option>
          @for (p of modelProviders; track p.provider) { <option [value]="p.provider">{{ p.provider }}</option> }
        </select>
      </label>
      <label>Model *
        <select [(ngModel)]="selectedModelId" [disabled]="!selectedProvider">
          <option value="">-- Select model --</option>
          @for (m of currentModels(); track m) { <option [value]="m">{{ m }}</option> }
        </select>
      </label>
      <label>Color
        <div class="color-row">
          <button type="button" class="color-btn" [style.background]="chiefColor" (click)="colorInput.click()" title="Choose color"></button>
          <input #colorInput [(ngModel)]="chiefColor" type="color" class="color-hidden" />
          <span class="mono">{{ chiefColor }}</span>
        </div>
      </label>
      <label>Additional instruction <textarea [(ngModel)]="chiefInstruction" rows="2"></textarea></label>
      <label class="row"><input type="checkbox" [(ngModel)]="useCustomChiefPrompt" /> Use custom chief prompt</label>
      <textarea *ngIf="useCustomChiefPrompt" [(ngModel)]="customChiefPrompt" rows="3" placeholder="Custom chief prompt (supports {{TEAM_ROSTER}})"></textarea>
      <div class="step"><strong>4) HITL & behavior</strong></div>
      <label class="row"><input type="checkbox" [(ngModel)]="hitlEnabled" /> Enable Human-in-the-loop (default: off). When off, agent comms are automatic.</label>
      <div class="actions">
        <button pButton label="Back" class="p-button-text" (click)="wizardOpen=false"></button>
        <button pButton label="Initialize Workspace" icon="pi pi-check" (click)="initialize()"></button>
      </div>
      <div class="err" *ngIf="error">{{ error }}</div>
    </div>
  </p-dialog>
  `,
  styles: [`
    .gate,.wizard{display:flex;flex-direction:column;gap:10px;color:var(--text-primary)}
    .hint{font-size:12px;color:var(--text-secondary);margin:0}
    .ws-list{display:flex;flex-direction:column;gap:6px;max-height:260px;overflow:auto}
    .ws-row{display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-secondary)}
    .ws-info{flex:1;cursor:pointer}.ws-name{font-weight:600}.ws-path,.mono{font-size:11px;color:var(--text-muted);font-family:var(--font-mono)}
    .actions{display:flex;gap:8px;align-items:center}.path-input{flex:1;padding:8px;background:var(--bg-secondary);border:1px solid var(--border-color);color:var(--text-primary);border-radius:var(--radius-sm)}
    .browser{border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:8px;background:var(--bg-secondary)}
    .browse-header{display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);font-family:var(--font-mono)}
    .dirs{max-height:160px;overflow:auto;display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin:6px 0}
    .dir{padding:4px 6px;border-radius:4px;cursor:pointer;font-size:12px}.dir:hover{background:var(--bg-tertiary)}
    .empty{font-size:12px;color:var(--text-muted)}
    .step{margin-top:6px;font-size:13px} label{display:flex;flex-direction:column;gap:4px;font-size:12px} label.row{flex-direction:row;align-items:center}
    input,textarea,select{padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border-color);color:var(--text-primary);border-radius:var(--radius-sm)}
    .err{color:var(--accent-red);font-size:12px}
    .color-row{display:flex;align-items:center;gap:8px}
    .color-btn{width:36px;height:28px;border-radius:6px;border:1px solid var(--border-color);cursor:pointer;padding:0}
    .color-hidden{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
  `]
})
export class WorkspaceGateComponent implements OnInit {
  visible = false; workspaces: IWorkspace[] = [];
  newPath = ''; browseVisible=false; browseCurrent=''; browseParent:string|null=null; browseDirs:any[]=[];
  wizardOpen=false; wsName=''; prompts: ISystemPrompt[]=[]; selectedPromptId='default-system-prompt';
  chiefNickname='Chief'; chiefModel=''; chiefColor=this.randColor(); chiefInstruction=''; useCustomChiefPrompt=false; customChiefPrompt=''; hitlEnabled=false; error=''; modelProviders: Array<{provider:string;models:string[]}>=[]; selectedProvider=""; selectedModelId="";
  constructor(private ws: WorkspaceService, private agents: AgentService, private sp: SystemPromptsService, private feedback: UiFeedbackService){}
  ngOnInit(){ this.ws.active$.subscribe(a=>{ this.visible=!a; if(this.visible) this.load(); }); this.load(); }
  load(){ this.ws.getAll().subscribe(l=>this.workspaces=l); this.agents.getModels().subscribe(m=>{this.modelProviders=(m as any)||[]; this.onProviderChange();}); }
  openWorkspace(w:IWorkspace){ this.ws.activate(w.id).subscribe(()=>{}); }
  async deleteWorkspace(w:IWorkspace){ const ok = await this.feedback.confirm({ title: 'Eliminar workspace', message: `Eliminar workspace "${w.name}" (${w.path})?\nEsto eliminará sus agentes y tareas.`, confirmLabel: 'Eliminar', danger: true }); if(!ok) return; this.ws.delete(w.id).subscribe({ next: ()=>{ this.feedback.success(`Workspace "${w.name}" eliminado.`); this.load(); }, error: ()=> this.feedback.error('No se pudo eliminar el workspace.') }); }
  startNew(){ if(!this.newPath.trim()){ this.browseVisible=true; this.browse(this.browseCurrent||''); } else { this.openWizard(); } }
  browse(p:string){ this.ws.browseDirs(p||undefined).subscribe(r=>{ this.browseCurrent=r.current; this.browseParent=r.parent; this.browseDirs=r.dirs||[]; if(r.error) this.error=r.error; }); }
  useFolder(){ this.newPath=this.browseCurrent; this.browseVisible=false; this.openWizard(); }
  openWizard(){
    this.wizardOpen=true; this.error='';
    this.wsName=this.newPath.split('/').filter(Boolean).pop()||'workspace';
    this.chiefNickname='Chief-'+Math.random().toString(36).slice(2,5);
    this.chiefColor = this.randColor(); // always show a random color
    this.prompts=[{id:'default-system-prompt',workspace_id:null,name:'Default Hive System Prompt',content:'',is_default:true}];
    this.selectedPromptId='default-system-prompt';
    if(!this.modelProviders.length) this.agents.getModels().subscribe(m=>{this.modelProviders=(m as any)||[]; this.onProviderChange();});
  }
  currentModels(): string[] { const p=this.modelProviders.find(x=>x.provider===this.selectedProvider); return p?p.models:[]; }
  onProviderChange(){ if(!this.selectedProvider && this.modelProviders[0]) this.selectedProvider=this.modelProviders[0].provider; const ms=this.currentModels(); if(!ms.includes(this.selectedModelId)) this.selectedModelId = ms[0]||''; this.chiefModel = this.selectedProvider && this.selectedModelId ? `${this.selectedProvider}/${this.selectedModelId}` : ''; }
  randColor(){ const p=['#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#ec4899','#84cc16','#14b8a6','#f43f5e','#6366f1','#0ea5e9','#10b981']; return p[Math.floor(Math.random()*p.length)]; }
  initialize(){
    this.error='';
    if(!this.newPath.trim()) { this.error='Path required'; return; }
    if(!this.selectedProvider||!this.selectedModelId){ this.error='Provider and model are required'; return; }
    this.chiefModel=`${this.selectedProvider}/${this.selectedModelId}`;
    if(!this.chiefColor) this.chiefColor = this.randColor(); if(!this.selectedProvider||!this.selectedModelId){ this.error='Provider and model are required'; return; } this.chiefModel=`${this.selectedProvider}/${this.selectedModelId}`;
    this.ws.create(this.wsName||'workspace', this.newPath.trim(), this.hitlEnabled).subscribe({
      next: (ws) => {
        const afterWs = () => {
          const chief:any={ id:`chief-${Date.now().toString(36)}`, name:this.chiefNickname, nickname:this.chiefNickname, role:'CHIEF', status:'IDLE', workspace_id:ws.id, color:this.chiefColor, additional_instruction:this.chiefInstruction||null, task_state: this.chiefModel?{model:this.chiefModel}:null };
          this.agents.create(chief).subscribe({ next:()=>{ this.wizardOpen=false; this.visible=false; }, error:(e)=>{ this.error=e?.error?.message||'Failed to create chief (color may conflict)'; } });
        };
        const updates: any = {};
        if(this.useCustomChiefPrompt && this.customChiefPrompt.trim()) updates.custom_chief_prompt=this.customChiefPrompt;
        if(Object.keys(updates).length) this.ws.update(ws.id, updates).subscribe({next:afterWs, error:afterWs}); else afterWs();
      },
      error: (e)=>{ this.error=e?.error?.message||'Failed to create workspace'; }
    });
  }
}
