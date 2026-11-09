import { Model, ModelCtor } from 'sequelize-typescript';

export abstract class GenericSequalizeDAO<T extends Model> {
  constructor(protected model: ModelCtor<T>) {}

  async create(newEntity: any): Promise<any> {
    const data = { ...newEntity };
    // Let DB auto-generate id if it's 0, null, or undefined
    if (data.id === 0 || data.id === null || data.id === undefined) {
      delete data.id;
    }
    const saved = await this.model.create(data as any);
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