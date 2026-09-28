import AbstractApiEntity from '@wexample/js-api-entity/Common/AbstractApiEntity';
import schema from '{{DATA_DIR}}/{{ENTITY_NAME}}.json';

export default class {{CLASS_NAME}} extends AbstractApiEntity {
  static readonly entityName = '{{CAMEL_NAME}}';

  static retrieveEntitySchema() {
    return schema;
  }
}
