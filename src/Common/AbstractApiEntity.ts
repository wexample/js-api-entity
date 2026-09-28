export type ApiEntityData = Record<string, unknown>;
export type ApiEntityMetadata = Record<string, unknown> | unknown[];
export type ApiEntitySchemaProperty = {
  name: string;
  type?: string;
  apiField?: string;
  writable?: boolean;
  readOnly?: boolean;
  serializable?: boolean;
};
export type ApiEntitySchema = {
  name: string;
  properties: unknown[];
};

import {
  getPropertyApiField,
  getSchemaPropertyByApiField,
  getSchemaPropertyByName,
  isPropertySerializable,
  isPropertyWritable,
} from '../Helper/ApiEntitySchemaHelper.js';
import { normalizeIncomingValue, serializeOutgoingValue } from '../Helper/ApiEntityValueHelper.js';
import { lowerFirstCharacter } from '../Helper/EntityNameHelper.js';
import ApiSchemaError from './Errors/ApiSchemaError.js';

export type ApiEntitySetOptions = {
  // Privileged write used by API hydration: bypasses the read-only guard,
  // never the schema itself (an unknown property always throws).
  system?: boolean;
};

export type ApiEntityConstructor<T extends AbstractApiEntity> = {
  new (data?: ApiEntityData): T;
  readonly entityName: string;
  retrieveEntitySchema(): ApiEntitySchema;
  fromApi(data: ApiEntityData): T;
  fromApiCollection(collection: ApiEntityData[]): T[];
};

export default abstract class AbstractApiEntity {
  static readonly entityName: string;
  id?: string;
  readonly entityName?: string;
  metadata: ApiEntityMetadata;
  relationships: AbstractApiEntity[];
  protected readonly data: ApiEntityData;

  constructor(data: ApiEntityData = {}) {
    this.data = {};
    this.id = undefined;
    this.metadata = [];
    this.relationships = [];
    this.entityName = (this.constructor as typeof AbstractApiEntity).entityName;

    this.patch(data);

    // Allow dynamic getX()/getXId() via Proxy, similar to PHP __call.
    if ((this.constructor as typeof AbstractApiEntity).useProxy) {
      // biome-ignore lint/correctness/noConstructorReturn: returning a Proxy from the constructor is intentional
      return AbstractApiEntity.createProxy(this);
    }
  }

  static fromApi<T extends AbstractApiEntity>(
    this: ApiEntityConstructor<T>,
    data: ApiEntityData
  ): T {
    // biome-ignore lint: keep subclass instantiation with `this`.
    const entity = new this();
    entity.assignFromApi(data);
    return entity;
  }

  static fromApiCollection<T extends AbstractApiEntity>(
    this: ApiEntityConstructor<T>,
    collection: ApiEntityData[]
  ): T[] {
    // biome-ignore lint: keep subclass behavior via `this`.
    return collection.map((item) => this.fromApi(item));
  }

  static retrieveEntitySchema(): ApiEntitySchema {
    throw new Error('Entity must define static retrieveEntitySchema().');
  }

  setMetadata(metadata: ApiEntityMetadata): void {
    this.metadata = metadata;
  }

  setRelationships(relationships: AbstractApiEntity[]): void {
    this.relationships = relationships;
  }

  isStub(): boolean {
    return false;
  }

  replaceRelationship(stub: AbstractApiEntity, entity: AbstractApiEntity): void {
    this.relationships = this.relationships.map((relationship) => {
      if (relationship === stub) {
        return entity;
      }

      if (relationship.isStub?.() && relationship.id && relationship.id === stub.id) {
        const targetName = (relationship as { targetName?: string }).targetName;
        const stubTargetName = (stub as { targetName?: string }).targetName;
        if (targetName && stubTargetName && targetName === stubTargetName) {
          return entity;
        }
      }

      return relationship;
    });
  }

  getRelationship(name: string): AbstractApiEntity | undefined {
    for (const relationship of this.relationships) {
      const relationshipConstructor = relationship.constructor as typeof AbstractApiEntity;
      const entityName = relationship.entityName;
      if (!entityName) {
        throw new Error('[js-api] relationship missing entityName');
      }

      if (entityName === name || relationshipConstructor.name === name) {
        return relationship;
      }

      const stubTargetName = (relationship as { targetName?: string }).targetName;
      if (stubTargetName && stubTargetName === name) {
        return relationship;
      }
    }

    return undefined;
  }

  getRelationships(name: string): AbstractApiEntity[] {
    return this.relationships.filter((relationship) => {
      const relationshipConstructor = relationship.constructor as typeof AbstractApiEntity;
      const entityName = relationship.entityName;
      if (!entityName) {
        throw new Error('[js-api] relationship missing entityName');
      }

      if (entityName === name || relationshipConstructor.name === name) {
        return true;
      }

      const stubTargetName = (relationship as { targetName?: string }).targetName;
      return !!stubTargetName && stubTargetName === name;
    });
  }

  findRelationship(id: string): AbstractApiEntity | undefined {
    return this.relationships.find((relationship) => relationship.id === id);
  }

