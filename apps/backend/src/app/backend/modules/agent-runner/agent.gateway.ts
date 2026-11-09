import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';

import { agentEventEmitter } from './agent-runner.service.js';

@WebSocketGateway({ cors: true })
export class AgentGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  afterInit() {
    const fwd = (ev: string) => agentEventEmitter.on(ev, (data: any) => this.server?.emit(ev, data));
    fwd('agent:stream:text');
    fwd('agent:stream:tool');
    fwd('agent:stream:tool:start');
    fwd('agent:stream:tool:end');
    fwd('agent:status-change');
    fwd('agent:queue:updated');
    fwd('agent:run:started');
    fwd('agent:run:model');
    fwd('agent:run:finished');
    fwd('agent:run:error');
    fwd('agent:run:warning');
    fwd('agent:transcript:cleared');
    fwd('tasks:cleared');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { taskEventEmitter } = require('../task-queue/infra/persistence/sequalize/entities/task-queue.schema.js');
      taskEventEmitter.on('task:updated', (data: any) => this.server?.emit('task:updated', data));
      taskEventEmitter.on('task:changed', (data: any) => this.server?.emit('task:changed', data));
    } catch {}
  }
}