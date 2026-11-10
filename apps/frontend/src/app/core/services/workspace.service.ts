import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';

export interface IWorkspace {
  id: string; name: string; path: string; is_active: boolean;
  active_system_prompt_id?: string | null; custom_chief_prompt?: string | null; hitl_enabled?: boolean;
  created_at?: string | null;
}
const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  getActiveValue(): any { return (this as any)._active; }
  private _active: any = null;
  private activeSubject = new BehaviorSubject<IWorkspace | null>(null);
  active$ = this.activeSubject.asObservable();
  constructor(private http: HttpClient) { this.refreshActive(); }
  get active(): IWorkspace | null { return this.activeSubject.getValue(); }
  getAll(): Observable<IWorkspace[]> { return this.http.get<IWorkspace[]>(`${BASE_URL}/workspaces`); }
  getActive(): Observable<IWorkspace | null> { return this.http.get<IWorkspace | null>(`${BASE_URL}/workspaces/active`); }
  refreshActive(): void { this.getActive().subscribe(ws => { const cur=this.activeSubject.getValue(); if((cur?.id||null)!==(ws?.id||null) || (!!cur)!==(!!ws)) this.activeSubject.next(ws); }); }
  create(name: string, path: string, hitl_enabled = false): Observable<IWorkspace> { return this.http.post<IWorkspace>(`${BASE_URL}/workspaces`, { name, path, hitl_enabled }).pipe(tap(ws => this.activeSubject.next(ws))); }
  activate(id: string): Observable<any> { return this.http.put(`${BASE_URL}/workspaces/${id}/activate`, {}).pipe(tap(() => this.refreshActive())); }
  update(id: string, body: Partial<IWorkspace>) { return this.http.put<IWorkspace>(`${BASE_URL}/workspaces/${id}`, body).pipe(tap(() => this.refreshActive())); }
  delete(id: string) { return this.http.delete(`${BASE_URL}/workspaces/${id}`).pipe(tap(() => this.refreshActive())); }
  resetSession(id: string) { return this.http.post(`${BASE_URL}/workspaces/${id}/session/reset`, {}); }
  stopAll(id: string) { return this.http.post(`${BASE_URL}/workspaces/${id}/stop-all`, {}); }
  clearAllSessions(id: string) { return this.http.post(`${BASE_URL}/workspaces/${id}/sessions/clear-all`, {}); }
  browseDirs(path?: string) { const params = path ? `?path=${encodeURIComponent(path)}` : ''; return this.http.get<any>(`${BASE_URL}/workspaces/browse/dirs${params}`); }
}
