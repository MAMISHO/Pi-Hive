import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SidebarLeftComponent } from '../../shared/sidebar-left/sidebar-left.component';
import { SidebarRightComponent } from '../../shared/sidebar-right/sidebar-right.component';

@Component({
  selector: 'app-hive-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, SidebarLeftComponent, SidebarRightComponent],
  template: `
    <div class="hive-shell">
      <aside class="sidebar-left"><app-sidebar-left></app-sidebar-left></aside>
      <main class="center-panel"><router-outlet /></main>
      <aside class="sidebar-right"><app-sidebar-right></app-sidebar-right></aside>
    </div>
  `,
  styles: [`
    .hive-shell{display:grid;grid-template-columns:var(--sidebar-width) 1fr var(--sidebar-right-width);height:calc(100vh - var(--header-height));overflow:hidden}
    .center-panel{overflow-y:auto;padding:16px;background:var(--bg-primary)}
    @media(max-width:1024px){.hive-shell{grid-template-columns:1fr}.sidebar-left,.sidebar-right{display:none}}
  `]
})
export class HiveLayoutComponent {}
