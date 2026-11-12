import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { IAgent } from '../models/agent.model';

export interface ModelProvider { provider: string; models: string[]; }
const BASE_URL = 'http://localhost:8090';
@Injectable({ providedIn: 'root' })
export class AgentService {
  constructor(private http: HttpClient) {}
  getAll(): Observable<IAgent[]> { return this.http.get<IAgent[]>(`${BASE_URL}/agents`); }
  getByWorkspace(workspaceId: string): Observable<IAgent[]> { return this.http.get<IAgent[]>(`${BASE_URL}/workspaces/${encodeURIComponent(workspaceId)}/agents`); }
  getAllAdmin(): Observable<IAgent[]> { return this.http.get<IAgent[]>(`${BASE_URL}/agents/admin/all`); }
  getModels(): Observable<ModelProvider[]> { return this.http.get<ModelProvider[]>(`${BASE_URL}/agents/models`); }
  getModelThinkingLevels(provider: string, modelId: string): Observable<{ available: string[]; default: string; reasoning: boolean }> { return this.http.get<{ available: string[]; default: string; reasoning: boolean }>(`${BASE_URL}/agents/models/thinking-levels`, { params: { provider, modelId } }); }
  setThinkingLevel(id: string, thinkingLevel: string): Observable<any> { return this.http.put(`${BASE_URL}/agents/${id}/thinking-level`, { thinkingLevel }); }
  getById(id: string): Observable<IAgent> { return this.http.get<IAgent>(`${BASE_URL}/agents/${id}`); }
  create(agent: IAgent): Observable<IAgent> { return this.http.post<IAgent>(`${BASE_URL}/agents`, agent); }
  update(id: string, agent: Partial<IAgent>): Observable<IAgent> { return this.http.put<IAgent>(`${BASE_URL}/agents/${id}`, agent); }
  edit(id: string, agent: Partial<IAgent>): Observable<IAgent> { return this.update(id, agent); }
  stop(id: string): Observable<any> { return this.http.put(`${BASE_URL}/agents/${id}/stop`, {}); }
  clearSession(id: string): Observable<any> { return this.http.put(`${BASE_URL}/agents/${id}/session/clear`, {}); }
  compactSession(id: string): Observable<any> { return this.http.put(`${BASE_URL}/agents/${id}/session/compact`, {}); }
  delete(id: string): Observable<any> { return this.http.delete(`${BASE_URL}/agents/${id}`); }
  hardDelete(id: string): Observable<any> { return this.http.delete(`${BASE_URL}/agents/${id}/permanent`); }
  restore(id: string): Observable<any> { return this.http.put(`${BASE_URL}/agents/${id}/restore`, {}); }
  adminList() { return this.getAllAdmin(); }
  deactivate(id: string) { return this.delete(id); }
  destroyPermanently(id: string) { return this.hardDelete(id); }
}
