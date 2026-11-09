import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DialogModule } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { AgentService } from '../../core/services/agent.service';
import { IAgent } from '../../core/models/agent.model';

@Component({
  selector: 'app-create-agent-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, DialogModule, ButtonModule, InputTextModule, SelectModule],
  template: `
    <p-dialog header="Create Agent" [(visible)]="visible" [modal]="true" [style]="{width:'440px'}" (onHide)="onHide()">
      <div class="form">
        <div class="field">
          <label for="nickname">Nickname</label>
          <input id="nickname" pInputText [(ngModel)]="nickname" placeholder="e.g. planner" />
        </div>
        <div class="field">
          <label for="role">Role</label>
          <p-select id="role" [(ngModel)]="role" [options]="roleOptions" optionLabel="label" optionValue="value" [style]="{width:'100%'}"></p-select>
        </div>
        <div class="field">
          <label for="model">Model (from Pi config)</label>
          <p-select id="model" [(ngModel)]="model" [options]="modelOptions" optionLabel="label" optionValue="value" [style]="{width:'100%'}" [filter]="true" filterBy="label"></p-select>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" (click)="visible = false" class="p-button-text"></button>
        <button pButton label="Create" icon="pi pi-check" (click)="submit()" [disabled]="!nickname || !model"></button>
      </ng-template>
    </p-dialog>
  `,
  styles: [`
    .form { display: flex; flex-direction: column; gap: 12px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 12px; color: var(--text-secondary); font-weight: 500; }
  `],
})
export class CreateAgentModalComponent implements OnInit {
  @Input() visible = false;
  @Output() visibleChange = new EventEmitter<boolean>();
  @Output() created = new EventEmitter<IAgent>();

  nickname = '';
  role: 'CHIEF' | 'WORKER' = 'WORKER';
  model = '';
  roleOptions = [
    { label: 'CHIEF', value: 'CHIEF' },
    { label: 'WORKER', value: 'WORKER' },
  ];
  modelOptions: { label: string; value: string }[] = [];

  constructor(private agentService: AgentService) {}

  ngOnInit(): void {
    this.agentService.getModels().subscribe({
      next: (res: any) => {
        const opts: { label: string; value: string }[] = [];
        const providers = Array.isArray(res) ? res : [];
        for (const p of providers) {
          for (const m of p.models || []) {
            opts.push({ label: `${p.provider} - ${m.name || m.id}`, value: `${p.provider}/${m.id}` });
          }
        }
        this.modelOptions = opts;
        if (opts.length && !this.model) this.model = opts[0].value;
      },
      error: () => {},
    });
  }

  onHide(): void {
    this.visible = false;
    this.visibleChange.emit(false);
  }

  submit(): void {
    const agent: IAgent = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `agent-${Date.now()}`,
      name: this.nickname,
      nickname: this.nickname,
      role: this.role,
      status: 'IDLE',
      current_session_id: null,
      task_state: { model: this.model },
      workspace_id: null,
    };
    this.agentService.create(agent).subscribe({
      next: (created) => {
        this.created.emit(created);
        this.visible = false;
        this.visibleChange.emit(false);
        this.nickname = '';
      },
      error: () => {},
    });
  }
}