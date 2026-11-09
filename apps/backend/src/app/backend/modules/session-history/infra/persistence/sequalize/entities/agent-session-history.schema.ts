import { AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { IAgentSessionHistory } from '../../../../domain/models/agent-session-history.interface.js';

@Table({ tableName: 'agent_session_history', timestamps: false })
export class AgentSessionHistoryEntity extends Model<IAgentSessionHistory> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Column(DataType.STRING)
  workspace_id: string;

  @Column(DataType.STRING)
  agent_id: string;

  @Column(DataType.STRING)
  session_id: string | null;

  @Column(DataType.STRING)
  event_type: string;

  @Column(DataType.TEXT)
  summary: string;

  @Column(DataType.JSON)
  details: Record<string, unknown> | null;

  @Column(DataType.DATE)
  created_at: Date | null;
}
