import AbstractApiClient, {
  type ApiClientOptions,
} from '@wexample/js-api/Common/AbstractApiClient';
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
      entities: this.getEntityClasses(),
    });
    this.entityRegistry = new ApiEntityRegistry();
  }

  protected abstract getRepositoryClasses(): RepositoryClass[];

  // The kinds of the entities, beyond the one each repository hydrates: the
  // subclasses of a hierarchy, which a package may add to an entity another
  // package declares. None by default.
  protected getEntityClasses(): ApiEntityConstructor<AbstractApiEntity>[] {
    return [];
  }

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
