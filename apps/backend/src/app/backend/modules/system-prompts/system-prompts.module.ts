import { Module, OnModuleInit } from '@nestjs/common';
import { WorkspaceSystemPromptEntity } from './infra/persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { SystemPromptsController } from './infra/http/system-prompts.controller.js';
import { DEFAULT_SYSTEM_PROMPT_CONTENT, DEFAULT_SYSTEM_PROMPT_ID, DEFAULT_SYSTEM_PROMPT_NAME } from '../../core/infra/prompts/default-prompts.js';

@Module({
  controllers: [SystemPromptsController],
  providers: [{ provide: 'SYSTEM_PROMPT_MODEL', useValue: WorkspaceSystemPromptEntity }],
})
export class SystemPromptsModule implements OnModuleInit {
  async onModuleInit() {
    await WorkspaceSystemPromptEntity.findOrCreate({
      where: { id: DEFAULT_SYSTEM_PROMPT_ID },
      defaults: { id: DEFAULT_SYSTEM_PROMPT_ID, workspace_id: null, name: DEFAULT_SYSTEM_PROMPT_NAME, content: DEFAULT_SYSTEM_PROMPT_CONTENT, is_default: true, created_at: new Date() } as any,
    }).catch(()=>{});
  }
}
