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

  @Column(DataType.DATE)
  created_at: Date | null;
}
