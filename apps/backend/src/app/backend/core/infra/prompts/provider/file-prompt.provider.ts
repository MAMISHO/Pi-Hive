import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { PROMPT_FILES, PROMPTS_DIR } from '../prompt.constants.js';
import type { IPromptProvider } from './prompt-provider.interface.js';

@Injectable()
export class FilePromptProvider implements IPromptProvider {
  private cache = new Map<string, string>();
  private baseDir: string;

  constructor() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // dist: .../core/infra/prompts/provider -> ../../../../prompts (copied asset)
    // src/dev: resolve from cwd/apps/backend/prompts as fallback
    const candidates = [
      path.resolve(__dirname, '..', '..', '..', '..', 'prompts'),
      path.resolve(process.cwd(), 'apps', 'backend', PROMPTS_DIR),
      path.resolve(process.cwd(), PROMPTS_DIR),
    ];
    this.baseDir = candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }

  get(name: string): string {
    if (this.cache.has(name)) return this.cache.get(name)!;
    const file = path.join(this.baseDir, name);
    const content = fs.readFileSync(file, 'utf8').trimEnd();
    this.cache.set(name, content);
    return content;
  }

  getSystemDefault(): string {
    return this.get(PROMPT_FILES.SYSTEM_DEFAULT);
  }

  getChiefDefault(): string {
    return this.get(PROMPT_FILES.CHIEF_DEFAULT);
  }
}
