import { Module } from '@nestjs/common';
import { AgentSessionHistoryEntity } from './infra/persistence/sequalize/entities/agent-session-history.schema.js';
import { SessionHistoryController } from './infra/http/session-history.controller.js';

@Module({
  controllers: [SessionHistoryController],
  providers: [{ provide: 'SESSION_HISTORY_MODEL', useValue: AgentSessionHistoryEntity }],
  exports: ['SESSION_HISTORY_MODEL'],
})
export class SessionHistoryModule {}
