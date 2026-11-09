import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: '/swarm-monitor', pathMatch: 'full' },
  {
    path: 'swarm-monitor',
    loadComponent: () => import('./features/swarm-monitor/swarm-monitor.component').then((m) => m.SwarmMonitorComponent),
  },
  {
    path: 'memory-timeline',
    loadComponent: () => import('./features/memory-timeline/memory-timeline.component').then((m) => m.MemoryTimelineComponent),
  },
  {
    path: 'human-in-the-loop',
    loadComponent: () => import('./features/human-in-the-loop/human-in-the-loop.component').then((m) => m.HumanInTheLoopComponent),
  },
];