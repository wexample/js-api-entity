import type AbstractApiEntity from '../Common/AbstractApiEntity.js';
import type { ApiEntityConstructor } from '../Common/AbstractApiEntity.js';
import type AbstractApiRepository from '../Common/AbstractApiRepository.js';
import type ApiEntityManager from '../Common/ApiEntityManager.js';

type ApiClientHolder = {};

type EntityManipulatorThis = ApiClientHolder & {
  getEntityClass(): ApiEntityConstructor<AbstractApiEntity>;
};

const AbstractEntityManipulatorMixin = {
  methods: {
    getEntityClass(): ApiEntityConstructor<AbstractApiEntity> {
      throw new Error('getEntityClass() must be implemented.');
    },

    getEntityManager(this: ApiClientHolder): ApiEntityManager {
      // Once migrated to app, we may use ApiService class
      return this['app'].getService('api').client.getEntityManager();
    },

    getEntityRepository(
      this: EntityManipulatorThis,
      entityType?: ApiEntityConstructor<AbstractApiEntity>
    ): AbstractApiRepository<AbstractApiEntity> {
      // Once migrated to app, we may use ApiService class
      const entityClass = entityType ?? this.getEntityClass();
      return this['app'].getService('api').client.getRepository(entityClass);
    },
  },
};

export default AbstractEntityManipulatorMixin;
