import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { Inject } from '@nestjs/common';

import { ITaskQueue } from '../../../domain/models/task-queue.interface.js';
import { ITaskQueueRepository, ITaskQueueRepositoryToken } from '../../../domain/repositories/task-queue-repository.interface.js';
import { TaskQueueEntity } from '../../persistence/sequalize/entities/task-queue.schema.js';

@Controller('tasks')
export class TaskQueueController {
  constructor(
    @Inject(ITaskQueueRepositoryToken) private taskQueueRepository: ITaskQueueRepository,
  ) {}

  @Get()
  async getAll(): Promise<ITaskQueue[]> {
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
    return this.taskQueueRepository.add(task);
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body('status') status: string): Promise<void> {
    const task = await this.taskQueueRepository.get(parseInt(id, 10));
    if (task) {
      task.status = status as any;
      await this.taskQueueRepository.update(task);
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

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<void> {
    await TaskQueueEntity.destroy({ where: { id: parseInt(id, 10) } as any });
  }
}