import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { WorkspaceService, IWorkspace } from '../../core/services/workspace.service';

@Component({
  selector: 'app-workspace-switcher',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, DialogModule, InputTextModule, SelectModule],
  template: `
    <div class="ws-switcher">
      <div class="ws-label">Workspace</div>
      <div class="ws-row">
        <button class="ws-current" (click)="showPicker = true">
          <span class="ws-icon">📁</span>
          <span class="ws-name">{{ (ws.active$ | async)?.name || 'No workspace' }}</span>
          <span class="ws-path" *ngIf="(ws.active$ | async) as a">{{ a.path }}</span>
        </button>
        <button pButton icon="pi pi-folder-open" class="p-button-text p-button-sm" (click)="openOpenDialog()" title="Open folder"></button>
      </div>
    </div>

    <p-dialog header="Open Workspace" [(visible)]="showOpen" [modal]="true" [style]="{width:'560px'}">
      <div class="form">
        <label>Folder path</label>
        <div class="path-row">
          <input pInputText [(ngModel)]="newPath" placeholder="/path/to/your/project" class="path-input" />
          <button pButton type="button" icon="pi pi-folder-open" class="p-button-outlined p-button-sm" (click)="toggleBrowser()" title="Browse"></button>
        </div>
        <div class="browser" *ngIf="showBrowser">
          <div class="browser-header">
            <button pButton type="button" icon="pi pi-arrow-up" class="p-button-text p-button-sm" (click)="browseTo(browserParent)" [disabled]="!browserParent" title="Up"></button>
            <span class="browser-path" [title]="browserCurrent">{{ browserCurrent }}</span>
            <button pButton type="button" label="Use this folder" class="p-button-sm" (click)="selectCurrentDir()"></button>
          </div>
          <div class="browser-list">
            <div class="browser-item" *ngFor="let d of browserDirs" (click)="browseTo(d.path)">
              <i class="pi pi-folder"></i> <span>{{ d.name }}</span>
            </div>
            <div class="browser-empty" *ngIf="!browserDirs.length && !browserError">No subdirectories</div>
            <div class="browser-error" *ngIf="browserError">{{ browserError }}</div>
          </div>
        </div>
        <label>Name (optional)</label>
        <input pInputText [(ngModel)]="newName" placeholder="My Project" />
        <div class="hint">Select a folder via Browse, or enter an absolute path. A native file picker isn’t available in the browser for security reasons; the Browse panel lists directories on the backend host.</div>
      </div>
      <ng-template pTemplate="footer">
        <button pButton label="Cancel" class="p-button-text" (click)="showOpen=false"></button>
        <button pButton label="Open" (click)="openWorkspace()" [disabled]="!newPath"></button>
      </ng-template>
    </p-dialog>

    <p-dialog header="Switch Workspace" [(visible)]="showPicker" [modal]="true" [style]="{width:'520px'}">
      <div class="ws-list">
        @for (w of workspaces; track w.id) {
          <div class="ws-item" [class.active]="w.is_active" (click)="switchTo(w)">
            <div class="ws-item-name">{{ w.name }}</div>
            <div class="ws-item-path">{{ w.path }}</div>
          </div>
        }
        @if (!workspaces.length) {
          <div class="empty">No workspaces yet. Click the folder icon to open one.</div>
        }
      </div>
    </p-dialog>
  `,
  styles: [`
    .ws-switcher { padding: 10px 12px; border-bottom: 1px solid var(--border-color); margin-bottom: 8px; }
    .ws-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
    .ws-row { display: flex; gap: 4px; align-items: center; }
    .ws-current { flex: 1; display: flex; align-items: center; gap: 8px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 8px 10px; cursor: pointer; color: var(--text-primary); text-align: left; overflow: hidden; }
    .ws-current:hover { border-color: var(--accent-blue); }
    .ws-name { font-size: 13px; font-weight: 600; white-space: nowrap; }
    .ws-path { font-size: 10px; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono); }
    .ws-icon { font-size: 14px; }
    .form { display: flex; flex-direction: column; gap: 8px; }
    .form label { font-size: 12px; color: var(--text-secondary); }
    .hint { font-size: 11px; color: var(--text-muted); }
    .path-row { display: flex; gap: 6px; }
    .path-input { flex: 1; }
    .browser { border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-primary); overflow: hidden; }
    .browser-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); }
    .browser-path { flex: 1; font-size: 11px; font-family: var(--font-mono); color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .browser-list { max-height: 220px; overflow-y: auto; }
    .browser-item { padding: 6px 10px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 8px; }
    .browser-item:hover { background: var(--bg-tertiary); }
    .browser-empty, .browser-error { padding: 10px; font-size: 12px; color: var(--text-muted); }
    .browser-error { color: var(--accent-red); }
    .ws-list { display: flex; flex-direction: column; gap: 6px; max-height: 320px; overflow-y: auto; }
    .ws-item { padding: 10px 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); cursor: pointer; }
    .ws-item:hover { background: var(--bg-tertiary); }
    .ws-item.active { border-color: var(--accent-blue); background: rgba(88,166,255,0.08); }
    .ws-item-name { font-size: 13px; font-weight: 600; }
    .ws-item-path { font-size: 11px; color: var(--text-muted); font-family: var(--font-mono); }
    .empty { color: var(--text-muted); font-size: 12px; text-align: center; padding: 16px; }
  `],
})
export class WorkspaceSwitcherComponent implements OnInit {
  showOpen = false;
  showPicker = false;
  showBrowser = false;
  newPath = '';
  newName = '';
  workspaces: IWorkspace[] = [];
  browserDirs: { name: string; path: string }[] = [];
  browserCurrent = '';
  browserParent: string | null = null;
  browserError = '';

  constructor(public ws: WorkspaceService) {}

  ngOnInit() {
    this.load();
  }

  load() {
    this.ws.getAll().subscribe(list => this.workspaces = list);
  }

  openOpenDialog() {
    this.showOpen = true;
    this.showBrowser = false;
  }

  toggleBrowser() {
    this.showBrowser = !this.showBrowser;
    if (this.showBrowser) {
      this.browseTo(this.newPath || '');
    }
  }

  browseTo(path: string) {
    this.browserError = '';
    this.ws.browseDirs(path || undefined).subscribe({
      next: (res) => {
        this.browserCurrent = res.current;
        this.browserParent = res.parent;
        this.browserDirs = res.dirs || [];
        this.browserError = res.error || '';
        if (!this.newPath) this.newPath = res.current;
      },
      error: (e) => { this.browserError = e?.message || 'Failed to browse'; },
    });
  }

  selectCurrentDir() {
    if (this.browserCurrent) {
      this.newPath = this.browserCurrent;
      if (!this.newName) this.newName = this.browserCurrent.split('/').filter(Boolean).pop() || '';
      this.showBrowser = false;
    }
  }

  openWorkspace() {
    this.ws.create(this.newName, this.newPath).subscribe(() => {
      this.showOpen = false;
      this.newPath = '';
      this.newName = '';
      this.showBrowser = false;
      this.load();
    });
  }

  switchTo(w: IWorkspace) {
    this.ws.activate(w.id).subscribe(() => {
      this.showPicker = false;
      this.load();
    });
  }
}
