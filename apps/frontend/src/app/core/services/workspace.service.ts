import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';

export interface IWorkspace {
  id: string;
  name: string;
  path: string;
  is_active: boolean;
  created_at?: string | null;
}

const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private activeSubject = new BehaviorSubject<IWorkspace | null>(null);
  active$ = this.activeSubject.asObservable();

  constructor(private http: HttpClient) {
    this.refreshActive();
  }

  get active(): IWorkspace | null { return this.activeSubject.getValue(); }

  getAll(): Observable<IWorkspace[]> {
    return this.http.get<IWorkspace[]>(`${BASE_URL}/workspaces`);
  }

  getActive(): Observable<IWorkspace | null> {
    return this.http.get<IWorkspace | null>(`${BASE_URL}/workspaces/active`);
  }

  refreshActive(): void {
    this.getActive().subscribe(ws => this.activeSubject.next(ws));
  }

  create(name: string, path: string): Observable<IWorkspace> {
    return this.http.post<IWorkspace>(`${BASE_URL}/workspaces`, { name, path }).pipe(
      tap(ws => this.activeSubject.next(ws))
    );
  }

  activate(id: string): Observable<any> {
    return this.http.put(`${BASE_URL}/workspaces/${id}/activate`, {}).pipe(
      tap(() => this.refreshActive())
    );
  }

  browseDirs(path?: string): Observable<{ current: string; parent: string | null; dirs: { name: string; path: string }[]; error?: string }> {
    const params = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.http.get<any>(`${BASE_URL}/workspaces/browse/dirs${params}`);
  }
}
