import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

const BASE_URL = 'http://localhost:8090';

export interface AppSettingsResponse {
  values: Record<string, string>;
  defaults: { piAgentDir?: string };
  effective: { piAgentDir?: string };
}

@Injectable({ providedIn: 'root' })
export class AppSettingsService {
  constructor(private http: HttpClient) {}
  get(): Observable<AppSettingsResponse> { return this.http.get<AppSettingsResponse>(`${BASE_URL}/api/settings`); }
  update(body: { piAgentDir?: string | null }): Observable<AppSettingsResponse> { return this.http.put<AppSettingsResponse>(`${BASE_URL}/api/settings`, body); }
}
