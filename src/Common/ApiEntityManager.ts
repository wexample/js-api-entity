import { lowerFirstCharacter } from '../Helper/EntityNameHelper.js';
import type AbstractApiEntitiesClient from './AbstractApiEntitiesClient.js';
import type AbstractApiEntity from './AbstractApiEntity.js';
import type { ApiEntityConstructor, ApiEntityData } from './AbstractApiEntity.js';
import type AbstractApiRepository from './AbstractApiRepository.js';

export type RepositoryClass<T extends AbstractApiEntity = AbstractApiEntity> = {
  new (client: AbstractApiEntitiesClient): AbstractApiRepository<T>;
  getEntityType(): ApiEntityConstructor<T>;
};

type ApiEntityManagerOptions = {
  client: AbstractApiEntitiesClient;
  repositories: RepositoryClass[];
  // The kinds of an entity, each a class extending the one its repository
  // hydrates: what a row turns out to be, told by its discriminator.
  entities?: ApiEntityConstructor<AbstractApiEntity>[];
};

type SubtypeRegistry = Record<string, Record<string, ApiEntityConstructor<AbstractApiEntity>>>;

type RegistryEntry<T extends AbstractApiEntity = AbstractApiEntity> = {
  entity: ApiEntityConstructor<T>;
  repository: RepositoryClass<T>;
  instance: AbstractApiRepository<T> | null;
};

export default class ApiEntityManager {
  private readonly client: AbstractApiEntitiesClient;
  private registry: Record<string, RegistryEntry> = {};
  // By the parent's entity name, then by the discriminator value.
  private subtypes: SubtypeRegistry = {};

  constructor(options: ApiEntityManagerOptions) {
    this.client = options.client;
    this.buildRegistry(options.repositories);
    this.buildSubtypes(options.entities ?? []);
  }

  // The class a row hydrates to: the kind its discriminator names among those
  // registered under the entity, or the entity itself when it names none.
  resolveEntityType<T extends AbstractApiEntity>(
    entityType: ApiEntityConstructor<T>,
    data: ApiEntityData
  ): ApiEntityConstructor<T> {
    const schema = entityType.retrieveEntitySchema();
    const property = schema.discriminator?.property;

    if (!property) {
      return entityType;
    }

    const value = data[property];
    const subtype =
      typeof value === 'string' ? this.subtypes[entityType.entityName]?.[value] : undefined;

    return (subtype as ApiEntityConstructor<T> | undefined) ?? entityType;
  }

  get<T extends AbstractApiRepository>(
    entity: string | ApiEntityConstructor<AbstractApiEntity>
  ): T {
    const entityName = typeof entity === 'string' ? entity : entity.entityName;

    const registryEntry = this.registry[entityName];

    if (!registryEntry) {
      throw new Error(
        `Entity "${entityName}" is not registered. Available repositories: ${Object.keys(this.registry).join(', ')}`
      );
    }

    if (!registryEntry.instance) {
      const RepositoryClass = registryEntry.repository;
      registryEntry.instance = new RepositoryClass(this.client);
    }

    return registryEntry.instance as T;
  }

  all(): Record<string, AbstractApiRepository> {
    const instances: Record<string, AbstractApiRepository> = {};

    for (const [entityName] of Object.entries(this.registry)) {
      instances[entityName] = this.get(entityName);
    }

    return instances;
  }

  private buildSubtypes(entities: ApiEntityConstructor<AbstractApiEntity>[]): void {
    this.subtypes = {};

    for (const entityType of entities) {
      const schema = entityType.retrieveEntitySchema();

      if (!schema.extends || !schema.discriminator) {
        continue;
      }

      // The parent's entity name is its class name in camel case, as the
      // generated entities name themselves.
      const parentName = lowerFirstCharacter(schema.extends);
      this.subtypes[parentName] ??= {};
      this.subtypes[parentName][schema.discriminator.value] = entityType;
    }
  }

  private buildRegistry(repositories: RepositoryClass[]): void {
    this.registry = {};

    for (const repositoryClass of repositories) {
      const entityType = repositoryClass.getEntityType();
      const entityName = entityType.entityName;

      if (!entityName) {
        throw new Error('Entity type must define a static entityName.');
      }

      this.registry[entityName] = {
        repository: repositoryClass,
        entity: entityType,
        instance: null,
      };
    }
  }
}
