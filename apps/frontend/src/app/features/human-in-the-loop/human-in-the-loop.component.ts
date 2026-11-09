import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-human-in-the-loop',
  standalone: true,
  imports: [FormsModule],
  template: `
    <h2>Human-in-the-Loop</h2>
    <p>Next Prompt Buffer - Edit and approve tasks</p>
    <div class="buffer">
      <textarea [(ngModel)]="promptText" rows="10" cols="80"></textarea>
      <div class="actions">
        <button (click)="approve()">Approve (Set PENDING)</button>
        <button (click)="hold()">Hold</button>
      </div>
    </div>
  `,
  styles: [`
    .buffer { display: flex; flex-direction: column; gap: 0.5rem; }
    textarea { background: #1e1e2e; color: #eee; border: 1px solid #333; border-radius: 4px; padding: 0.5rem; font-family: monospace; }
    .actions { display: flex; gap: 0.5rem; }
    button { padding: 0.5rem 1rem; border: none; border-radius: 4px; cursor: pointer; background: #4a4a6a; color: #fff; }
    button:hover { background: #5a5a7a; }
  `],
})
export class HumanInTheLoopComponent {
  promptText = '';
  approve() { console.log('Approved:', this.promptText); }
  hold() { console.log('Held'); }
}