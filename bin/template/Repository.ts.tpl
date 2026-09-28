import AbstractApiRepository from '@wexample/js-api-entity/Common/AbstractApiRepository';
import {{CLASS_NAME}} from '../Entity/{{CLASS_NAME}}.js';

export default class {{CLASS_NAME}}Repository extends AbstractApiRepository<{{CLASS_NAME}}> {
  static getEntityType() {
    return {{CLASS_NAME}};
  }
}
