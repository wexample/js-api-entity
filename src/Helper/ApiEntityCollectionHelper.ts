import type AbstractApiEntity from '../Common/AbstractApiEntity.js';

// Merges a fresh reading of a collection into the held one. Membership and
// order come from the fresh reading — the server stays the one deciding what
// the collection holds — but an entity already held keeps its instance and
// absorbs the new values. Preserving references is the point: it is what lets
// a renderer keyed on identity redraw only what actually changed.
export function reconcileEntityCollection<T extends AbstractApiEntity>(
  held: T[],
  fresh: T[],
  getKey: (entity: T) => unknown = (entity) => entity.id
): T[] {
  const heldByKey = new Map(held.map((entity) => [getKey(entity), entity]));

  return fresh.map((entity) => {
    const existing = heldByKey.get(getKey(entity));

    if (!existing) {
      return entity;
    }

    existing.absorb(entity);

    return existing;
  });
}
