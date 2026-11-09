import { Routes } from '@angular/router';
import { HiveLayoutComponent } from './features/hive/hive-layout.component';

export const routes: Routes = [
  { path: '', redirectTo: '/workspaces', pathMatch: 'full' },
  { path: 'workspaces', loadComponent: () => import('./features/workspaces/workspaces.component').then(m => m.WorkspacesComponent) },
  { path: '', component: HiveLayoutComponent, children: [
    { path: 'swarm-monitor', loadComponent: () => import('./features/swarm-monitor/swarm-monitor.component').then(m => m.SwarmMonitorComponent) },
    { path: 'memory-timeline', loadComponent: () => import('./features/memory-timeline/memory-timeline.component').then(m => m.MemoryTimelineComponent) },
    { path: 'human-in-the-loop', loadComponent: () => import('./features/human-in-the-loop/human-in-the-loop.component').then(m => m.HumanInTheLoopComponent) },
  ]},
];
