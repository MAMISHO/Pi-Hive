import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

import { AgentRole } from '../../../../domain/models/agent-role.enum.js';
import { AgentStatus } from '../../../../domain/models/agent-status.enum.js';
import { IAgent } from '../../../../domain/models/agent.interface.js';

@Table({
  tableName: 'agents',
  timestamps: false,
})
export class AgentEntity extends Model<IAgent> {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column(DataType.STRING)
  name: string;

  @Column({ type: DataType.STRING, unique: true, allowNull: false })
  nickname: string;

  @Column(DataType.ENUM('CHIEF', 'WORKER'))
  role: AgentRole;

  @Column(DataType.ENUM('IDLE', 'WORKING', 'PAUSED'))
  status: AgentStatus;

  @Column(DataType.STRING)
  current_session_id: string | null;

  @Column(DataType.JSON)
  task_state: Record<string, unknown> | null;

  @Column({ type: DataType.STRING, allowNull: true })
  workspace_id: string | null;
}