import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Observable, Subject } from 'rxjs';
import { StreamTextEvent, StreamToolEvent, StatusChangeEvent } from '../models/stream.model';

const BASE_URL = 'http://localhost:8090';

@Injectable({ providedIn: 'root' })
export class WebsocketService {
  private socket: Socket;

  private streamTextSubject = new Subject<StreamTextEvent>();
  private streamToolSubject = new Subject<StreamToolEvent>();
  private statusChangeSubject = new Subject<StatusChangeEvent>();

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

    this.socket.on('agent:stream:text', (data: StreamTextEvent) => {
      this.streamTextSubject.next(data);
    });

    this.socket.on('agent:stream:tool', (data: StreamToolEvent) => {
      this.streamToolSubject.next(data);
    });

    this.socket.on('agent:status-change', (data: StatusChangeEvent) => {
      this.statusChangeSubject.next(data);
    });
  }

  connect(): void {
    if (!this.socket.connected) {
      this.socket.connect();
    }
  }

  disconnect(): void {
    if (this.socket.connected) {
      this.socket.disconnect();
    }
  }
}
