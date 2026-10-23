# bloom-filter-utils

A small, dependency-free Bloom filter for JavaScript. You tell it how many items you expect and the false-positive rate you can tolerate; it sizes itself, hashes with a seeded FNV-1a, and tells you whether an item *might* be in the set.

## Usage

```js
import { BloomFilter } from 'bloom-filter-utils';

const bf = new BloomFilter(1000, 0.01); // 1000 items, 1% false positives
bf.add('alice@example.com');
bf.add(new Uint8Array([1, 2, 3]));

bf.contains('alice@example.com'); // true
bf.contains('bob@example.com');   // false (or true by chance ~1% of the time)

bf.count;       // 2 — items explicitly added
bf.fillRatio;   // ~0.01 — useful for deciding when to rebuild larger
```

## Why this exists

The problem is set membership at a scale where storing the full set is too expensive, and where a bounded false-positive rate is acceptable — deduplication, bloom-join side tables, "have I probably seen this before" checks. A Bloom filter answers `contains` in O(k) time using a few bits per item, at the cost of never being able to say "definitely yes" and never supporting deletion.

The trade-off taken here: FNV-1a rather than double hashing of a cryptographic primitive. FNV-1a is not cryptographically strong and is not the best-distributed option, but it is short, has no dependencies, and distributes well enough for the filter sizes this library targets (thousands to millions of items). If you need a counting Bloom filter, removal, or cryptographically keyed hashing, this is the wrong library.

## Edge you will hit

The `contains` result is a probability, not a fact. A return of `true` means "possibly in the set"; only `false` is certain. Code that branches on `contains` as if it were exact will be correct for the negative case and wrong about one-in-`1/p` of the positive cases.

This library does not support removal. Adding then "removing" an item would require clearing bits that other items may share, producing false negatives — which a Bloom filter must never do. If you need removal, use a counting Bloom filter (not this one).

Items are hashed as-is: strings are UTF-8 encoded, `Uint8Array` is taken byte-for-byte. There is no normalisation, so `'café'` and `'cafe\u0301'` are different items to the filter. Normalise before adding if your notion of equality requires it.
