import { stringToCamelCase, stringToKebab } from '@wexample/js-helpers/Helper/String';
import type AbstractApiEntity from '../Common/AbstractApiEntity.js';
import AbstractEntityManipulatorMixin from './AbstractEntityManipulatorMixin.js';
import WithAsyncComponentLoadVueMixin from '@wexample/js-api/Vue/WithAsyncComponentLoadVueMixin';

const AbstractEntitySingleMixin = {
  mixins: [AbstractEntityManipulatorMixin, WithAsyncComponentLoadVueMixin],
  emits: ['entity-deleted'],

  props: {
    entityInstance: {
      type: Object,
      required: false,
      default: null,
    },
    entityId: {
      type: [String, Number],
      required: false,
      default: null,
    },
  },

  data() {
    return {
      entity: this.entityInstance ?? null,
      entityLoading: false,
      cachedRelationships: {} as Record<string, AbstractApiEntity[]>,
    };
  },

  watch: {
    entityInstance(newEntity) {
      this.validateEntitySource();
      this.entity = newEntity ?? null;
    },

    async entityId(newId, oldId) {
      this.validateEntitySource();

      if (this.entityInstance || !newId || newId === oldId) {
        return;
      }

      await this.loadAsyncComponent(true);
    },
  },

  methods: {
    getEntityCssClassDeclarations() {
      const display = this.getEntityDisplay();
      const entityType = stringToKebab(this.getEntityClass().entityName);
      const classes: Array<string | [string, boolean]> = [
        'entity',
        ['entity--single', true],
        ['entity--loaded', !!this.asyncComponentLoaded],
        ['entity--loading', !!this.asyncComponentLoading],
        ['entity--sleeping', !!this.asyncComponentSleeping],
        ['entity--error', !!this.asyncComponentError],
        ['entity--has-data', !!this.entity],
        ['entity--empty', !this.entity],
        ['entity--busy', !!this.entityLoading],
        ['entity--type--' + entityType, !!entityType],
      ];

      if (display) {
        classes.push('entity--display--' + display);
        classes.push('entity--' + entityType + '--display--' + display);
      }

      return classes;
    },

    getEntityDisplay() {
      return null;
    },

    getWrapperCssClassDeclarations() {
      return this.getEntityCssClassDeclarations();
    },

    validateEntitySource() {
      const hasEntityInstance = this.entityInstance !== null && this.entityInstance !== undefined;
      const hasEntityId =
        this.entityId !== null && this.entityId !== undefined && this.entityId !== '';

      if (hasEntityInstance === hasEntityId) {
        throw new Error('Provide exactly one of entityInstance or entityId.');
      }
    },

    async fetchEntity() {
      const id = this.getEntityId();

      this.entityLoading = true;
      try {
        this.entity = await this.getEntityRepository().fetch({
          identifier: id,
        });
        return this.entity;
      } finally {
        this.entityLoading = false;
      }
    },

    getEntityId() {
      const idFromEntity = this.entity?.id ?? this.entityInstance?.id;
      const id = idFromEntity ?? this.entityId;

      if (id === null || id === undefined || id === '') {
        throw new Error('Missing entity id.');
      }

      return String(id);
    },

    getCachedRelationshipsMap(): Record<string, Promise<AbstractApiEntity[]> | null> | string[] {
      return {};
    },

    async _loadCachedRelationships(): Promise<void> {
      const map = this.getCachedRelationshipsMap();
      const entries: [string, Promise<AbstractApiEntity[]>][] = Array.isArray(map)
        ? map.map((name: string) => [
            stringToCamelCase(name),
            (this as any).getEntityRepository(name).fetchAllCached(),
          ])
        : Object.entries(map).map(([name, promise]) => [
            stringToCamelCase(name),
            promise ?? (this as any).getEntityRepository(name).fetchAllCached(),
          ]);

      if (!entries.length) return;

      await Promise.all(
        entries.map(async ([key, promise]) => {
          this.cachedRelationships[key] = await promise;
        })
      );
    },

    getCachedRelationship(name: string, entity?: AbstractApiEntity): AbstractApiEntity | null {
      const camelName = stringToCamelCase(name);
      const id = (entity ?? (this as any).entity).data[camelName];
      return (
        this.cachedRelationships[camelName]?.find((e: AbstractApiEntity) => e.id === id) ?? null
      );
    },

    getCachedRelationshipsByIds(name: string, ids: string[]): AbstractApiEntity[] {
      const camelName = stringToCamelCase(name);
      return (
        this.cachedRelationships[camelName]?.filter((e: AbstractApiEntity) => ids.includes(e.id)) ??
        []
      );
    },

    async asyncComponentLoad() {
      this.validateEntitySource();

      if (this.entityInstance) {
        this.entity = this.entityInstance;
        await this._loadCachedRelationships();
        return;
      }

      await Promise.all([this.fetchEntity(), this._loadCachedRelationships()]);
    },

    async deleteCurrentEntity() {
      const id = this.getEntityId();
      const deletedEntity = this.entity;

      await this.getEntityRepository().deleteEntity({
        identifier: id,
      });

      this.entity = null;
      this.$emit('entity-deleted', {
        entity: deletedEntity,
        identifier: id,
      });
    },
  },
};

export default AbstractEntitySingleMixin;
