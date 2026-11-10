import { Module, OnModuleInit } from '@nestjs/common';
import { WorkspaceSystemPromptEntity } from './infra/persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { SystemPromptsController } from './infra/http/system-prompts.controller.js';
import { DEFAULT_SYSTEM_PROMPT_ID, DEFAULT_SYSTEM_PROMPT_NAME } from '../../core/infra/prompts/prompt.constants.js';
import { PromptCatalogService } from '../../core/infra/prompts/prompt-catalog.service.js';

@Module({
  controllers: [SystemPromptsController],
  providers: [{ provide: 'SYSTEM_PROMPT_MODEL', useValue: WorkspaceSystemPromptEntity }],
})
export class SystemPromptsModule implements OnModuleInit {
  constructor(private readonly prompts: PromptCatalogService) {}
  async onModuleInit() {
    const content = this.prompts.systemDefaultContent;
    const [row, created] = await WorkspaceSystemPromptEntity.findOrCreate({
      where: { id: DEFAULT_SYSTEM_PROMPT_ID },
      defaults: { id: DEFAULT_SYSTEM_PROMPT_ID, workspace_id: null, name: DEFAULT_SYSTEM_PROMPT_NAME, content, is_default: true, created_at: new Date(), updated_at: new Date() } as any,
    }).catch((e) => { throw e; });
    if (!created && ((row as any).content !== content || (row as any).name !== DEFAULT_SYSTEM_PROMPT_NAME)) {
      await row.update({ content, name: DEFAULT_SYSTEM_PROMPT_NAME, updated_at: new Date() } as any).catch(() => {});
    }
  }
}
