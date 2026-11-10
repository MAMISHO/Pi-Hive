import { AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

@Table({
  tableName: 'agent_run_logs',
  timestamps: false,
  createdAt: 'created_at',
})
export class AgentRunLogEntity extends Model {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Column(DataType.STRING)
  run_id: string;

  @Column(DataType.STRING)
  agent_id: string;

  @Column(DataType.STRING)
  workspace_id: string | null;

  @Column(DataType.INTEGER)
  task_id: number | null;

  @Column(DataType.STRING)
  event_type: string;

  @Column(DataType.TEXT)
  event_data: string | null;

  @Column(DataType.DATE)
  created_at: Date;
}
