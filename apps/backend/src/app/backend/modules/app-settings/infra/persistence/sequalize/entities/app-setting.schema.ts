import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'app_settings', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at' })
export class AppSettingEntity extends Model<AppSettingEntity> {
  @Column({ type: DataType.STRING, primaryKey: true })
  declare key: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare value: string | null;
}
