export const PROMPTS_DIR = 'prompts';

export const PROMPT_FILES = {
  SYSTEM_DEFAULT: 'system-default.md',
  CHIEF_DEFAULT: 'chief-default.md',
  WORKER_COORDINATION: 'worker-coordination.md',
} as const;

export const PROMPT_IDS = {
  SYSTEM_DEFAULT: 'system-default',
} as const;

export const DEFAULT_SYSTEM_PROMPT_ID = PROMPT_IDS.SYSTEM_DEFAULT;
export const DEFAULT_SYSTEM_PROMPT_NAME = 'Pi-Hive Default System Prompt';
