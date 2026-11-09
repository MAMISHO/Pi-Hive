import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
const BASE_URL = 'http://localhost:8090';
export interface ISystemPrompt { id: string; workspace_id: string | null; name: string; content: string; is_default: boolean; }
@Injectable({ providedIn: 'root' })
export class SystemPromptsService {
  constructor(private http: HttpClient) {}
  list(workspaceId: string): Observable<ISystemPrompt[]> { return this.http.get<ISystemPrompt[]>(`${BASE_URL}/workspaces/${workspaceId}/system-prompts`); }
  create(workspaceId: string, name: string, content: string) { return this.http.post(`${BASE_URL}/workspaces/${workspaceId}/system-prompts`, { name, content }); }
  update(workspaceId: string, id: string, body: Partial<ISystemPrompt>) { return this.http.put(`${BASE_URL}/workspaces/${workspaceId}/system-prompts/${id}`, body); }
  delete(workspaceId: string, id: string) { return this.http.delete(`${BASE_URL}/workspaces/${workspaceId}/system-prompts/${id}`); }
}
