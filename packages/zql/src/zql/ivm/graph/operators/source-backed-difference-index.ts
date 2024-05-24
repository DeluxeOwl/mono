import type {Primitive} from '../../../ast/ast.js';
import type {Entry} from '../../multiset.js';
import type {SourceHashIndex} from '../../source/source-hash-index.js';
import type {PipelineEntity} from '../../types.js';

export class SourceHashIndexBackedDifferenceIndex<
  Key extends Primitive,
  V extends PipelineEntity,
> {
  readonly #overlayIndex: Map<Key, Entry<V>[]>;
  readonly #sourceIndex: SourceHashIndex<Key, V>;

  constructor(sourceIndex: SourceHashIndex<Key, V>) {
    this.#overlayIndex = new Map();
    this.#sourceIndex = sourceIndex;
  }

  add(key: Key, entry: Entry<V>) {
    const mult = entry[1];

    if (mult > 0) {
      // already present in the source
      return;
    }

    let existing = this.#overlayIndex.get(key);
    if (existing === undefined) {
      existing = [];
      this.#overlayIndex.set(key, existing);
    }
    existing.push(entry);
    existing.push([entry[0], -mult]);
  }

  get(key: Key): Iterable<Entry<V>> | undefined {
    const ret = new Map<V, number>();
    const overlayResult = this.#overlayIndex.get(key) ?? [];
    const sourceResult = this.#sourceIndex.get(key) ?? [];
    for (const value of sourceResult) {
      ret.set(value, 1);
    }
    for (const value of overlayResult) {
      const [v, mult] = value;
      ret.set(v, (ret.get(v) ?? 0) + mult);
    }

    if (ret.size === 0) {
      return undefined;
    }

    return ret;
  }

  compact() {
    this.#overlayIndex.clear();
  }
}
