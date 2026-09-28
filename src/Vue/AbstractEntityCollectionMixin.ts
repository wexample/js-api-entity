import AbstractEntityManipulatorMixin from './AbstractEntityManipulatorMixin.js';

const AbstractEntityCollectionMixin = {
  mixins: [AbstractEntityManipulatorMixin],

  data() {
    return {
      entities: [],
    };
  },

  async mounted() {
    await this.fetchEntities();
  },

  methods: {
    getEntitiesFetchParams() {
      return undefined;
    },

    async fetchEntities(params) {
      const fetchParams = params ?? this.getEntitiesFetchParams();
      const repository = this.getEntityRepository();
      this.entities = fetchParams
        ? await repository.fetchList(fetchParams)
        : await repository.fetchList();
    },
  },
};

export default AbstractEntityCollectionMixin;
