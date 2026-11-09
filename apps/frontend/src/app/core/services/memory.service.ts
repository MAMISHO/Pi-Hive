import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { IAgentMemory } from '../models/memory.model';

const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class MemoryService {
  constructor(private http: HttpClient) {}

  getByAgent(agentId: string): Observable<IAgentMemory[]> {
    return this.http.get<IAgentMemory[]>(`${BASE_URL}/memories/agent/${agentId}`);
  }

  getLatestByAgent(agentId: string): Observable<IAgentMemory | null> {
    return this.http.get<IAgentMemory | null>(`${BASE_URL}/memories/agent/${agentId}/latest`);
  }
}
