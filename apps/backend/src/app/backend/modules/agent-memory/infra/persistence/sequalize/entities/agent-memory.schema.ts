import { AutoIncrement, Column, DataType, Model, PrimaryKey, Table } from 'sequelize-typescript';

import { IAgentMemory } from '../../../../domain/models/agent-memory.interface.js';

@Table({
  tableName: 'agent_memories',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
})
export class AgentMemoryEntity extends Model<IAgentMemory> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  declare id: number;

  @Column(DataType.STRING)
  agent_id: string;

  @Column(DataType.STRING)
  session_id: string;

  @Column(DataType.TEXT)
  compacted_summary: string;

  @Column(DataType.DATE)
  declare created_at: Date;
}