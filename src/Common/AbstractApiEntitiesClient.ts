import AbstractApiClient, { type ApiClientOptions } from '@wexample/js-api/Common/AbstractApiClient';
import type AbstractApiEntity from './AbstractApiEntity.js';
import type { ApiEntityConstructor } from './AbstractApiEntity.js';
import type AbstractApiRepository from './AbstractApiRepository.js';
import ApiEntityManager, { type RepositoryClass } from './ApiEntityManager.js';
import ApiEntityRegistry from './ApiEntityRegistry.js';

export default abstract class AbstractApiEntitiesClient extends AbstractApiClient {
  private readonly entityManager: ApiEntityManager;
  private readonly entityRegistry: ApiEntityRegistry;

  protected constructor(options: ApiClientOptions = {}) {
    super(options);
    this.entityManager = new ApiEntityManager({
      client: this,
      repositories: this.getRepositoryClasses(),
    });
    this.entityRegistry = new ApiEntityRegistry();
  }

  protected abstract getRepositoryClasses(): RepositoryClass[];

  getEntityManager(): ApiEntityManager {
    return this.entityManager;
  }

  getEntityRegistry(): ApiEntityRegistry {
    return this.entityRegistry;
  }

  getRepository<T extends AbstractApiRepository>(
    entity: string | ApiEntityConstructor<AbstractApiEntity>
  ): T {
    return this.entityManager.get(entity);
  }
}
