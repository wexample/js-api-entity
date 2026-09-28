import type { ApiEntitySchemaProperty } from '../Common/AbstractApiEntity.js';

export function getSchemaPropertyByName(
  schemaProperties: ApiEntitySchemaProperty[],
  name: string
): ApiEntitySchemaProperty | undefined {
  return schemaProperties.find((property) => property.name === name);
}

// The key a property uses on the wire; defaults to its schema name.
export function getPropertyApiField(property: ApiEntitySchemaProperty): string {
  return property.apiField || property.name;
}

export function getSchemaPropertyByApiField(
  schemaProperties: ApiEntitySchemaProperty[],
  apiField: string
): ApiEntitySchemaProperty | undefined {
  return schemaProperties.find((property) => getPropertyApiField(property) === apiField);
}

export function isPropertyWritable(property: ApiEntitySchemaProperty): boolean {
  if (property.writable === false) {
    return false;
  }

  return property.readOnly !== true;
}

export function isPropertySerializable(property: ApiEntitySchemaProperty): boolean {
  return property.serializable !== false;
}
