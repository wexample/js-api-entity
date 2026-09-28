import type { ApiEntitySchemaProperty } from '../Common/AbstractApiEntity.js';

export function normalizePropertyType(type: unknown): string {
  if (typeof type !== 'string') {
    return '';
  }

  const lowered = type.toLowerCase();
  if (lowered === 'datetimeinterface' || lowered === 'date') {
    return 'datetime';
  }

  return lowered;
}

export function normalizeIncomingValue(property: ApiEntitySchemaProperty, value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  switch (normalizePropertyType(property.type)) {
    case 'datetime': {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
      }
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    case 'integer': {
      const num = Number(value);
      return Number.isNaN(num) ? null : Math.trunc(num);
    }
    case 'float':
    case 'double':
    case 'decimal': {
      const num = Number(value);
      return Number.isNaN(num) ? null : num;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : Boolean(value);
    case 'string':
      return String(value);
    default:
      return value;
  }
}

export function serializeOutgoingValue(property: ApiEntitySchemaProperty, value: unknown): unknown {
  if (value === undefined || value === null) {
    return null;
  }

  const type = normalizePropertyType(property.type);
  switch (type) {
    case 'relation':
      return serializeRelationValue(value);
    case 'collection':
      return serializeCollectionValue(value);
    case 'datetime': {
      if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
      }
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    case 'integer': {
      const num = Number(value);
      return Number.isNaN(num) ? null : Math.trunc(num);
    }
    case 'float':
    case 'double':
    case 'decimal': {
      const num = Number(value);
      return Number.isNaN(num) ? null : num;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : Boolean(value);
    case 'string':
      return String(value);
    default:
      return value;
  }
}

function serializeRelationValue(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }

  return null;
}

function serializeCollectionValue(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value == null ? [] : [value];
  return items
    .map((item) => serializeRelationValue(item))
    .filter((item): item is string => item !== null);
}
