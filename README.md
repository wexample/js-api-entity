# @wexample/js-api-entity

Version: 1.0.6

`@wexample/js-api-entity` is the TypeScript client side of the convention `wexample/symfony-api` serves. `AbstractApiEntity` and `AbstractApiRepository` turn `{type, entity, metadata, relationships}` items into entities checked field by field against the entity schema — an unknown key throws an `ApiSchemaError` instead of landing silently in the object. Repositories add named list and entity caches with TTL and in-flight deduplication, zero-indexed pagination mirroring `Wexample\SymfonyApi\Api\Dto\PaginationDto`, and hydration of relationships through the repositories registered on the client. Mercure live updates, the entity Vue mixins and the entity/repository generators ship in the same package.

Transport — base URL, token, timeouts, retries, `ApiHttpError` — comes from `@wexample/js-api`, which this package extends. The PHP counterpart is `wexample/php-api-entity`.

Entity and repository classes are generated from the schemas `symfony-api` exports:

```bash
node node_modules/@wexample/js-api-entity/bin/generate-entities.mjs     --data-dir=assets/data/entity --output-dir=assets
node node_modules/@wexample/js-api-entity/bin/generate-repositories.mjs --data-dir=assets/data/entity --output-dir=assets
```

## Table of Contents

- [Architecture](#architecture)
- [Integration in the Suite](#integration-in-the-suite)
- [Dependencies](#dependencies)
- [Versioning & Compatibility Policy](#versioning--compatibility-policy)
- [License](#license)
- [About us](#about-us)
- [Migration Notes](#migration-notes)

## Architecture

The package is the TypeScript client side of the convention `wexample/symfony-api` serves, shipped as raw TypeScript under src like `@wexample/js-api`, which it extends: src/Common holds the entities-aware client, entities, repositories, the envelope, live updates and their errors, src/Helper pure functions over schemas and values, src/Vue the entity mixins, bin the code generators. Consumers import `@wexample/js-api-entity/Common/AbstractApiEntity` and bundle it themselves; `npm run build` is `tsc --noEmit`.

### The client

`AbstractApiEntitiesClient` (src/Common/AbstractApiEntitiesClient.ts) extends `@wexample/js-api`'s `AbstractApiClient` — base URL, bearer token, hooks, timeouts, retries and `ApiHttpError` all come from there. Its constructor instantiates one `ApiEntityManager` from `this.getRepositoryClasses()` — the single abstract method a concrete client must implement — and one `ApiEntityRegistry`. `getRepository(entity)` delegates to the manager and accepts either an entity class or its `entityName` string.

### Entities, schemas and repositories

`AbstractApiEntity` is a data bag guarded by a schema. Values live in a private `this.data` record, never as declared class fields, and every write goes through `set(name, value)`, which looks the property up in `retrieveEntitySchema().properties` and throws `ApiSchemaError` when it is unknown or read-only. Hydration from a response uses `assignFromApi()`, which resolves each response key by its *wire* name (`getSchemaPropertyByApiField`) and writes with `{ system: true }` — the privileged flag bypasses the read-only guard but never the schema itself. The reverse direction, `toApiPayload()`, emits only properties that are serializable, writable and actually present in `this.data`.

Reads go through a `Proxy` installed in the constructor (opt out with `static useProxy = false`). It resolves `getX()` to a relationship, then to a collection of relationships, then to `getDataValue(lowerFirstCharacter(name))`, and `getXId()` to the relationship's `id` or the `xId` data key — the JavaScript counterpart of PHP's `__call`.

`AbstractApiRepository` (src/Common/AbstractApiRepository.ts) owns endpoints, hydration and caching. Paths are derived, not configured: `buildPath()` kebab-cases the entity name and appends the endpoint, so a `userAccount` repository fetches `user-account/list` and `user-account/show/<id>`. Around that sit `fetchListPaginated`/`fetchList`, `fetch`, `post`, `postEntity`, `postEntityById`, `postEntities` and `deleteEntity`, plus the caching variants below.

### The path of a call

`fetchListPaginated()` is the representative trace:

1. the repository builds `user-account/list` and calls `this.client.get({ path, options: { searchParams } })`;
2. `AbstractApiClient` prefixes the base URL, applies headers and the bearer token, and `ky` performs the request — an HTTP failure leaves here as `ApiHttpError`;
3. `extractPayload()` runs `unwrapApiEnvelope()`, which validates the `{type, code, message, data}` envelope produced by `wexample/symfony-api` controllers and throws `ApiEnvelopeError` on `type === 'error'`, so no caller ever re-tests `type === 'success'`;
4. `extractItems()` maps each element through `parseApiItem()`, which requires a string `type` and an object `entity` and tolerates missing `metadata`/`relationships`;
5. `createFromApiItem()` asserts `item.type === entityType.entityName`, hydrates via `entityType.fromApi(item.entity)`, attaches metadata, registers the instance in the client's `ApiEntityRegistry`, then attaches relationships;
6. `createRelationships()` resolves each relation's `type` to another repository through `this.client.getRepository(...)` and recurses — an unregistered type raises `ApiSchemaError` naming both the owning entity and the relation;
7. `extractPagination()` normalises the pagination block, treating its absence as a single full page (`{ page: 0, length: null, total: itemsCount, pagesCount: 1, hasMore: false }`).

`hydrateApiItem(value)` is the public door into steps 4–6 for a payload that did not come from a request — a live update, typically.

Two caches live on the repository instance, `namedListCache` and `namedEntityCache`, both keyed by a cache name (default `<entityName>::all` and `<entityName>::entity`), both storing `{ value, expiresAt, inFlight }`. Concurrent callers share the `inFlight` promise; a rejected refresh restores the previous entry rather than leaving a hole; `ttlMs === null` — the default, `CACHE_TTL_DEFAULT` — means never expires. `fetchCached()` additionally short-circuits through `findCachedEntityById()`, which consults the entity registry and the list caches before issuing a request.

### Identity registry and stubs

`ApiEntityRegistry` keeps one instance per `entityName`/`id` pair and solves forward references. When a response mentions an entity that has not arrived yet, the owner holds an `ApiEntityStub` — an entity whose schema is a lone `id` and whose `isStub()` returns `true` — registered through `registerStub(owner, stub)`. The moment the real entity is registered, `registerEntity()` walks the waiting stubs and calls `owner.replaceRelationship(stub, entity)`. Names are compared normalised: `normalizeName()` snake-cases before lowercasing, so `userAccount` and `user_account` are the same key.

### Live updates

Three pieces, deliberately separate. `LiveUpdatesDriverInterface` is the whole transport contract — one method, `connect({ topics }): EventSource | Promise<EventSource>`, async so a driver can fetch a subscriber token first. `MercureLiveUpdatesDriver` implements it by building `<hubUrl>/.well-known/mercure?topic=…&authorization=<jwt>`; the JWT travels as a query parameter because `EventSource` cannot set an `Authorization` header. `LiveUpdatesConnection` owns everything else: it opens the stream, JSON-parses `event.data` (falling back to the raw string), and reconnects through a `RetryBackoffScheduler` from `@wexample/js-helpers`, exposing the states `connecting`, `open`, `error`, `reconnecting`, `reconnect-stopped`, `closed`. The optional `onReconnectScheduled` callback adds what a status cannot say — the attempt number and the delay before the retry.

`LiveSubscriberInfoResolver` (src/Common/LiveUpdates/LiveSubscriberInfoResolver.ts) is what makes a token outlive its own expiry. It wraps a `fetchInfo()` supplied by the application — the call to `symfony-live`'s `subscribe-info` endpoint, whose `{hubUrl, jwt, topics, expiresAt}` shape it types — and caches the answer until `renewMarginMs` (default 60s) before `expiresAt`. Connections opening together share one in-flight request; `invalidate()` drops the token when a hub rejects it for a reason expiry does not explain.

It exists because the failure is invisible otherwise: a hub never closes a stream whose token has expired, so nothing goes wrong until the next reconnection, which then loops on a 401 no listener reports. `MercureLiveUpdatesDriver` calls its config resolver on *every* connect, so passing an async resolver that awaits `resolve()` is the whole wiring. A synchronous resolver still returns an `EventSource` synchronously — only an async one defers, which is why the driver returns a union rather than always a promise.

`LiveUpdatesConnectionRegistry` observes connections without owning them: `register()` attaches a passive observer, an incoming `closed` status auto-unregisters, and `getAggregatedStatus()` returns one counter per state plus `hasActiveConnection`. A status widget listens through `onEvent()` and never touches a connection.

### Errors

The errors extend `AbstractAppError` from `@wexample/js-api` and add three kinds to its `api.http`: `api.envelope` (`ApiEnvelopeError`, keeping the raw envelope), `api.schema` (`ApiSchemaError`, with `entityName`/`field` and the four `CODE_*` constants) and `api.live-updates` (`LiveUpdatesError`). Strictness is the design: an `ApiSchemaError` means the API contract drifted, not that the client should cope.

### The Vue layer

The entity mixins in src/Vue reach the client through a host-application convention this package does not define: `this['app'].getService('api').client`. `AbstractEntityManipulatorMixin` isolates that lookup in `getEntityManager()` and `getEntityRepository()`; every other entity mixin builds on it. `AbstractEntityCollectionMixin` fetches a list on `mounted`. `AbstractEntitySingleMixin` composes it with `@wexample/js-api`'s `WithAsyncComponentLoadVueMixin` and requires exactly one of the `entityInstance` or `entityId` props, `validateEntitySource()` throwing when both or neither are set. `AbstractEntityCollectionFormMixin` extends `@wexample/js-api`'s `AbstractFormMixin` with `submitEntity()`/`submitEntities()`, defaulting to the `save` endpoint.

### Code generation

bin/generate-entities.mjs and bin/generate-repositories.mjs are dependency-free Node scripts that read a directory of entity schema JSON files (`--data-dir`, default `front/data/entity`) and write one class per schema into `--output-dir` (default `front/js`), from the templates in bin/template. Both are additive: an existing target file is skipped, so hand-written methods survive a regeneration. Each run rewrites two manifests — `Common/generatedEntitySchemas.ts` and `Common/generatedRepositories.ts`, the latter being the array a client returns from `getRepositoryClasses()`. A schema carrying a `"package"` key generates nothing and is imported from that package instead, which is how an application reuses entities defined by a shared package.

## Integration in the Suite

This package is part of the Wexample Suite — a collection of high-quality, modular tools designed to work seamlessly together across multiple languages and environments.

### Related Packages

The suite includes packages for configuration management, file handling, prompts, and more. Each package can be used independently or as part of the integrated suite.

Visit the [Wexample Suite documentation](https://docs.wexample.com) for the complete package ecosystem.

## Dependencies

- @wexample/js-api: >=7.0.3
- @wexample/js-helpers: >=3.0.0

## Versioning & Compatibility Policy

Wexample packages follow **Semantic Versioning** (SemVer):

- **MAJOR**: Breaking changes
- **MINOR**: New features, backward compatible
- **PATCH**: Bug fixes, backward compatible

We maintain backward compatibility within major versions and provide clear migration guides for breaking changes.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

Free to use in both personal and commercial projects.

## About us

[Wexample](https://wexample.com) stands as a cornerstone of the digital ecosystem — a collective of seasoned engineers, researchers, and creators driven by a relentless pursuit of technological excellence. More than a media platform, it has grown into a vibrant community where innovation meets craftsmanship, and where every line of code reflects a commitment to clarity, durability, and shared intelligence.

This packages suite embodies this spirit. Trusted by professionals and enthusiasts alike, it delivers a consistent, high-quality foundation for modern development — open, elegant, and battle-tested. Its reputation is built on years of collaboration, refinement, and rigorous attention to detail, making it a natural choice for those who demand both robustness and beauty in their tools.

Wexample cultivates a culture of mastery. Each package, each contribution carries the mark of a community that values precision, ethics, and innovation — a community proud to shape the future of digital craftsmanship.

## Migration Notes

When upgrading between major versions, refer to the migration guides in the documentation.

Breaking changes are clearly documented with upgrade paths and examples.
