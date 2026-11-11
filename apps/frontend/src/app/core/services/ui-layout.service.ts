import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class UiLayoutService {
  private readonly _rightPanelOpen$ = new BehaviorSubject<boolean>(false);
  readonly rightPanelOpen$ = this._rightPanelOpen$.asObservable();

  get rightPanelOpen(): boolean { return this._rightPanelOpen$.value; }
  setRightPanelOpen(open: boolean): void { this._rightPanelOpen$.next(open); }
  toggleRightPanel(): void { this._rightPanelOpen$.next(!this._rightPanelOpen$.value); }
}
