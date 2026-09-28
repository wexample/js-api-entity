import { stringToKebabCase } from '@wexample/js-helpers/Helper/String';
import type AbstractApiEntitiesClient from './AbstractApiEntitiesClient.js';
import AbstractApiEntity, {
  type ApiEntityConstructor,
  type ApiEntityData,
} from './AbstractApiEntity.js';
import { unwrapApiEnvelope } from './ApiEnvelope.js';
import type ApiEntityRegistry from './ApiEntityRegistry.js';
import ApiEnvelopeError from './Errors/ApiEnvelopeError.js';
import ApiSchemaError from './Errors/ApiSchemaError.js';

type RepositoryClass<T extends AbstractApiEntity> = {
  getEntityType(): ApiEntityConstructor<T>;
};

type ApiItemMetadata = Record<string, unknown> | unknown[];
type ApiItemRelationships = Record<string, ApiItem>;
type ApiItem = {
  type: string;
  entity: ApiEntityData;
  metadata: ApiItemMetadata;
  relationships: ApiItemRelationships;
};
type ApiQuery = Record<string, string | number | boolean>;
type FetchListOptions = {
  query?: ApiQuery;
  page?: number | null;
  length?: number | null;
  endpoint?: string;
};

// Mirrors Wexample\SymfonyApi\Api\Dto\PaginationDto. Pages are zero indexed.
// A null length means "no limit"; a null total means the API did not count,
// which leaves the pager with prev/next only.
export type ApiPagination = {
  page: number;
  length: number | null;
  total: number | null;
  pagesCount: number | null;
  hasMore: boolean | null;
};
export type ApiPaginatedList<T> = {
  items: T[];
  pagination: ApiPagination;
};
type FetchOptions = {
  identifier: string;
  endpoint?: string;
};
type PostOptions = {
  endpoint: string;
  payload?: Record<string, unknown>;
};
type PostEntityOptions = {
  endpoint: string;
  entity: AbstractApiEntity;
  query?: ApiQuery;
};
type PostEntityByIdOptions = {
  endpoint: string;
  entity: AbstractApiEntity;
  id?: string | number;
  query?: ApiQuery;
};
type PostEntitiesOptions = {
  endpoint: string;
  entities: AbstractApiEntity[];
  query?: ApiQuery;
};
type DeleteEntityOptions = {
  identifier: string | number;
  endpoint?: string;
  query?: ApiQuery;
  payload?: Record<string, unknown> | null;
};
type FetchListCachedByNameOptions<T extends AbstractApiEntity> = {
  cacheName?: string;
  fetch: () => Promise<T[]>;
  ttlMs?: number | null;
  forceRefresh?: boolean;
};
type FetchCachedByNameOptions = {
  cacheName?: string;
  id: string | number;
  endpoint?: string;
  ttlMs?: number | null;
  forceRefresh?: boolean;
};
type NamedListCacheEntry<T extends AbstractApiEntity> = {
  value?: T[];
  expiresAt: number | null;
  inFlight?: Promise<T[]>;
};
type NamedEntityCacheEntry<T extends AbstractApiEntity> = {
  value?: T;
  expiresAt: number | null;
  inFlight?: Promise<T>;
};
type FetchAllCachedOptions = {
  cacheName?: string;
  ttlMs?: number | null;
  forceRefresh?: boolean;
};

export default abstract class AbstractApiRepository<
  T extends AbstractApiEntity = AbstractApiEntity,
