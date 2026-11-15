import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { Router } from '@angular/router';
import { WorkspaceService, IWorkspace } from '../../core/services/workspace.service';
import { UiFeedbackService } from '../../core/services/ui-feedback.service';
import { AppSettingsService } from '../../core/services/app-settings.service';
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
      <div class="head-actions">
        <button pButton label="Configuración" icon="pi pi-cog" class="p-button-outlined" (click)="openConfig()"></button>
        <button pButton label="Añadir workspace" icon="pi pi-plus" (click)="openCreate()"></button>
      </div>
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

  <!-- Configuración (Pi + system prompts base) -->
  <p-dialog header="Configuración" [(visible)]="configOpen" [modal]="true" [style]="{width:'920px'}" (onShow)="loadSettings(); loadGlobalPrompts()">
    <div class="wizard">
      <div class="step"><strong>Pi (agentDir)</strong></div>
      <div class="path">Directorio de agente de Pi (auth, modelos, sesiones). Por defecto usa <code>PI_CODING_AGENT_DIR</code> o <code>~/.pi/agent</code>.</div>
      <label>Pi agentDir
        <div class="row">
          <input class="flex" [(ngModel)]="piAgentDir" [placeholder]="appSettingsDefaults.piAgentDir || '~/.pi/agent'" />
          <button pButton label="Usar por defecto" class="p-button-outlined p-button-sm" type="button" (click)="useDefaultPiAgentDir()"></button>
          <button pButton label="Guardar" icon="pi pi-save" class="p-button-sm" type="button" (click)="saveSettings()" [disabled]="savingSettings"></button>
        </div>
      </label>
      <div class="path">Efectivo: <span class="mono">{{ appSettingsEffective.piAgentDir || '—' }}</span></div>
      <div class="ok" *ngIf="settingsMsg">{{ settingsMsg }}</div>
      <div class="err" *ngIf="settingsErr">{{ settingsErr }}</div>

      <div class="step"><strong>System prompts base (seleccionables al abrir un workspace)</strong></div>
      <div class="path">El prompt por defecto del sistema no es editable. Puedes añadir prompts base adicionales; al abrir un workspace elegirás cuál usar (por defecto el del sistema).</div>
      <div class="sp-list">
        @for (p of globalPrompts; track p.id) {
          <div class="sp-item" [class.default]="p.is_default">
            <div class="sp-head">
              <input class="sp-name" [(ngModel)]="p.name" [disabled]="p.is_default" placeholder="Nombre" />
              <span class="pill" *ngIf="p.is_default">default · inmutable</span>
              <span class="flex"></span>
              @if (!p.is_default) {
                <button pButton label="Guardar" class="p-button-sm p-button-outlined" (click)="saveGlobalPrompt(p)"></button>
                <button pButton label="Eliminar" class="p-button-sm p-button-danger p-button-outlined" (click)="deleteGlobalPrompt(p)"></button>
              }
            </div>
            <textarea class="sp-content" [(ngModel)]="p.content" [disabled]="p.is_default" rows="3" [placeholder]="p.is_default ? '(gestionado por el sistema)' : 'Contenido del system prompt base'"></textarea>
          </div>
        }
        @if (!globalPrompts.length) { <div class="path">Cargando…</div> }
      </div>
      <div class="sp-add">
        <div class="step"><strong>Añadir system prompt base</strong></div>
        <label>Nombre <input [(ngModel)]="newSpName" placeholder="Nombre" /></label>
        <label>Contenido <textarea [(ngModel)]="newSpContent" rows="3" placeholder="Contenido"></textarea></label>
        <div><button pButton label="Añadir prompt" icon="pi pi-plus" class="p-button-sm" (click)="createGlobalPrompt()" [disabled]="!newSpName.trim()"></button></div>
      </div>
      <div class="err" *ngIf="spErr">{{ spErr }}</div>
    </div>
  </p-dialog>

  <!-- Selector de system prompt al abrir workspace -->
  <p-dialog header="Abrir workspace" [(visible)]="openSelectVisible" [modal]="true" [style]="{width:'620px'}">
    <div class="wizard" *ngIf="openTarget">
      <div class="path">Workspace: <strong>{{ openTarget.name }}</strong></div>
      <label>System prompt base a usar
        <select [(ngModel)]="openSelectedPromptId">
          @for (p of globalPrompts; track p.id) { <option [value]="p.id">{{ p.name }}{{ p.is_default ? ' (default)' : '' }}</option> }
        </select>
      </label>
      <div class="path">Se aplicará como prompt base del sistema para este workspace (por defecto el del sistema). La gobernanza/delegación se inyecta aparte.</div>
      <div class="actions">
        <button pButton label="Cancelar" class="p-button-text" (click)="openSelectVisible=false"></button>
        <button pButton label="Abrir" icon="pi pi-check" (click)="confirmOpenWorkspace()" [disabled]="!openSelectedPromptId"></button>
      </div>
    </div>
  </p-dialog>

  <!-- Crear / editar workspace -->
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

      <div class="step"><strong>2) Prompt del workspace</strong></div>
      <div class="path">Instrucciones adicionales propias de este workspace. Se añaden al contexto del sistema (no reemplazan la gobernanza/delegación general). El system prompt base se elige al abrir el workspace.</div>
      <textarea [(ngModel)]="wsPrompt" rows="5" placeholder="Escribe aquí el prompt/instrucciones para este workspace (opcional)"></textarea>
      @if (editWs) {
        <label>Bindings de roles (JSON roleKey → agentId)
          <textarea [(ngModel)]="roleBindings" rows="4" placeholder='{"orchestration":"agent-id","harness_engineering":"agent-id","ux_ui":"agent-id"}'></textarea>
        </label>
      }

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
        <label class="row"><input type="checkbox" [(ngModel)]="useCustomChiefPrompt" /> Usar chief prompt custom (reemplaza la plantilla de coordinación del chief)</label>
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
    .head-actions{display:flex;gap:8px;align-items:center}
    h2{margin:0 0 4px}.sub{margin:0;color:var(--text-secondary);font-size:12px}
    .list{display:flex;flex-direction:column;gap:10px}
    .card{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px;border:1px solid var(--border-color);border-radius:var(--radius-md);background:var(--bg-secondary)}
    .card.active{border-color:var(--accent-blue)}
    .name{font-weight:600;display:flex;align-items:center;gap:8px}.path,.mono{font-size:11px;color:var(--text-muted);font-family:var(--font-mono)}
    .pill{font-size:10px;padding:2px 6px;border-radius:999px;background:rgba(59,130,246,.2);color:var(--accent-blue)}
    .actions{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}.empty{color:var(--text-muted);padding:24px;text-align:center;border:1px dashed var(--border-color);border-radius:var(--radius-md)}
    .wizard{display:flex;flex-direction:column;gap:10px}.step{margin-top:6px;font-size:13px}
    label{display:flex;flex-direction:column;gap:4px;font-size:12px} label.row,.row{flex-direction:row;align-items:center;gap:8px;display:flex}
    input,textarea,select{padding:6px 8px;background:var(--bg-secondary);border:1px solid var(--border-color);color:var(--text-primary);border-radius:var(--radius-sm)}
    .flex{flex:1}.browser{border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:8px;background:var(--bg-secondary)}
    .browse-header{display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);font-family:var(--font-mono)}
    .dirs{max-height:160px;overflow:auto;display:grid;grid-template-columns:repeat(2,1fr);gap:4px;margin:6px 0}
    .dir{padding:4px 6px;border-radius:4px;cursor:pointer;font-size:12px}.dir:hover{background:var(--bg-tertiary)}
    .err{color:var(--accent-red);font-size:12px}.ok{color:var(--accent-green,#22c55e);font-size:12px}
    .color-row{display:flex;align-items:center;gap:8px}
    .color-btn{width:36px;height:28px;border-radius:6px;border:1px solid var(--border-color);cursor:pointer;padding:0}
    .color-hidden{position:absolute;opacity:0;width:0;height:0;pointer-events:none}
    code{font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)}
    .sp-list{display:flex;flex-direction:column;gap:10px}
    .sp-item{border:1px solid var(--border-color);border-radius:var(--radius-sm);padding:10px;display:flex;flex-direction:column;gap:6px;background:var(--bg-secondary)}
    .sp-item.default{opacity:.95}
    .sp-head{display:flex;align-items:center;gap:8px}
    .sp-name{font-weight:600;max-width:320px}
    .sp-content{width:100%;font-family:var(--font-mono);font-size:12px}
    .sp-add{border-top:1px dashed var(--border-color);padding-top:10px;display:flex;flex-direction:column;gap:8px}
  `]
})
export class WorkspacesComponent implements OnInit {
  workspaces: IWorkspace[] = [];
  wizardOpen=false; editWs: IWorkspace|null=null; saving=false; error='';
  newPath=''; browseVisible=false; browseCurrent=''; browseParent:string|null=null; browseDirs:any[]=[];
  wsName=''; wsPrompt=''; roleBindings='';
  chiefNickname=''; modelProviders: Array<{provider:string;models:string[]}>=[]; selectedProvider=''; selectedModelId=''; chiefModel=''; chiefColor=this.randColor(); chiefInstruction=''; useCustomChiefPrompt=false; customChiefPrompt=''; hitlEnabled=false;
  // config modal
  configOpen=false; piAgentDir=''; appSettingsDefaults: {piAgentDir?: string} = {}; appSettingsEffective: {piAgentDir?: string} = {}; savingSettings=false; settingsMsg=''; settingsErr='';
  // global/base system prompts
  globalPrompts: ISystemPrompt[]=[]; spErr=''; newSpName=''; newSpContent='';
  // open-workspace prompt selector
  openSelectVisible=false; openTarget: IWorkspace|null=null; openSelectedPromptId='default-system-prompt';

  constructor(private ws: WorkspaceService, private agents: AgentService, private sp: SystemPromptsService, private router: Router, private feedback: UiFeedbackService, private appSettings: AppSettingsService) {}

  ngOnInit(){ this.load(); this.agents.getModels().subscribe(m=>{this.modelProviders=(m as any)||[]; this.onProviderChange();}); }

  openConfig(){ this.configOpen=true; }
  loadSettings(){ this.appSettings.get().subscribe({ next: (r: any) => { this.appSettingsDefaults = r.defaults || {}; this.appSettingsEffective = r.effective || {}; this.piAgentDir = (r.values && r.values['pi.agentDir']) || ''; }, error: () => {} }); }
  useDefaultPiAgentDir(){ this.piAgentDir = ''; }
  saveSettings(){
    this.savingSettings = true; this.settingsMsg=''; this.settingsErr='';
    const v = (this.piAgentDir || '').trim();
    this.appSettings.update({ piAgentDir: v ? v : null }).subscribe({
      next: (r: any) => { this.appSettingsDefaults = r.defaults || {}; this.appSettingsEffective = r.effective || {}; this.piAgentDir = (r.values && r.values['pi.agentDir']) || ''; this.savingSettings=false; this.settingsMsg='Configuración guardada.'; setTimeout(()=>this.settingsMsg='', 2500); this.feedback.success('Configuración de Pi guardada.'); },
      error: (e) => { this.savingSettings=false; this.settingsErr = e?.error?.message || 'No se pudo guardar la configuración.'; this.feedback.error(this.settingsErr); }
    });
  }

  loadGlobalPrompts(){
    this.spErr='';
    this.sp.listGlobal().subscribe({ next: (l)=>{ this.globalPrompts = l || []; if(!this.openSelectedPromptId) this.openSelectedPromptId='default-system-prompt'; }, error: ()=>{ this.spErr='No se pudieron cargar los system prompts.'; } });
  }
  createGlobalPrompt(){
    const name=(this.newSpName||'').trim(); if(!name) return;
    this.sp.createGlobal(name, this.newSpContent||'').subscribe({ next: ()=>{ this.newSpName=''; this.newSpContent=''; this.loadGlobalPrompts(); this.feedback.success('System prompt añadido.'); }, error: (e)=>{ this.spErr=e?.error?.error||'No se pudo crear.'; } });
  }
  saveGlobalPrompt(p: ISystemPrompt){
    if(p.is_default) return;
    this.sp.updateGlobal(p.id, { name: p.name, content: p.content }).subscribe({ next: ()=> this.feedback.success('System prompt guardado.'), error: (e)=> this.feedback.error(e?.error?.error||'No se pudo guardar.') });
  }
  async deleteGlobalPrompt(p: ISystemPrompt){
    if(p.is_default) return;
    const ok = await this.feedback.confirm({ title: 'Eliminar system prompt', message: `¿Eliminar "${p.name}"?`, confirmLabel: 'Eliminar', danger: true }); if(!ok) return;
    this.sp.deleteGlobal(p.id).subscribe({ next: ()=>{ this.loadGlobalPrompts(); this.feedback.success('System prompt eliminado.'); }, error: (e)=> this.feedback.error(e?.error?.error||'No se pudo eliminar.') });
  }

  load(){ this.ws.getAll().subscribe(l=>this.workspaces=l); }
  openWorkspace(w:IWorkspace){
    this.openTarget = w;
    this.openSelectedPromptId = w.active_system_prompt_id || 'default-system-prompt';
    this.openSelectVisible = true;
    if(!this.globalPrompts.length) this.loadGlobalPrompts();
  }
  confirmOpenWorkspace(){
    if(!this.openTarget) return;
    const w = this.openTarget;
    const promptId = this.openSelectedPromptId || 'default-system-prompt';
    this.ws.update(w.id, { active_system_prompt_id: promptId }).subscribe({
      next: () => this.ws.activate(w.id).subscribe(()=>{
        this.openSelectVisible=false; this.load(); this.router.navigateByUrl(`/workspaces/${w.id}/swarm-monitor`);
      }),
      error: ()=> this.feedback.error('No se pudo actualizar el system prompt del workspace.')
    });
  }

  async deleteWorkspace(w:IWorkspace){ const ok = await this.feedback.confirm({ title: 'Eliminar workspace', message: `Eliminar workspace "${w.name}" (${w.path})?\nEsto eliminará sus agentes y tareas.`, confirmLabel: 'Eliminar', danger: true }); if(!ok) return; this.ws.delete(w.id).subscribe({ next: ()=>{ this.feedback.success(`Workspace "${w.name}" eliminado.`); this.load(); }, error: ()=> this.feedback.error('No se pudo eliminar el workspace.') }); }
  openCreate(){ this.editWs=null; this.resetWizard(); this.wizardOpen=true; this.chiefNickname='Chief-'+Math.random().toString(36).slice(2,5); this.chiefColor=this.randColor(); }
  openEdit(w:IWorkspace){ this.editWs=w; this.resetWizard(); this.wizardOpen=true; this.wsName=w.name; this.hitlEnabled=!!w.hitl_enabled; this.wsPrompt = (w as any).workspace_prompt || ''; this.roleBindings = (w as any).role_bindings || ''; }
  resetWizard(){ this.error=''; this.saving=false; this.newPath=''; this.browseVisible=false; this.wsName=''; this.wsPrompt=''; this.roleBindings=''; this.chiefNickname=''; this.chiefColor=''; this.selectedProvider=''; this.selectedModelId=''; this.chiefModel=''; this.chiefInstruction=''; this.useCustomChiefPrompt=false; this.customChiefPrompt=''; this.hitlEnabled=false; }
  browse(p:string){ this.browseVisible=true; this.ws.browseDirs(p||undefined).subscribe(r=>{ this.browseCurrent=r.current; this.browseParent=r.parent; this.browseDirs=r.dirs||[]; if(r.error) this.error=r.error; }); }
  useFolder(){ this.newPath=this.browseCurrent; this.browseVisible=false; this.wsName=this.newPath.split('/').filter(Boolean).pop()||'workspace'; }
  currentModels(): string[] { const p=this.modelProviders.find(x=>x.provider===this.selectedProvider); return p?p.models:[]; }
  onProviderChange(){ if(!this.selectedProvider && this.modelProviders[0]) this.selectedProvider=this.modelProviders[0].provider; const ms=this.currentModels(); if(!ms.includes(this.selectedModelId)) this.selectedModelId = ms[0]||''; if(this.selectedProvider&&this.selectedModelId) this.chiefModel=`${this.selectedProvider}/${this.selectedModelId}`; }
  randColor(){ const p=['#3b82f6','#22c55e','#a855f7','#f59e0b','#06b6d4','#ec4899','#84cc16','#14b8a6','#f43f5e','#6366f1','#0ea5e9','#10b981']; return p[Math.floor(Math.random()*p.length)]; }
  save(){
    this.error='';
    if(this.editWs){
      this.saving=true;
      this.ws.update(this.editWs.id,{name:this.wsName||this.editWs.name, hitl_enabled:this.hitlEnabled, workspace_prompt: (this.wsPrompt||'').trim() || null, role_bindings: (this.roleBindings||'').trim() || null} as any).subscribe({next:()=>{this.wizardOpen=false; this.saving=false; this.load(); this.ws.refreshActive();}, error:(e)=>{this.error=e?.error?.message||'Error'; this.saving=false;}});
      return;
    }
    if(!this.newPath.trim()) { this.error='La carpeta es obligatoria'; return; }
    if(!this.selectedProvider||!this.selectedModelId){ this.error='Proveedor y modelo son obligatorios'; return; }
    if(!this.chiefColor) this.chiefColor=this.randColor();
    this.saving=true; this.chiefModel=`${this.selectedProvider}/${this.selectedModelId}`;
    this.ws.create(this.wsName||'workspace', this.newPath.trim(), this.hitlEnabled, (this.wsPrompt||'').trim() || null).subscribe({
      next:(ws)=>{
        const finish=()=>{ const chief:any={ id:`chief-${Date.now().toString(36)}`, name:this.chiefNickname||'Chief', nickname:this.chiefNickname||'Chief', role:'CHIEF', status:'IDLE', workspace_id:ws.id, color:this.chiefColor, additional_instruction:this.chiefInstruction||null, inject_context:true, task_state:{model:this.chiefModel} };
          this.agents.create(chief).subscribe({ next:()=>{ this.ws.refreshActive(); this.wizardOpen=false; this.saving=false; this.load(); setTimeout(()=>this.router.navigateByUrl(`/workspaces/${ws.id}/swarm-monitor`), 50); }, error:(e)=>{this.error=e?.error?.message||'Error creando chief (¿color duplicado?)'; this.saving=false;} });
        };
        if(this.useCustomChiefPrompt && this.customChiefPrompt.trim()) this.ws.update(ws.id,{custom_chief_prompt:this.customChiefPrompt}).subscribe({next:finish,error:finish}); else finish();
      }, error:(e)=>{ this.error=e?.error?.message||'Error creando workspace'; this.saving=false; }
    });
  }
}
