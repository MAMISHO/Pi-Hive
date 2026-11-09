import { AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';
import { IAgentChatEvent } from '../../../../domain/models/agent-chat-event.interface.js';

@Table({ tableName: 'agent_chat_events', timestamps: false })
export class AgentChatEventEntity extends Model<IAgentChatEvent> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Column(DataType.STRING)
  workspace_id: string;

  @Column(DataType.STRING)
  agent_id: string;

  @Column(DataType.INTEGER)
  task_id: number | null;

  @Column(DataType.INTEGER)
  parent_task_id: number | null;

  @Column(DataType.STRING)
  direction: string;

  @Column(DataType.STRING)
  kind: string;

  @Column(DataType.TEXT)
  content: string;

  @Column(DataType.STRING)
  collapsible_group_id: string | null;

  @Column(DataType.DATE)
  created_at: Date | null;
}
