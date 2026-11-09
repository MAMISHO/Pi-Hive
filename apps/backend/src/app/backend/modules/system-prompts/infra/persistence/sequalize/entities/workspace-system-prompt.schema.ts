import { Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { IWorkspaceSystemPrompt } from '../../../../domain/models/workspace-system-prompt.interface.js';

@Table({ tableName: 'workspace_system_prompts', timestamps: false })
export class WorkspaceSystemPromptEntity extends Model<IWorkspaceSystemPrompt> {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column({ type: DataType.STRING, allowNull: true })
  workspace_id: string | null;

  @Column(DataType.STRING)
  name: string;

  @Column(DataType.TEXT)
  content: string;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  is_default: boolean;

  @Column(DataType.DATE)
  created_at: Date | null;

  @Column(DataType.DATE)
  updated_at: Date | null;
}
