import { Controller, Get, Param, Query } from '@nestjs/common';
import { AgentSessionHistoryEntity } from '../persistence/sequalize/entities/agent-session-history.schema.js';

@Controller('session-history')
export class SessionHistoryController {
  @Get('workspace/:workspaceId')
  async getForWorkspace(@Param('workspaceId') workspaceId: string, @Query('agentId') agentId?: string) {
    const where: any = { workspace_id: workspaceId };
    if (agentId) where.agent_id = agentId;
    const rows = await AgentSessionHistoryEntity.findAll({ where, order: [['id','DESC']], limit: 200 });
    return rows.map(r => r.toJSON());
  }
}
