import { Component, OnDestroy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SidebarLeftComponent } from '../../shared/sidebar-left/sidebar-left.component';
import { SidebarRightComponent } from '../../shared/sidebar-right/sidebar-right.component';
import { UiLayoutService } from '../../core/services/ui-layout.service';

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
export class HiveLayoutComponent implements OnDestroy {
  rightOpen = false;
  private sub: Subscription;
  constructor(private ui: UiLayoutService) {
    this.rightOpen = this.ui.rightPanelOpen;
    this.sub = this.ui.rightPanelOpen$.subscribe(v => this.rightOpen = v);
  }
  ngOnDestroy(): void { this.sub.unsubscribe(); }
}
