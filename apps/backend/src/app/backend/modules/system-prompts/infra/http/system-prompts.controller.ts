import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { WorkspaceSystemPromptEntity } from '../persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { DEFAULT_SYSTEM_PROMPT_ID, DEFAULT_SYSTEM_PROMPT_CONTENT, DEFAULT_SYSTEM_PROMPT_NAME } from '../../../../core/infra/prompts/default-prompts.js';

@Controller('workspaces/:workspaceId/system-prompts')
export class SystemPromptsController {
  constructor(@Inject('SYSTEM_PROMPT_MODEL') private model: typeof WorkspaceSystemPromptEntity) {}

  @Get()
  async list(@Param('workspaceId') workspaceId: string) {
    const defaults = await this.model.findAll({ where: { is_default: true } as any });
    const custom = await this.model.findAll({ where: { workspace_id: workspaceId } as any, order: [['created_at', 'DESC']] as any });
    return [...defaults.map(d => d.toJSON()), ...custom.map(c => c.toJSON())];
  }

  @Post()
  async create(@Param('workspaceId') workspaceId: string, @Body() body: { name: string; content?: string }) {
    const now = new Date();
    const row = await this.model.create({
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `sp-${Date.now()}`,
      workspace_id: workspaceId,
      name: body.name || 'Custom Prompt',
      content: body.content ?? DEFAULT_SYSTEM_PROMPT_CONTENT,
      is_default: false,
      created_at: now,
      updated_at: now,
    } as any);
    return row.toJSON();
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: { name?: string; content?: string }) {
    const row = await this.model.findByPk(id);
    if (!row) return { error: 'Not found' };
    if (row.is_default) return { error: 'Default system prompt is immutable' };
    await row.update({ name: body.name ?? row.name, content: body.content ?? row.content, updated_at: new Date() } as any);
    return row.toJSON();
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const row = await this.model.findByPk(id);
    if (!row) return { ok: true };
    if (row.is_default) return { error: 'Default system prompt cannot be deleted' };
    await row.destroy();
    return { ok: true, deletedId: id };
  }
}
