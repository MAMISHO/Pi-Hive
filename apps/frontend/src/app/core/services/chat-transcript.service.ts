import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class ChatTranscriptService {
  constructor(private readonly http: HttpClient) {}
  getByAgent(agentId: string, before?: number, limit = 50): Observable<any[]> {
    const params = new URLSearchParams(); if (before) params.set('before', String(before)); params.set('limit', String(limit));
    return this.http.get<any[]>(`${BASE_URL}/chat-transcript/agent/${agentId}?${params.toString()}`);
  }
}
