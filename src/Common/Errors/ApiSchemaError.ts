import AbstractAppError from '@wexample/js-api/Common/Errors/AbstractAppError';

export type ApiSchemaErrorOptions = {
  message: string;
  code?: string;
  // Schema name of the entity whose contract was violated.
  entityName?: string;
  // Field or relation name involved in the violation.
  field?: string;
  cause?: unknown;
};

// Raised when data crossing the client boundary does not match the entity
// schema: unknown field, read-only write, malformed API item, unregistered
// relationship type. Clients are strict by design — this error surfacing
// means the API contract drifted, not that the client should tolerate it.
export default class ApiSchemaError extends AbstractAppError {
  public static readonly CODE_UNKNOWN_FIELD = 'ERR_SCHEMA_UNKNOWN_FIELD';
  public static readonly CODE_READ_ONLY_FIELD = 'ERR_SCHEMA_READ_ONLY_FIELD';
  public static readonly CODE_INVALID_ITEM = 'ERR_SCHEMA_INVALID_ITEM';
  public static readonly CODE_UNKNOWN_RELATIONSHIP = 'ERR_SCHEMA_UNKNOWN_RELATIONSHIP';

  public readonly entityName?: string;
  public readonly field?: string;

  constructor(options: ApiSchemaErrorOptions) {
    super({
      message: options.message,
      kind: 'api.schema',
      code: options.code,
      context: {
        entityName: options.entityName,
        field: options.field,
      },
      cause: options.cause,
    });
    this.entityName = options.entityName;
    this.field = options.field;
  }
}
