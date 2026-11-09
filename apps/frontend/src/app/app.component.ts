import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    <div class="app-shell">
      <nav class="sidebar">
        <h1>Pi-Hive</h1>
        <a routerLink="/swarm-monitor">Swarm Monitor</a>
        <a routerLink="/memory-timeline">Memory Timeline</a>
        <a routerLink="/human-in-the-loop">Human-in-the-Loop</a>
      </nav>
      <main class="content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [`
    .app-shell { display: flex; height: 100vh; }
    .sidebar { width: 220px; background: #1a1a2e; color: #eee; padding: 1rem; }
    .sidebar h1 { font-size: 1.2rem; margin-bottom: 1rem; }
    .sidebar a { display: block; color: #aaa; text-decoration: none; padding: 0.5rem 0; }
    .sidebar a:hover { color: #fff; }
    .content { flex: 1; padding: 1rem; overflow: auto; background: #0f0f1a; color: #eee; }
  `],
})
export class AppComponent {}