import { Module } from '@nestjs/common';
import { AgentChatEventEntity } from './infra/persistence/sequalize/entities/agent-chat-event.schema.js';
import { ChatTranscriptController } from './infra/http/chat-transcript.controller.js';

@Module({
  controllers: [ChatTranscriptController],
  providers: [{ provide: 'CHAT_EVENT_MODEL', useValue: AgentChatEventEntity }],
  exports: ['CHAT_EVENT_MODEL'],
})
export class ChatTranscriptModule {}
