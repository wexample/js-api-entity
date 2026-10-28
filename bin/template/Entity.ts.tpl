import {{PARENT_CLASS}} from '{{PARENT_IMPORT}}';
import type { ApiEntitySchema } from '@wexample/js-api-entity/Common/AbstractApiEntity';
import schema from '{{DATA_DIR}}/{{ENTITY_NAME}}.json';

export default class {{CLASS_NAME}} extends {{PARENT_CLASS}} {
{{ENTITY_NAME_DECLARATION}}  // Typed as any schema, so that a subclass may answer its own.
  static retrieveEntitySchema(): ApiEntitySchema {
    return schema;
  }
}
