import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiFeedbackService, ToastItem } from '../../core/services/ui-feedback.service';

@Component({
  selector: 'app-ui-feedback',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      @for (t of (ui.toasts$ | async) || []; track t.id) {
        <div class="toast" [class]="'toast ' + t.type" (click)="ui.dismissToast(t.id)">
          <span class="t-icon" aria-hidden="true">{{ icon(t.type) }}</span>
          <span class="t-msg">{{ t.message }}</span>
          <button type="button" class="t-close" (click)="ui.dismissToast(t.id); $event.stopPropagation()" aria-label="Cerrar">×</button>
        </div>
      }
    </div>

    @if ((ui.confirm$ | async); as c) {
      @if (c.open) {
        <div class="dialog-backdrop" (click)="ui.resolveConfirm(false)">
          <div class="dialog" role="dialog" aria-modal="true" [attr.aria-label]="c.title || 'Confirmar'" (click)="$event.stopPropagation()">
            <div class="dialog-head">
              <span class="d-icon" [class.danger]="c.danger" aria-hidden="true">!</span>
              <h3>{{ c.title || 'Confirmar acción' }}</h3>
            </div>
            <div class="dialog-body">{{ c.message }}</div>
            <div class="dialog-actions">
              <button type="button" class="btn ghost" (click)="ui.resolveConfirm(false)">{{ c.cancelLabel || 'Cancelar' }}</button>
              <button type="button" class="btn primary" [class.danger]="c.danger" (click)="ui.resolveConfirm(true)">{{ c.confirmLabel || 'Confirmar' }}</button>
            </div>
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .toast-stack { position: fixed; right: 16px; bottom: 16px; z-index: 4000; display: flex; flex-direction: column; gap: 8px; max-width: min(360px, calc(100vw - 32px)); pointer-events: none; }
    .toast { pointer-events: auto; display: flex; align-items: flex-start; gap: 8px; padding: 10px 10px 10px 12px; border-radius: 10px; border: 1px solid var(--border-color); background: rgba(22,27,34,0.96); color: var(--text-primary); box-shadow: 0 8px 24px rgba(0,0,0,0.35); font-size: 13px; line-height: 1.4; animation: toast-in .18s ease; backdrop-filter: blur(6px); }
    .toast.success { border-color: rgba(63,185,80,0.45); box-shadow: inset 3px 0 0 var(--accent-green, #3fb950), 0 8px 24px rgba(0,0,0,0.35); }
    .toast.error { border-color: rgba(248,81,73,0.45); box-shadow: inset 3px 0 0 var(--accent-red, #f85149), 0 8px 24px rgba(0,0,0,0.35); }
    .toast.warn { border-color: rgba(210,153,34,0.45); box-shadow: inset 3px 0 0 var(--accent-amber, #d29922), 0 8px 24px rgba(0,0,0,0.35); }
    .toast.info { border-color: rgba(88,166,255,0.45); box-shadow: inset 3px 0 0 var(--accent-blue, #58a6ff), 0 8px 24px rgba(0,0,0,0.35); }
    .t-icon { flex: 0 0 auto; width: 18px; height: 18px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; background: rgba(255,255,255,0.08); color: var(--text-secondary); margin-top: 1px; }
    .toast.success .t-icon { color: #bff3c9; background: rgba(63,185,80,0.18); }
    .toast.error .t-icon { color: #ffd2cf; background: rgba(248,81,73,0.18); }
    .toast.warn .t-icon { color: #ffe7b3; background: rgba(210,153,34,0.18); }
    .toast.info .t-icon { color: #d7eaff; background: rgba(88,166,255,0.18); }
    .t-msg { flex: 1 1 auto; }
    .t-close { flex: 0 0 auto; border: 0; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; margin-left: 2px; }
    .t-close:hover { color: var(--text-primary); }
    @keyframes toast-in { from { opacity: 0; transform: translateY(6px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

    .dialog-backdrop { position: fixed; inset: 0; z-index: 4100; background: rgba(1,4,9,0.6); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; padding: 16px; animation: fade-in .12s ease; }
    .dialog { width: min(440px, 100%); background: var(--bg-secondary, #161b22); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: 0 20px 48px rgba(0,0,0,0.5); padding: 16px 16px 14px; animation: dialog-in .16s ease; }
    .dialog-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .dialog-head h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .d-icon { width: 22px; height: 22px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; color: #d7eaff; background: rgba(88,166,255,0.18); border: 1px solid rgba(88,166,255,0.4); flex: 0 0 auto; }
    .d-icon.danger { color: #ffd2cf; background: rgba(248,81,73,0.18); border-color: rgba(248,81,73,0.45); }
    .dialog-body { font-size: 13.5px; line-height: 1.55; color: var(--text-secondary); margin: 2px 0 14px 32px; white-space: pre-wrap; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .btn { height: 34px; padding: 0 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid var(--border-color); background: rgba(255,255,255,0.03); color: var(--text-primary); transition: background .12s ease, border-color .12s ease; }
    .btn:hover { background: rgba(255,255,255,0.07); }
    .btn.ghost { color: var(--text-secondary); }
    .btn.primary { background: var(--accent-blue, #58a6ff); border-color: rgba(88,166,255,0.6); color: #041423; }
    .btn.primary:hover { filter: brightness(1.05); }
    .btn.primary.danger { background: var(--accent-red, #f85149); border-color: rgba(248,81,73,0.6); color: #fff; }
    @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes dialog-in { from { opacity: 0; transform: translateY(4px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (prefers-reduced-motion: reduce) { .toast, .dialog, .dialog-backdrop { animation: none; } }
  `]
})
export class UiFeedbackComponent {
  constructor(public ui: UiFeedbackService) {}
  icon(t: ToastItem['type']): string {
    switch (t) { case 'success': return '✓'; case 'error': return '×'; case 'warn': return '!'; default: return 'i'; }
  }
}
