import { Model, ModelCtor } from 'sequelize-typescript';

export abstract class GenericSequalizeDAO<T extends Model> {
  constructor(protected model: ModelCtor<T>) {}

  async create(newEntity: any): Promise<any> {
    const entity = this.model.build(newEntity as any);
    const saved = await entity.save();
    return saved;
  }

  async read(id: any): Promise<any> {
    return this.model.findByPk(id);
  }

  async readAll(): Promise<any[]> {
    return this.model.findAll();
  }

  async update(entity: any): Promise<void> {
    const instance = await this.model.findByPk(entity.id);
    if (instance) {
      await instance.update(entity);
    }
  }

  async readByCriteria<K>(filter: Partial<K>): Promise<any[]> {
    return this.model.findAll({ where: filter as any });
  }
}