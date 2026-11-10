import { Controller, Get, Param, Query } from '@nestjs/common';
import { RunTraceService } from './run-trace.service.js';

@Controller('api/traces')
export class RunTraceController {
  constructor(private trace: RunTraceService) {}

  @Get()
  async listTraces(
    @Query('agentId') agentId?: string,
    @Query('taskId') taskId?: string,
    @Query('runId') runId?: string,
    @Query('limit') limit?: string,
  ) {
    const tid = taskId ? parseInt(taskId, 10) : undefined;
    const lim = limit ? Math.min(parseInt(limit, 10), 500) : 50;
    return this.trace.listTraces(agentId, tid, runId, lim);
  }

  @Get(':runId')
  async getTrace(@Param('runId') runId: string) {
    return this.trace.getTrace(runId);
  }

  @Get('stats')
  async stats(
    @Query('workspaceId') workspaceId?: string,
    @Query('agentId') agentId?: string,
  ) {
    return this.trace.getStats(workspaceId, agentId);
  }
}