  getIdFor(name: string): string | undefined {
    const property = `${name}Id`;
    const value = this.getDataValue(property);

    return typeof value === 'string' ? value : undefined;
  }

  setDataValue(name: string, value: unknown): void {
    this.data[name] = value;

    if (name === 'id') {
      this.id = typeof value === 'string' ? value : undefined;
    }
  }

  getDataValue(name: string): unknown {
    return this.data[name];
  }

  getData(): Readonly<ApiEntityData> {
    return this.data;
  }

  // Hydrates from an API payload through the same gate as set(): every
  // response key must match a schema property (by its wire name) — an
  // unknown key means the API contract drifted and throws.
  assignFromApi(data: ApiEntityData): void {
    const schemaProperties = this.getSchemaProperties();

    for (const [apiField, value] of Object.entries(data)) {
      const property = getSchemaPropertyByApiField(schemaProperties, apiField);

      if (!property) {
        throw new ApiSchemaError({
          message: `[js-api] field not allowed by schema (${this.entityName}): ${apiField}`,
          code: ApiSchemaError.CODE_UNKNOWN_FIELD,
          entityName: this.entityName,
          field: apiField,
        });
      }

      this.set(property.name, value, { system: true });
    }
  }

  set(name: string, value: unknown, options: ApiEntitySetOptions = {}): void {
    const property = getSchemaPropertyByName(this.getSchemaProperties(), name);
    if (!property) {
      throw new ApiSchemaError({
        message: `[js-api] unknown property "${name}" on entity "${this.entityName}".`,
        code: ApiSchemaError.CODE_UNKNOWN_FIELD,
        entityName: this.entityName,
        field: name,
      });
    }

    if (!options.system && !isPropertyWritable(property)) {
      throw new ApiSchemaError({
        message: `[js-api] property "${name}" is read-only on entity "${this.entityName}".`,
        code: ApiSchemaError.CODE_READ_ONLY_FIELD,
        entityName: this.entityName,
        field: name,
      });
    }

    this.setDataValue(name, normalizeIncomingValue(property, value));
  }

  patch(data: ApiEntityData): void {
    for (const [name, value] of Object.entries(data)) {
      this.set(name, value);
    }
  }

  // Takes over the state of a fresher reading of the same entity, keeping this
  // instance — and every reference held to it — current. The fresh values went
  // through set() when the reading was hydrated, so they land here as they are.
  absorb(fresh: AbstractApiEntity): void {
    for (const [name, value] of Object.entries(fresh.getData())) {
      this.setDataValue(name, value);
    }

    this.setMetadata(fresh.metadata);
    this.setRelationships(fresh.relationships);
  }

  toApiPayload(): ApiEntityData {
    const output: ApiEntityData = {};
    const schemaProperties = this.getSchemaProperties();
    for (const property of schemaProperties) {
      if (!isPropertySerializable(property) || !isPropertyWritable(property)) {
        continue;
      }

      if (!(property.name in this.data)) {
        continue;
      }

      output[getPropertyApiField(property)] = serializeOutgoingValue(
        property,
        this.data[property.name]
      );
    }

    return output;
  }

  protected getSchemaProperties(): ApiEntitySchemaProperty[] {
    const entityType = this.constructor as typeof AbstractApiEntity;
    const schema = entityType.retrieveEntitySchema();
    return schema.properties as ApiEntitySchemaProperty[];
  }

  static useProxy = true;

  private static createProxy<T extends AbstractApiEntity>(target: T): T {
    return new Proxy(target, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);
        // Bound to what the member was read through, and not to the bare
        // entity: an entity held by a reactive list — a vue component's — is
        // read through the list's wrapper, and a method bound past it reads and
        // writes out of its sight. A refresh absorbed that way changed the
        // values and told nothing that showed them.
        //
        // The class itself is not a method and is handed over as it is: bound,
        // it would lose its own statics and answer with its parent's — the
        // schema of no entity at all.
        if (typeof value === 'function' && prop !== 'constructor') {
          return value.bind(receiver);
        }

        if (typeof prop !== 'string') {
          return value;
        }

        if (value !== undefined) {
          return value;
        }

        const dataValue = receiver.getDataValue(prop);
        if (dataValue !== undefined) {
          return dataValue;
        }

        if (prop.startsWith('get') && prop.length > 3) {
          // `getId` itself would leave an empty relationship name behind.
          if (prop.endsWith('Id') && prop.length > 5) {
            const name = prop.slice(3, -2);
            return () => {
              const relationship = receiver.getRelationship(name);
              if (relationship?.id) {
                return relationship.id;
              }

              return receiver.getIdFor(name);
            };
          }

          if (prop !== 'getRelationship' && prop !== 'getRelationships') {
            const name = prop.slice(3);
            return () => {
              const single = receiver.getRelationship(name);
              if (single !== undefined) {
                return single;
              }

              const many = receiver.getRelationships(name);
              if (many.length) {
                return many;
              }

              const fieldName = lowerFirstCharacter(name);
              return receiver.getDataValue(fieldName);
            };
          }
        }

        return value;
      },
    });
  }
}
