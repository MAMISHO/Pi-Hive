import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { ITaskQueue } from '../../../domain/models/task-queue.interface.js';
import { ITaskQueueRepository, ITaskQueueRepositoryToken } from '../../../domain/repositories/task-queue-repository.interface.js';
import { taskEventEmitter } from '../../persistence/sequalize/entities/task-queue.schema.js';
import { TaskQueueEntity } from '../../persistence/sequalize/entities/task-queue.schema.js';

@Controller('tasks')
export class TaskQueueController {
  constructor(
    @Inject(ITaskQueueRepositoryToken) private taskQueueRepository: ITaskQueueRepository,
  ) {}

  @Get()
  async getAll(@Query('workspaceId') workspaceId?: string): Promise<ITaskQueue[]> {
    if (workspaceId) return TaskQueueEntity.findAll({ where: { workspace_id: workspaceId } as any, order: [['id','ASC']] }).then(r=>r.map(x=>x.toJSON() as any));
    return this.taskQueueRepository.getAll();
  }

  @Get('receiver/:agentId')
  async getByReceiver(@Param('agentId') agentId: string): Promise<ITaskQueue[]> {
    return this.taskQueueRepository.findByReceiver(agentId);
  }

  @Get('status/:status')
  async getByStatus(@Param('status') status: string): Promise<ITaskQueue[]> {
    return this.taskQueueRepository.findByStatus(status);
  }

  @Post()
  async create(@Body() task: ITaskQueue): Promise<ITaskQueue> {
    const created = await this.taskQueueRepository.add(task);
    // entity hooks emit task:pending/task:updated/task:changed (canonical, deduped)
    return created;
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body('status') status: string): Promise<void> {
    const task = await this.taskQueueRepository.get(parseInt(id, 10));
    if (task) {
      task.status = status as any;
      await this.taskQueueRepository.update(task);
      // entity hook emits canonical events
    }
  }

  @Put(':id/payload')
  async updatePayload(@Param('id') id: string, @Body('payload') payload: string): Promise<void> {
    const task = await this.taskQueueRepository.get(parseInt(id, 10));
    if (task) {
      task.payload = payload;
      await this.taskQueueRepository.update(task);
    }
  }

  @Delete('workspace/:workspaceId/clear')
  async clearByWorkspace(@Param('workspaceId') workspaceId: string): Promise<any> {
    const n = await TaskQueueEntity.destroy({ where: { workspace_id: workspaceId } as any });
    try { const { agentEventEmitter } = await import('../../../../agent-runner/agent-runner.service.js'); agentEventEmitter.emit('tasks:cleared', { workspaceId }); } catch (e) { try { (require('../../../../agent-runner/agent-runner.service.js') as any).agentEventEmitter?.emit('tasks:cleared', { workspaceId }); } catch {} }
    return { ok: true, deleted: n };
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await TaskQueueEntity.destroy({ where: { id: parseInt(id, 10) } as any });
  }
}