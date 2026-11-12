import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SidebarLeftComponent } from '../../shared/sidebar-left/sidebar-left.component';
import { SidebarRightComponent } from '../../shared/sidebar-right/sidebar-right.component';
import { UiLayoutService } from '../../core/services/ui-layout.service';
import { WorkspaceService } from '../../core/services/workspace.service';

@Component({
  selector: 'app-hive-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarLeftComponent, SidebarRightComponent],
  template: `
    <div class="hive-shell" [class.right-collapsed]="!rightOpen">
      <aside class="sidebar-left"><app-sidebar-left></app-sidebar-left></aside>
      <main class="center-panel">
        <div class="center-content"><router-outlet /></div>
      </main>
      <aside class="sidebar-right" *ngIf="rightOpen"><app-sidebar-right></app-sidebar-right></aside>
    </div>
  `,
  styles: [`
    .hive-shell{display:grid;grid-template-columns:var(--sidebar-width) minmax(0,1fr) var(--sidebar-right-width);height:calc(100vh - var(--header-height));overflow:hidden}
    .hive-shell.right-collapsed{grid-template-columns:var(--sidebar-width) minmax(0,1fr)}
    .center-panel{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;padding:12px 16px 8px;background:var(--bg-primary)}
    .center-content{flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column}
    .sidebar-left{height:100%;min-height:0;overflow:hidden}
    .sidebar-right{overflow:hidden}
    @media(max-width:1024px){.hive-shell,.hive-shell.right-collapsed{grid-template-columns:1fr}.sidebar-left,.sidebar-right{display:none}.center-panel{padding:12px}}
  `]
})
export class HiveLayoutComponent implements OnInit, OnDestroy {
  rightOpen = false;
  private sub: Subscription;
  private subs: Subscription[] = [];
  constructor(private ui: UiLayoutService, private route: ActivatedRoute, private router: Router, private ws: WorkspaceService) {
    this.rightOpen = this.ui.rightPanelOpen;
    this.sub = this.ui.rightPanelOpen$.subscribe(v => this.rightOpen = v);
  }

  ngOnInit(): void {
    // Route param marks the workspace (workspace-scoped routes: /workspaces/:workspaceId/...)
    this.subs.push(this.route.paramMap.subscribe(pm => {
      const wsId = pm.get('workspaceId');
      if (wsId) {
        const current = this.ws.active;
        if (!current || current.id !== wsId) {
          this.ws.getById(wsId).subscribe(w => { if (w) this.ws.activate(w.id).subscribe(); });
        }
      } else {
        // Legacy route (/swarm-monitor, etc): redirect to active workspace-scoped route when available
        const active = this.ws.active;
        if (active) {
          const child = this.route.firstChild?.snapshot.url?.[0]?.path || 'swarm-monitor';
          this.router.navigateByUrl(`/workspaces/${active.id}/${child}`, { replaceUrl: true });
        } else {
          this.ws.getActive().subscribe(w => {
            if (w) this.router.navigateByUrl(`/workspaces/${w.id}/swarm-monitor`, { replaceUrl: true });
          });
        }
      }
    }));

    // If active workspace changes while on a workspace-scoped route, keep URL in sync
    this.subs.push(this.ws.active$.subscribe(active => {
      const wsId = this.route.snapshot.paramMap.get('workspaceId');
      if (active && wsId && active.id !== wsId) {
        const child = this.route.firstChild?.snapshot.url?.[0]?.path || 'swarm-monitor';
        this.router.navigateByUrl(`/workspaces/${active.id}/${child}`, { replaceUrl: true });
      }
    }));
  }

  ngOnDestroy(): void {
    this.sub.unsubscribe();
    this.subs.forEach(s => s.unsubscribe());
  }
}
