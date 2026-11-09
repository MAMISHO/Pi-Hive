import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ITaskQueue, TaskStatus } from '../models/task.model';

const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class TaskService {
  constructor(private http: HttpClient) {}

  getAll(): Observable<ITaskQueue[]> { return this.http.get<ITaskQueue[]>(`${BASE_URL}/tasks`); }
  getByWorkspace(workspaceId: string): Observable<ITaskQueue[]> { return this.http.get<ITaskQueue[]>(`${BASE_URL}/tasks?workspaceId=${encodeURIComponent(workspaceId)}`); }
  clearByWorkspace(workspaceId: string): Observable<any> { return this.http.delete(`${BASE_URL}/tasks/workspace/${workspaceId}/clear`); }

  getByReceiver(agentId: string): Observable<ITaskQueue[]> {
    return this.http.get<ITaskQueue[]>(`${BASE_URL}/tasks/receiver/${agentId}`);
  }

  getByStatus(status: TaskStatus): Observable<ITaskQueue[]> {
    return this.http.get<ITaskQueue[]>(`${BASE_URL}/tasks/status/${status}`);
  }

  create(task: ITaskQueue): Observable<ITaskQueue> {
    return this.http.post<ITaskQueue>(`${BASE_URL}/tasks`, task);
  }

  updateStatus(id: number, status: TaskStatus): Observable<void> {
    return this.http.put<void>(`${BASE_URL}/tasks/${id}/status`, { status });
  }

  updatePayload(id: number, payload: string): Observable<void> {
    return this.http.put<void>(`${BASE_URL}/tasks/${id}/payload`, { payload });
  }

  remove(id: number): Observable<void> {
    return this.http.delete<void>(`${BASE_URL}/tasks/${id}`);
  }
}
