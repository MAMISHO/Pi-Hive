import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { StreamTextEvent, StreamToolEvent, StatusChangeEvent, QueueUpdatedEvent, RunEvent, TaskChangedEvent } from '../models/stream.model';

const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  private socket: Socket;

  private streamTextSubject = new Subject<StreamTextEvent>();
  private streamToolSubject = new Subject<StreamToolEvent>();
  private statusChangeSubject = new Subject<StatusChangeEvent>();
  private transcriptClearedSubject = new Subject<any>();
  private tasksClearedSubject = new Subject<any>();
  private taskUpdatedSubject = new Subject<any>();
  private taskChangedSubject = new Subject<TaskChangedEvent>();
  private queueUpdatedSubject = new Subject<QueueUpdatedEvent>();
  private runEventSubject = new Subject<RunEvent>();
  private rehydrateSubject = new Subject<void>();

  transcriptCleared$ = this.transcriptClearedSubject.asObservable();
  tasksCleared$ = this.tasksClearedSubject.asObservable();
  taskUpdated$ = this.taskUpdatedSubject.asObservable();
  taskChanged$ = this.taskChangedSubject.asObservable();
  queueUpdated$ = this.queueUpdatedSubject.asObservable();
  runEvent$ = this.runEventSubject.asObservable();
  rehydrate$ = this.rehydrateSubject.asObservable();
  streamText$: Observable<StreamTextEvent> = this.streamTextSubject.asObservable();
  streamTool$: Observable<StreamToolEvent> = this.streamToolSubject.asObservable();
  statusChange$: Observable<StatusChangeEvent> = this.statusChangeSubject.asObservable();

  constructor() {
    this.socket = io(BASE_URL, {
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => this.rehydrateSubject.next());
    this.socket.on('agent:stream:text', (data: StreamTextEvent) => this.streamTextSubject.next(data));
    this.socket.on('agent:stream:tool', (data: StreamToolEvent) => this.streamToolSubject.next(data));
    this.socket.on('agent:stream:tool:start', (data: StreamToolEvent) => this.streamToolSubject.next({ ...data, phase: 'start' }));
    this.socket.on('agent:stream:tool:end', (data: StreamToolEvent) => this.streamToolSubject.next({ ...data, phase: data?.phase || 'end' }));
    this.socket.on('agent:status-change', (data: StatusChangeEvent) => this.statusChangeSubject.next(data));
    this.socket.on('agent:queue:updated', (data: QueueUpdatedEvent) => this.queueUpdatedSubject.next(data));
    this.socket.on('agent:run:started', (data: RunEvent) => this.runEventSubject.next({ ...data, type: 'started' }));
    this.socket.on('agent:run:model', (data: RunEvent) => this.runEventSubject.next({ ...data, type: 'model' }));
    this.socket.on('agent:run:finished', (data: RunEvent) => this.runEventSubject.next({ ...data, type: 'finished' }));
    this.socket.on('agent:run:error', (data: RunEvent) => this.runEventSubject.next({ ...data, type: 'error' }));
    this.socket.on('agent:run:warning', (data: RunEvent) => this.runEventSubject.next({ ...data, type: 'warning' }));
    this.socket.on('agent:transcript:cleared', (data: any) => this.transcriptClearedSubject.next(data));
    this.socket.on('tasks:cleared', (data: any) => this.tasksClearedSubject.next(data));
    this.socket.on('task:updated', (data: any) => this.taskUpdatedSubject.next(data));
    this.socket.on('task:changed', (data: TaskChangedEvent) => this.taskChangedSubject.next(data));
  }

  connect(): void { if (!this.socket.connected) this.socket.connect(); }
  disconnect(): void { if (this.socket.connected) this.socket.disconnect(); }
}
