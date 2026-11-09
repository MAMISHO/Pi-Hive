import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Server } from 'socket.io';

import { agentEventEmitter } from './agent-runner.service.js';

@WebSocketGateway({ cors: true })
export class AgentGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  afterInit() {
    agentEventEmitter.on('agent:stream:text', (data: { agentId: string; delta: string }) => {
      this.server?.emit('agent:stream:text', data);
    });
    agentEventEmitter.on('agent:stream:tool', (data: { agentId: string; toolName: string; args: any }) => {
      this.server?.emit('agent:stream:tool', data);
    });
  }
}