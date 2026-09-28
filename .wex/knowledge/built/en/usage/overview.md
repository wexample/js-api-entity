`@wexample/js-api-entity` is the TypeScript client side of the convention `wexample/symfony-api` serves. `AbstractApiEntity` and `AbstractApiRepository` turn `{type, entity, metadata, relationships}` items into entities checked field by field against the entity schema — an unknown key throws an `ApiSchemaError` instead of landing silently in the object. Repositories add named list and entity caches with TTL and in-flight deduplication, zero-indexed pagination mirroring `Wexample\SymfonyApi\Api\Dto\PaginationDto`, and hydration of relationships through the repositories registered on the client. Mercure live updates, the entity Vue mixins and the entity/repository generators ship in the same package.

Transport — base URL, token, timeouts, retries, `ApiHttpError` — comes from `@wexample/js-api`, which this package extends. The PHP counterpart is `wexample/php-api-entity`.

Entity and repository classes are generated from the schemas `symfony-api` exports:

```bash
node node_modules/@wexample/js-api-entity/bin/generate-entities.mjs     --data-dir=assets/data/entity --output-dir=assets
node node_modules/@wexample/js-api-entity/bin/generate-repositories.mjs --data-dir=assets/data/entity --output-dir=assets
```
