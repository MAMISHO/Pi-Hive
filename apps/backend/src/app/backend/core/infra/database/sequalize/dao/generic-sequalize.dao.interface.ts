export interface IGenericSequalizeDAO<T> {
  create(entity: T): Promise<T>;
  read(id: any): Promise<T | null>;
  readAll(): Promise<T[]>;
  update(entity: T): Promise<void>;
  readByCriteria<K>(filter: Partial<K>): Promise<T[]>;
}