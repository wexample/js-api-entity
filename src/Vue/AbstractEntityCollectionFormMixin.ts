import type AbstractApiEntity from '../Common/AbstractApiEntity.js';
import AbstractFormMixin from '@wexample/js-api/Vue/AbstractFormMixin';

type FormErrorsPayload = {
  form?: string[];
  fields?: Record<string, string[]>;
};

type SubmitEntityOptions = {
  endpoint?: string;
  query?: Record<string, string | number | boolean>;
};

type SubmitEntitiesOptions = {
  endpoint?: string;
  query?: Record<string, string | number | boolean>;
};

const AbstractEntityCollectionFormMixin = {
  mixins: [AbstractFormMixin],

  methods: {
    buildSubmitEntity(): AbstractApiEntity | null {
      return null;
    },

    buildSubmitEntities(): AbstractApiEntity[] {
      return [];
    },

    async submitEntity(options: SubmitEntityOptions = {}) {
      const { endpoint = 'save', query = {} } = options;
      const entity = this.buildSubmitEntity();

      return this.submitFormAction({
        asyncAction: async () => {
          if (!entity) {
            throw new Error('buildSubmitEntity() must return an entity before submit.');
          }

          return this.getEntityRepository().postEntity({
            endpoint,
            entity,
            query,
          });
        },
      });
    },

    async submitEntities(options: SubmitEntitiesOptions = {}) {
      const { endpoint = 'save', query = {} } = options;
      const entities = this.buildSubmitEntities();

      return this.submitFormAction({
        asyncAction: async () => {
          return this.getEntityRepository().postEntities({
            endpoint,
            entities,
            query,
          });
        },
      });
    },

    extractEntityFormErrors(_error: unknown): FormErrorsPayload | null {
      return null;
    },

    handleSubmitError(error: unknown): void {
      const extracted = this.extractEntityFormErrors(error);

      if (extracted && (Array.isArray(extracted.form) || extracted.fields)) {
        this.setFormErrors({
          formErrors: extracted.form || [],
          fieldErrors: extracted.fields || {},
        });
      }
    },
  },
};

export default AbstractEntityCollectionFormMixin;
