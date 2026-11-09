import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { IAgent, AgentStatus } from '../models/agent.model';

const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class AgentService {
  constructor(private http: HttpClient) {}

  getAll(): Observable<IAgent[]> {
    return this.http.get<IAgent[]>(`${BASE_URL}/agents`);
  }

  getOne(id: string): Observable<IAgent> {
    return this.http.get<IAgent>(`${BASE_URL}/agents/${id}`);
  }

  create(agent: IAgent): Observable<IAgent> {
    return this.http.post<IAgent>(`${BASE_URL}/agents`, agent);
  }

  updateStatus(id: string, status: AgentStatus): Observable<void> {
    return this.http.put<void>(`${BASE_URL}/agents/${id}/status`, { status });
  }

  getModels(): Observable<any> {
    return this.http.get<any>(`${BASE_URL}/agents/models`);
  }

  stop(id: string): Observable<{ stopped: boolean }> {
    return this.http.put<{ stopped: boolean }>(`${BASE_URL}/agents/${id}/stop`, {});
  }

  deactivate(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE_URL}/agents/${id}`);
  }

  adminList(): Observable<IAgent[]> {
    return this.http.get<IAgent[]>(`${BASE_URL}/agents/admin/list`);
  }
}
