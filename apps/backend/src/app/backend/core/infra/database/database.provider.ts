import { Sequelize } from 'sequelize-typescript';

import { AgentEntity } from '../../../modules/agent/infra/persistence/sequalize/entities/agent.schema.js';
import { TaskQueueEntity } from '../../../modules/task-queue/infra/persistence/sequalize/entities/task-queue.schema.js';
import { AgentMemoryEntity } from '../../../modules/agent-memory/infra/persistence/sequalize/entities/agent-memory.schema.js';

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
        sequelize.addModels([AgentEntity, TaskQueueEntity, AgentMemoryEntity]);
        await sequelize.sync({ force: false });
        console.log('Database synchronized.');
        // Seed default agents
        const count = await AgentEntity.count();
        if (count === 0) {
          await AgentEntity.bulkCreate([
            { id: 'chief-agent', name: 'Chief Agent', role: 'CHIEF' as any, status: 'IDLE' as any, current_session_id: null, task_state: null },
            { id: 'frontend-expert', name: 'Frontend Expert', role: 'WORKER' as any, status: 'IDLE' as any, current_session_id: null, task_state: null },
            { id: 'backend-expert', name: 'Backend Expert', role: 'WORKER' as any, status: 'IDLE' as any, current_session_id: null, task_state: null },
          ]);
          console.log('Default agents seeded.');
        }
      } catch (error) {
        console.error('Unable to connect to the database:', error);
      }
    },
  },
];