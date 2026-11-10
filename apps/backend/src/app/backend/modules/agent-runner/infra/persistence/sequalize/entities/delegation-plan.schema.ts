import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

export interface IDelegationPlan {
  plan_ref: number;
  root_task_id: number;
  workspace_id: string | null;
  owner_agent_id: string;
  requester: string | null;
  raw_text: string;
  steps_json: string; // JSON array
  parada: string | null;
  cursor: number; // 0-based index of current step
  state: string; // active | done | aborted
  created_at: Date | null;
  updated_at: Date | null;
}

@Table({ tableName: 'delegation_plans', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' })
export class DelegationPlanEntity extends Model<IDelegationPlan> {
  @PrimaryKey
  @Column(DataType.INTEGER)
  declare plan_ref: number;

  @Column(DataType.INTEGER)
  declare root_task_id: number;

  @Column({ type: DataType.STRING, allowNull: true })
  declare workspace_id: string | null;

  @Column(DataType.STRING)
  declare owner_agent_id: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare requester: string | null;

  @Column(DataType.TEXT)
  declare raw_text: string;

  @Column(DataType.TEXT)
  declare steps_json: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare parada: string | null;

  @Column({ type: DataType.INTEGER, defaultValue: 0 })
  declare cursor: number;

  @Column({ type: DataType.STRING, defaultValue: 'active' })
  declare state: string;

  @Column(DataType.DATE)
  declare created_at: Date | null;

  @Column(DataType.DATE)
  declare updated_at: Date | null;
}
