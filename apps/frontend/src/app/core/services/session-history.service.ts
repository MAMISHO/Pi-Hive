import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class SessionHistoryService {
  constructor(private readonly http: HttpClient) {}
  getByWorkspace(workspaceId: string, agentId?: string): Observable<any[]> {
    const q = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
    return this.http.get<any[]>(`${BASE_URL}/session-history/workspace/${encodeURIComponent(workspaceId)}${q}`);
  }
}
