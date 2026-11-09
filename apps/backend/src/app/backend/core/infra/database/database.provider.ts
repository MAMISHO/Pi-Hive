import { Sequelize } from 'sequelize-typescript';

import { AgentEntity } from '../../../modules/agent/infra/persistence/sequalize/entities/agent.schema.js';
import { TaskQueueEntity } from '../../../modules/task-queue/infra/persistence/sequalize/entities/task-queue.schema.js';
import { AgentMemoryEntity } from '../../../modules/agent-memory/infra/persistence/sequalize/entities/agent-memory.schema.js';
import { WorkspaceEntity } from '../../../modules/workspace/infra/persistence/sequalize/entities/workspace.schema.js';
import { WorkspaceSystemPromptEntity } from '../../../modules/system-prompts/infra/persistence/sequalize/entities/workspace-system-prompt.schema.js';
import { AgentSessionHistoryEntity } from '../../../modules/session-history/infra/persistence/sequalize/entities/agent-session-history.schema.js';
import { AgentChatEventEntity } from '../../../modules/chat-transcript/infra/persistence/sequalize/entities/agent-chat-event.schema.js';
import { DEFAULT_SYSTEM_PROMPT_ID, DEFAULT_SYSTEM_PROMPT_NAME, DEFAULT_SYSTEM_PROMPT_CONTENT } from '../prompts/default-prompts.js';

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
        ]);
        await sequelize.sync();
        console.log('Database synchronized (alter).');

        // Seed immutable default system prompt (global)
        const defaultPrompt = await WorkspaceSystemPromptEntity.findByPk(DEFAULT_SYSTEM_PROMPT_ID);
        if (!defaultPrompt) {
          await WorkspaceSystemPromptEntity.create({
            id: DEFAULT_SYSTEM_PROMPT_ID,
            workspace_id: null,
            name: DEFAULT_SYSTEM_PROMPT_NAME,
            content: DEFAULT_SYSTEM_PROMPT_CONTENT,
            is_default: true,
            created_at: new Date(),
            updated_at: new Date(),
          } as any);
          console.log('Default system prompt seeded.');
        }

        // Backfill: ensure workspaces have HITL default false / prompt binding null (alter handles columns)
        // Existing agents without workspace are left as-is (legacy); new flows require workspace.
      } catch (error) {
        console.error('Unable to connect to the database:', error);
      }
    },
  },
];