> {
  public static readonly CACHE_NAME_ALL = 'all';
  public static readonly CACHE_NAME_ENTITY = 'entity';
  public static readonly CACHE_TTL_DEFAULT: number | null = null;

  protected readonly client: AbstractApiEntitiesClient;
  private readonly namedListCache: Map<string, NamedListCacheEntry<T>> = new Map();
  private readonly namedEntityCache: Map<string, NamedEntityCacheEntry<T>> = new Map();

  constructor(client: AbstractApiEntitiesClient) {
    this.client = client;
  }

  async fetchAllCached(options: FetchAllCachedOptions = {}): Promise<AbstractApiEntity[]> {
    const {
      cacheName,
      ttlMs = AbstractApiRepository.CACHE_TTL_DEFAULT,
      forceRefresh = false,
    } = options;
    const resolvedCacheName = cacheName?.trim() || this.getDefaultListCacheName();

    return this.fetchListCachedByName({
      cacheName: resolvedCacheName,
      ttlMs,
      forceRefresh,
      fetch: () => this.fetchList(),
    });
  }

  static getEntityType(): ApiEntityConstructor<AbstractApiEntity> {
    throw new Error('Repository must define getEntityType().');
  }

  static getEntityName(): string {
    // biome-ignore lint: keep subclass behavior via `this`.
    const entityType = this.getEntityType();
    const entityName = entityType.entityName;

    if (!entityName) {
      throw new Error('Entity type must define a static entityName.');
    }

    return entityName;
  }

  protected getEntityType(): ApiEntityConstructor<T> {
    const repositoryClass = this.constructor as unknown as RepositoryClass<T>;

    if (typeof repositoryClass.getEntityType !== 'function') {
      throw new Error('Repository must implement a static getEntityType().');
    }

    return repositoryClass.getEntityType();
  }

  public createFromApiItem(item: ApiItem): T {
    const entityType = this.getEntityType();
    this.assertApiItemType(item, entityType);
    const entity = entityType.fromApi(item.entity);
    const createdRelationships = this.createRelationships(item.relationships);

    entity.setMetadata(item.metadata);
    this.getEntityRegistry().registerEntity(entity);
    entity.setRelationships(createdRelationships);

    return entity;
  }

  // Public hydration gate for a single raw API item (REST payload, live
  // update): validates the {type, entity} shape then hydrates strictly.
  public hydrateApiItem(value: unknown): T {
    return this.createFromApiItem(this.parseApiItem(value));
  }

  protected createFromApiCollection(collection: ApiItem[]): T[] {
    return collection.map((item) => {
      return this.createFromApiItem(item);
    });
  }

  protected assertApiItemType(item: ApiItem, entityType: ApiEntityConstructor<T>): void {
    if (item.type !== entityType.entityName) {
      throw new ApiSchemaError({
        message: `[js-api] API item type mismatch: expected "${entityType.entityName}", got "${item.type}".`,
        code: ApiSchemaError.CODE_INVALID_ITEM,
        entityName: entityType.entityName,
      });
    }
  }

  protected createRelationships(relationships: ApiItemRelationships): AbstractApiEntity[] {
    const output: AbstractApiEntity[] = [];
    const ownerEntityName = this.getEntityType().entityName;

    for (const [relationName, relEntry] of Object.entries(relationships)) {
      let repository: AbstractApiRepository;

      try {
        repository = this.client.getRepository(relEntry.type) as AbstractApiRepository;
      } catch (error) {
        // Re-throw with the owning entity and relation named: a bare
        // "entity X is not registered" is undebuggable from a response.
        throw new ApiSchemaError({
          message:
            `[js-api] cannot hydrate relationship "${relationName}" of entity "${ownerEntityName}": ` +
            `no repository registered for type "${relEntry.type}".`,
          code: ApiSchemaError.CODE_UNKNOWN_RELATIONSHIP,
          entityName: ownerEntityName,
          field: relationName,
          cause: error,
        });
      }

      output.push(repository.createFromApiItem(relEntry));
    }

    return output;
  }

  public buildPath(pathSuffix: string): string {
    // A path opening on a slash is given whole. An entity is not always served
    // under its own name — one listed inside a container is addressed by that
    // container — and hanging such a path under the entity name would point it
    // nowhere. The client drops the leading slash on its way out.
    if (pathSuffix.startsWith('/')) {
      return pathSuffix;
    }

    const entityName = (this.constructor as typeof AbstractApiRepository).getEntityName();
    const base = stringToKebabCase(entityName);
    return `${base}/${pathSuffix}`;
  }

  protected extractPayload(data: unknown): ApiEntityData {
    const payload = unwrapApiEnvelope<unknown>(data);

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ApiEnvelopeError({
        message: 'Invalid API response: missing or invalid "data" object.',
        envelope: data,
      });
    }

    return payload as ApiEntityData;
  }

  protected extractItems(payload: ApiEntityData): ApiItem[] {
    const items = (payload as Record<string, unknown>).items;

    if (!Array.isArray(items)) {
      throw new ApiEnvelopeError({
        message: 'Invalid API payload: missing "items" array.',
        envelope: payload,
      });
    }

    return items.map((item) => this.parseApiItem(item));
  }

  // An endpoint that returns no pagination block is treated as a single full
  // page, so callers can rely on the meta being present either way.
  protected extractPagination(payload: ApiEntityData, itemsCount: number): ApiPagination {
    const raw = (payload as Record<string, unknown>).pagination;

    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return {
        page: 0,
        length: null,
        total: itemsCount,
        pagesCount: 1,
        hasMore: false,
      };
    }

    const record = raw as Record<string, unknown>;
    const toNumber = (value: unknown): number | null => {
      const parsed = Number(value);
      return value === null || value === undefined || Number.isNaN(parsed) ? null : parsed;
    };

    const page = toNumber(record.page) ?? 0;
    const length = toNumber(record.length);
    const total = toNumber(record.total);
    const pagesCount =
      toNumber(record.pagesCount) ??
      (total !== null ? (length ? Math.ceil(total / length) : 1) : null);
    const hasMore =
      typeof record.hasMore === 'boolean'
        ? record.hasMore
        : total !== null && length
          ? page * length + length < total
          : null;

    return { page, length, total, pagesCount, hasMore };
  }

  async fetchListPaginated(options: FetchListOptions = {}): Promise<ApiPaginatedList<T>> {
    const { query = {}, page = null, length = null, endpoint = 'list' } = options;
    const searchParams: ApiQuery = { ...query };

    if (page !== null) {
      searchParams.page = page;
    }

    if (length !== null) {
      searchParams.length = length;
    }

    const data = await this.client
      .get({ path: this.buildPath(endpoint), options: { searchParams } })
      .json<unknown>();

    const payload = this.extractPayload(data);
    const items = this.extractItems(payload);

    return {
      items: this.createFromApiCollection(items),
      pagination: this.extractPagination(payload, items.length),
    };
  }

  async fetchList(options: FetchListOptions = {}): Promise<T[]> {
    return (await this.fetchListPaginated(options)).items;
  }

  async fetchListCachedByName(options: FetchListCachedByNameOptions<T>): Promise<T[]> {
    const {
      cacheName,
      fetch,
      ttlMs = AbstractApiRepository.CACHE_TTL_DEFAULT,
      forceRefresh = false,
    } = options;
    const resolvedCacheName = cacheName?.trim() || this.getDefaultListCacheName();

    const now = Date.now();
    const previousEntry = this.namedListCache.get(resolvedCacheName);

    if (!forceRefresh && previousEntry?.value && this.isCacheEntryFresh(previousEntry, now)) {
      return previousEntry.value;
    }

    if (!forceRefresh && previousEntry?.inFlight) {
      return previousEntry.inFlight;
    }

    const inFlight = (async () => {
      try {
        const list = await fetch();
        this.namedListCache.set(resolvedCacheName, {
          value: list,
          expiresAt: this.computeExpiresAt(ttlMs),
        });
        return list;
      } catch (error) {
        if (previousEntry) {
          this.namedListCache.set(resolvedCacheName, {
            value: previousEntry.value,
            expiresAt: previousEntry.expiresAt,
          });
        } else {
          this.namedListCache.delete(resolvedCacheName);
        }
        throw error;
      }
    })();

    this.namedListCache.set(resolvedCacheName, {
      value: previousEntry?.value,
      expiresAt: previousEntry?.expiresAt ?? null,
      inFlight,
    });

    return inFlight;
  }

  invalidateNamedListCache(cacheName: string): void {
    this.namedListCache.delete(cacheName);
  }

  clearNamedListCache(): void {
    this.namedListCache.clear();
  }

  async fetchCached(options: FetchCachedByNameOptions): Promise<T> {
    const {
      cacheName,
      id,
      endpoint = 'show',
      ttlMs = AbstractApiRepository.CACHE_TTL_DEFAULT,
      forceRefresh = false,
    } = options;
    const resolvedCacheName = cacheName?.trim() || this.getDefaultEntityCacheName();

    const identifier = String(id ?? '').trim();
    if (!identifier) {
      throw new Error('id is required for fetchCached().');
    }

    const cacheKey = this.buildNamedEntityCacheKey(resolvedCacheName, endpoint, identifier);
    const now = Date.now();
    const previousEntry = this.namedEntityCache.get(cacheKey);

    if (!forceRefresh && previousEntry?.value && this.isCacheEntryFresh(previousEntry, now)) {
      return previousEntry.value;
    }

    if (!forceRefresh && previousEntry?.inFlight) {
      return previousEntry.inFlight;
    }

    if (!forceRefresh) {
      const bridgedEntity = this.findCachedEntityById(identifier);
      if (bridgedEntity) {
        this.namedEntityCache.set(cacheKey, {
          value: bridgedEntity,
          expiresAt: this.computeExpiresAt(ttlMs),
        });

        return bridgedEntity;
      }
    }

    const inFlight = (async () => {
      try {
        const entity = await this.fetch({
          identifier,
          endpoint,
        });
        this.namedEntityCache.set(cacheKey, {
          value: entity,
          expiresAt: this.computeExpiresAt(ttlMs),
        });
        return entity;
      } catch (error) {
        if (previousEntry) {
          this.namedEntityCache.set(cacheKey, {
            value: previousEntry.value,
            expiresAt: previousEntry.expiresAt,
          });
        } else {
          this.namedEntityCache.delete(cacheKey);
        }
        throw error;
      }
    })();

    this.namedEntityCache.set(cacheKey, {
      value: previousEntry?.value,
      expiresAt: previousEntry?.expiresAt ?? null,
      inFlight,
    });

    return inFlight;
  }

  invalidateNamedEntityCache(cacheName: string, id?: string | number, endpoint = 'show'): void {
    if (id === undefined || id === null || String(id).trim() === '') {
      const prefix = `${cacheName}::`;
      for (const key of this.namedEntityCache.keys()) {
        if (key.startsWith(prefix)) {
          this.namedEntityCache.delete(key);
        }
      }
      return;
    }

    const cacheKey = this.buildNamedEntityCacheKey(cacheName, endpoint, String(id).trim());
    this.namedEntityCache.delete(cacheKey);
  }

  clearNamedEntityCache(): void {
    this.namedEntityCache.clear();
  }

  async fetch(options: FetchOptions): Promise<T> {
    const { identifier, endpoint = 'show' } = options;
    const data = await this.client
      .get({ path: this.buildPath(`${endpoint}/${encodeURIComponent(identifier)}`) })
      .json<unknown>();

    const payload = this.extractPayload(data);
    const item = this.parseApiItem(payload);
    return this.createFromApiItem(item);
  }

  async post(options: PostOptions): Promise<unknown> {
    const { endpoint, payload = {} } = options;
    return this.client
      .post({
        path: this.buildPath(endpoint),
        options: { json: payload },
      })
      .json<unknown>();
  }

  async postEntity(options: PostEntityOptions): Promise<T> {
    const { endpoint, entity, query = {} } = options;
    const payload = entity.toApiPayload();

    const data = await this.client
      .post({
        path: this.buildPath(endpoint),
        options: {
          json: payload,
          searchParams: query,
        },
      })
      .json<unknown>();

    const responsePayload = this.extractPayload(data);
    const item = this.parseApiItem(responsePayload);
    return this.createFromApiItem(item);
  }

  async postEntityById(options: PostEntityByIdOptions): Promise<T> {
    const { endpoint, entity, id, query = {} } = options;
    const resolvedId = id ?? entity.id;

    if (!resolvedId) {
      throw new Error('Missing id for postEntityById().');
    }

    const payload = entity.toApiPayload();

    const data = await this.client
      .post({
        path: this.buildPath(`${endpoint}/${encodeURIComponent(resolvedId)}`),
        options: {
          json: payload,
          searchParams: query,
        },
      })
      .json<unknown>();

    const responsePayload = this.extractPayload(data);
    const item = this.parseApiItem(responsePayload);
    return this.createFromApiItem(item);
  }

  async createEntity(entity: T): Promise<T> {
    return this.postEntity({
      endpoint: 'create',
      entity,
    });
  }

  async postEntities(options: PostEntitiesOptions): Promise<T[]> {
    const { endpoint, entities, query = {} } = options;
    const payloads = entities.map((entity) => entity.toApiPayload());

    const data = await this.client
      .post({
        path: this.buildPath(endpoint),
        options: {
          json: {
            entities: payloads,
          },
          searchParams: query,
        },
      })
      .json<unknown>();

    const responsePayload = this.extractPayload(data);
    const items = this.extractItems(responsePayload);
    return this.createFromApiCollection(items);
  }

  async createEntities(entities: T[]): Promise<T[]> {
    return this.postEntities({
      endpoint: 'create',
      entities,
    });
  }

  async deleteEntity(options: DeleteEntityOptions): Promise<unknown> {
    const { identifier, endpoint = 'delete', query = {}, payload = null } = options;
    const path = this.buildPath(`${endpoint}/${encodeURIComponent(String(identifier))}`);
    const requestOptions =
      payload === null ? { searchParams: query } : { searchParams: query, json: payload };

    return this.client
      .delete({
        path,
        options: requestOptions,
      })
      .json<unknown>();
  }

  protected getEntityRegistry(): ApiEntityRegistry {
    const client = this.client as unknown as { getEntityRegistry: () => ApiEntityRegistry };
    return client.getEntityRegistry();
  }

  private computeExpiresAt(ttlMs: number | null): number | null {
    if (ttlMs === null) {
      return null;
    }

    return Date.now() + Math.max(0, ttlMs);
  }

  private isCacheEntryFresh(
    entry: Pick<NamedListCacheEntry<T>, 'expiresAt'> | Pick<NamedEntityCacheEntry<T>, 'expiresAt'>,
    now: number
  ): boolean {
    return entry.expiresAt === null || entry.expiresAt > now;
  }

  private buildNamedEntityCacheKey(cacheName: string, endpoint: string, id: string): string {
    return `${cacheName}::${endpoint}::${id}`;
  }

  private getDefaultListCacheName(): string {
    return `${this.getEntityType().entityName}::${AbstractApiRepository.CACHE_NAME_ALL}`;
  }

  private getDefaultEntityCacheName(): string {
    return `${this.getEntityType().entityName}::${AbstractApiRepository.CACHE_NAME_ENTITY}`;
  }

  private findCachedEntityById(id: string): T | undefined {
    const entityType = this.getEntityType();
    const fromRegistry = this.getEntityRegistry().resolve(entityType.entityName, id);
    if (fromRegistry) {
      return fromRegistry as T;
    }

    for (const entry of this.namedListCache.values()) {
      if (!entry.value) {
        continue;
      }

      const matched = entry.value.find((entity) => entity?.id === id);
      if (matched) {
        return matched;
      }
    }

    return undefined;
  }

  // Validates the {type, entity, metadata, relationships} shape instead of
  // trusting the response blindly; metadata/relationships may be absent
  // (decorations), type and entity may not.
  protected parseApiItem(value: unknown): ApiItem {
    const entityName = this.getEntityType().entityName;

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ApiSchemaError({
        message: `[js-api] invalid API item for entity "${entityName}": expected a {type, entity} object.`,
        code: ApiSchemaError.CODE_INVALID_ITEM,
        entityName,
      });
    }

    const record = value as Record<string, unknown>;

    if (typeof record.type !== 'string' || !record.type) {
      throw new ApiSchemaError({
        message: `[js-api] invalid API item for entity "${entityName}": missing "type".`,
        code: ApiSchemaError.CODE_INVALID_ITEM,
        entityName,
      });
    }

    if (!record.entity || typeof record.entity !== 'object' || Array.isArray(record.entity)) {
      throw new ApiSchemaError({
        message: `[js-api] invalid API item for entity "${entityName}": missing "entity" object.`,
        code: ApiSchemaError.CODE_INVALID_ITEM,
        entityName,
      });
    }

    const relationships =
      record.relationships &&
      typeof record.relationships === 'object' &&
      !Array.isArray(record.relationships)
        ? (record.relationships as ApiItemRelationships)
        : {};

    return {
      type: record.type,
      entity: record.entity as ApiEntityData,
      metadata: (record.metadata && typeof record.metadata === 'object'
        ? record.metadata
        : []) as ApiItemMetadata,
      relationships,
    };
  }
}
