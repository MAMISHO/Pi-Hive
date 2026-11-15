import { Sequelize } from 'sequelize-typescript';

import { AgentEntity } from '../../../modules/agent/infra/persistence/sequalize/entities/agent.schema.js';
import { TaskQueueEntity } from '../../../modules/task-queue/infra/persistence/sequalize/entities/task-queue.schema.js';
import { AgentMemoryEntity } from '../../../modules/agent-memory/infra/persistence/sequalize/entities/agent-memory.schema.js';
import { WorkspaceEntity } from '../../../modules/workspace/infra/persistence/sequalize/entities/workspace.schema.js';
import { WorkspaceSystemPromptEntity } from '../../../modules/system-prompts/infra/persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { AgentSessionHistoryEntity } from '../../../modules/session-history/infra/persistence/sequalize/entities/agent-session-history.schema.js';
import { AgentChatEventEntity } from '../../../modules/chat-transcript/infra/persistence/sequalize/entities/agent-chat-event.schema.js';
import { AgentRunLogEntity } from '../../../modules/agent-runner/infra/persistence/sequalize/entities/agent-run-log.schema.js';
import { DelegationPlanEntity } from '../../../modules/agent-runner/infra/persistence/sequalize/entities/delegation-plan.schema.js';
import { AppSettingEntity } from '../../../modules/app-settings/infra/persistence/sequalize/entities/app-setting.schema.js';
import { DEFAULT_SYSTEM_PROMPT_ID, DEFAULT_SYSTEM_PROMPT_NAME } from '../prompts/prompt.constants.js';
import { FilePromptProvider } from '../prompts/provider/file-prompt.provider.js';

const dbPath = process.env.DB_PATH ?? './data/pi-hive.db';

export const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: false,
});

export const databaseProviders = [
  {
    provide: 'DATABASE_CONNECTION',
    useFactory: async (): Promise<void> => {
      try {
        await sequelize.authenticate();
        console.log('SQLite connection established successfully.');
        sequelize.addModels([
          AgentEntity,
          TaskQueueEntity,
          AgentMemoryEntity,
          WorkspaceEntity,
          WorkspaceSystemPromptEntity,
          AgentSessionHistoryEntity,
          AgentChatEventEntity,
          AgentRunLogEntity,
          DelegationPlanEntity,
          AppSettingEntity,
        ]);
        await sequelize.sync();
        // sqlite sync() doesn't add new columns to existing tables; add missing columns
        try {
          const [cols]: any = await sequelize.query("PRAGMA table_info(tasks_queue);");
          const names = new Set((cols || []).map((c: any) => c.name));
          const adds: Array<[string, string]> = [
            ['task_flow', "ALTER TABLE tasks_queue ADD COLUMN task_flow VARCHAR(255) DEFAULT 'direct';"],
            ['depth', "ALTER TABLE tasks_queue ADD COLUMN depth INTEGER DEFAULT 0;"],
            ['depth_path', "ALTER TABLE tasks_queue ADD COLUMN depth_path VARCHAR(255);"],
            ['parent_task_callback', "ALTER TABLE tasks_queue ADD COLUMN parent_task_callback BOOLEAN DEFAULT 0;"],
            ['callback_context', "ALTER TABLE tasks_queue ADD COLUMN callback_context TEXT;"],
            ['callback_final', "ALTER TABLE tasks_queue ADD COLUMN callback_final BOOLEAN;"],
            ['plan_ref', "ALTER TABLE tasks_queue ADD COLUMN plan_ref INTEGER;"],
          ];
          for (const [name, sql] of adds) {
            if (!names.has(name)) {
              await sequelize.query(sql);
              console.log(`[DB] added tasks_queue.${name}`);
            }
          }
        } catch (e) { console.warn('[DB] tasks_queue migrate:', (e as any)?.message || e); }
        try {
          const [acols]: any = await sequelize.query("PRAGMA table_info(agents);");
          const anames = new Set((acols || []).map((c: any) => c.name));
          if (!anames.has('inject_context')) {
            await sequelize.query("ALTER TABLE agents ADD COLUMN inject_context BOOLEAN NOT NULL DEFAULT 1;");
            console.log('[DB] added agents.inject_context');
          }
          if (!anames.has('thinking_level')) {
            await sequelize.query("ALTER TABLE agents ADD COLUMN thinking_level VARCHAR(16) DEFAULT 'low';");
            console.log('[DB] added agents.thinking_level');
          }
          if (!anames.has('usage_reset_at')) {
            await sequelize.query("ALTER TABLE agents ADD COLUMN usage_reset_at DATETIME;");
            console.log('[DB] added agents.usage_reset_at');
          }
        } catch (e) { console.warn('[DB] agents migrate:', (e as any)?.message || e); }
        try {
          const [wcols]: any = await sequelize.query("PRAGMA table_info(workspaces);");
          const wnames = new Set((wcols || []).map((c: any) => c.name));
          if (!wnames.has('workspace_prompt')) {
            await sequelize.query("ALTER TABLE workspaces ADD COLUMN workspace_prompt TEXT;");
            console.log('[DB] added workspaces.workspace_prompt');
          }
          if (!wnames.has('role_bindings')) {
            await sequelize.query("ALTER TABLE workspaces ADD COLUMN role_bindings TEXT;");
            console.log('[DB] added workspaces.role_bindings');
          }
        } catch (e) { console.warn('[DB] workspaces migrate:', (e as any)?.message || e); }
        try {
          const [ecols]: any = await sequelize.query("PRAGMA table_info(agent_chat_events);");
          const enames = new Set((ecols || []).map((c: any) => c.name));
          if (!enames.has('request_id')) {
            await sequelize.query("ALTER TABLE agent_chat_events ADD COLUMN request_id VARCHAR(255);");
            console.log('[DB] added agent_chat_events.request_id');
          }
          if (!enames.has('request_parent_id')) {
            await sequelize.query("ALTER TABLE agent_chat_events ADD COLUMN request_parent_id VARCHAR(255);");
            console.log('[DB] added agent_chat_events.request_parent_id');
          }
        } catch (e) { console.warn('[DB] agent_chat_events migrate:', (e as any)?.message || e); }
        console.log('Database synchronized (alter).');

        // Seed/refresh immutable default system prompt (global) from catalog files
        try {
          const catalog = new FilePromptProvider();
          const content = catalog.getSystemDefault();
          const defaultPrompt = await WorkspaceSystemPromptEntity.findByPk(DEFAULT_SYSTEM_PROMPT_ID);
          if (!defaultPrompt) {
            await WorkspaceSystemPromptEntity.create({
              id: DEFAULT_SYSTEM_PROMPT_ID,
              workspace_id: null,
              name: DEFAULT_SYSTEM_PROMPT_NAME,
              content,
              is_default: true,
              created_at: new Date(),
              updated_at: new Date(),
            } as any);
            console.log('Default system prompt seeded.');
          } else if ((defaultPrompt as any).content !== content || (defaultPrompt as any).name !== DEFAULT_SYSTEM_PROMPT_NAME) {
            await defaultPrompt.update({ content, name: DEFAULT_SYSTEM_PROMPT_NAME, updated_at: new Date() } as any);
            console.log('Default system prompt refreshed from catalog.');
          }
        } catch (e) { console.warn('[DB] default prompt seed/refresh:', (e as any)?.message || e); }

        // Backfill: ensure workspaces have HITL default false / prompt binding null (alter handles columns)
        // Existing agents without workspace are left as-is (legacy); new flows require workspace.
      } catch (error) {
        console.error('Unable to connect to the database:', error);
      }
    },
  },
];
