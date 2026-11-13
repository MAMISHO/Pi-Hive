import { Body, Controller, Delete, Get, Inject, Param, Post, Put } from '@nestjs/common';
import { WorkspaceSystemPromptEntity } from '../persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { PromptCatalogService } from '../../../../core/infra/prompts/prompt-catalog.service.js';

@Controller()
export class SystemPromptsController {
  constructor(
    @Inject('SYSTEM_PROMPT_MODEL') private model: typeof WorkspaceSystemPromptEntity,
    private readonly prompts: PromptCatalogService,
  ) {}

  // Global/general system prompts (selectable per workspace). Default prompt is immutable and seeded from catalog.
  @Get('system-prompts')
  async listGlobal() {
    const rows = await this.model.findAll({ order: [['is_default', 'DESC'], ['created_at', 'ASC']] as any });
    // expose defaults + global custom prompts (workspace_id null and not default) as selectable base prompts
    return rows
      .filter((r: any) => r.is_default || r.workspace_id == null)
      .map((r: any) => r.toJSON());
  }

  @Post('system-prompts')
  async createGlobal(@Body() body: { name: string; content?: string }) {
    const now = new Date();
    const row = await this.model.create({
      id: (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `sp-${Date.now()}`,
      workspace_id: null,
      name: body.name || 'Custom System Prompt',
      content: body.content ?? '',
      is_default: false,
      created_at: now,
      updated_at: now,
    } as any);
    return row.toJSON();
  }

  @Put('system-prompts/:id')
  async updateGlobal(@Param('id') id: string, @Body() body: { name?: string; content?: string }) {
    const row = await this.model.findByPk(id);
    if (!row) return { error: 'Not found' };
    if ((row as any).is_default) return { error: 'Default system prompt is immutable' };
    await row.update({ name: body.name ?? (row as any).name, content: body.content ?? (row as any).content, updated_at: new Date() } as any);
    return row.toJSON();
  }

  @Delete('system-prompts/:id')
  async removeGlobal(@Param('id') id: string) {
    const row = await this.model.findByPk(id);
    if (!row) return { ok: true };
    if ((row as any).is_default) return { error: 'Default system prompt cannot be deleted' };
    await row.destroy();
    return { ok: true, deletedId: id };
  }

  // Legacy/workspace-scoped endpoints (kept for compatibility)
  @Get('workspaces/:workspaceId/system-prompts')
  async list(@Param('workspaceId') workspaceId: string) {
    const defaults = await this.model.findAll({ where: { is_default: true } as any });
    const custom = await this.model.findAll({ where: { workspace_id: workspaceId } as any, order: [['created_at', 'DESC']] as any });
    return [...defaults.map((d: any) => d.toJSON()), ...custom.map((c: any) => c.toJSON())];
  }

  @Post('workspaces/:workspaceId/system-prompts')
  async create(@Param('workspaceId') workspaceId: string, @Body() body: { name: string; content?: string }) {
    const now = new Date();
    const row = await this.model.create({
      id: (typeof crypto !== 'undefined' && (crypto as any).randomUUID) ? (crypto as any).randomUUID() : `sp-${Date.now()}`,
      workspace_id: workspaceId,
      name: body.name || 'Custom Prompt',
      content: body.content ?? this.prompts.systemDefaultContent,
      is_default: false,
      created_at: now,
      updated_at: now,
    } as any);
    return row.toJSON();
  }

  @Put('workspaces/:workspaceId/system-prompts/:id')
  async update(@Param('id') id: string, @Body() body: { name?: string; content?: string }) {
    return this.updateGlobal(id, body);
  }

  @Delete('workspaces/:workspaceId/system-prompts/:id')
  async remove(@Param('id') id: string) {
    return this.removeGlobal(id);
  }
}
