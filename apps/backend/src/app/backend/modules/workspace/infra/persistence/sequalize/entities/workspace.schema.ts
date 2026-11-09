import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { IWorkspace } from '../../../../domain/models/workspace.interface.js';

@Table({ tableName: 'workspaces', timestamps: false })
export class WorkspaceEntity extends Model<IWorkspace> {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column(DataType.STRING)
  name: string;

  @Column(DataType.STRING)
  path: string;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  is_active: boolean;

  @Column({ type: DataType.STRING, allowNull: true })
  active_system_prompt_id: string | null;

  @Column({ type: DataType.TEXT, allowNull: true })
  custom_chief_prompt: string | null;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  hitl_enabled: boolean;

  @Column(DataType.DATE)
  created_at: Date | null;
}
