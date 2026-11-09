import { Controller, Get, Param, Query } from '@nestjs/common';
import { AgentChatEventEntity } from '../persistence/sequalize/entities/agent-chat-event.schema.js';

@Controller('chat-transcript')
export class ChatTranscriptController {
  @Get('agent/:agentId')
  async getForAgent(@Param('agentId') agentId: string, @Query('before') before?: string, @Query('limit') limit?: string) {
    const where: any = { agent_id: agentId };
    if (before) where.id = { [(require('sequelize') as any).Op.lt]: Number(before) };
    const rows = await AgentChatEventEntity.findAll({ where, order: [['id','DESC']], limit: Math.min(Number(limit)||50, 200) });
    return rows.reverse().map(r => r.toJSON());
  }
}
