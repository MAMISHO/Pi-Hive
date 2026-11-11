import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, filter, take } from 'rxjs';

export interface ToastItem {
  id: number;
  type: 'success' | 'error' | 'info' | 'warn';
  message: string;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  open: boolean;
  resolve?: (v: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class UiFeedbackService {
  private seq = 0;
  private toastsSub = new BehaviorSubject<ToastItem[]>([]);
  toasts$ = this.toastsSub.asObservable();

  private confirmSub = new BehaviorSubject<ConfirmState>({ open: false, message: '' });
  confirm$ = this.confirmSub.asObservable();

  toast(message: string, type: ToastItem['type'] = 'info', ms = 3200): void {
    const id = ++this.seq;
    const item: ToastItem = { id, type, message };
    this.toastsSub.next([...this.toastsSub.value, item]);
    window.setTimeout(() => this.dismissToast(id), ms);
  }

  success(message: string, ms?: number) { this.toast(message, 'success', ms); }
  error(message: string, ms?: number) { this.toast(message, 'error', ms ?? 4200); }
  info(message: string, ms?: number) { this.toast(message, 'info', ms); }
  warn(message: string, ms?: number) { this.toast(message, 'warn', ms); }

  dismissToast(id: number): void {
    this.toastsSub.next(this.toastsSub.value.filter(t => t.id !== id));
  }

  confirm(options: ConfirmOptions | string): Promise<boolean> {
    const opts: ConfirmOptions = typeof options === 'string' ? { message: options } : options;
    // if one is already open, resolve false to avoid stacking issues
    const cur = this.confirmSub.value;
    if (cur.open && cur.resolve) cur.resolve(false);
    return new Promise<boolean>((resolve) => {
      this.confirmSub.next({ open: true, resolve, danger: false, confirmLabel: 'Confirmar', cancelLabel: 'Cancelar', title: 'Confirmar acción', ...opts });
    });
  }

  resolveConfirm(value: boolean): void {
    const cur = this.confirmSub.value;
    if (cur.resolve) cur.resolve(value);
    this.confirmSub.next({ open: false, message: '' });
  }
}
