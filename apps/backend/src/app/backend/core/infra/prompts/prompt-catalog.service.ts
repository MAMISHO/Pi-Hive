import { Inject, Injectable } from '@nestjs/common';
import { IPromptProviderToken, type IPromptProvider } from './provider/prompt-provider.interface.js';
import { DEFAULT_SYSTEM_PROMPT_ID, DEFAULT_SYSTEM_PROMPT_NAME } from './prompt.constants.js';

@Injectable()
export class PromptCatalogService {
  constructor(@Inject(IPromptProviderToken) private readonly provider: IPromptProvider) {}

  get systemDefaultId(): string { return DEFAULT_SYSTEM_PROMPT_ID; }
  get systemDefaultName(): string { return DEFAULT_SYSTEM_PROMPT_NAME; }
  get systemDefaultContent(): string { return this.provider.getSystemDefault(); }
  get chiefDefaultContent(): string { return this.provider.getChiefDefault(); }

  renderChief(template: string, teamRoster: string): string {
    return (template || this.chiefDefaultContent).replace('{{TEAM_ROSTER}}', teamRoster);
  }
}
