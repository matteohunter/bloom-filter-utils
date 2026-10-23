/**
 * A Bloom filter is a probabilistic set that trades certainty for space.
 * `add` always works; `contains` can report false positives but never false
 * negatives.
 *
 * Implementation notes:
 *  - The bit array is a Uint8Array of bytes, indexed by bit position so we
 *    can set/clear individual bits cheaply without BigInt.
 *  - Hashing uses FNV-1a with a seed per `k` value.  FNV-1a is not
 *    cryptographically strong, but it is fast, has decent distribution for
 *    short inputs, and crucially requires no dependencies.  The per-k seed
 *    is derived by mixing the index into the starting state, which gives
 *    `k` effectively-independent hash values from one algorithm without
 *    allocating an array of seed integers.
 *
 * We deliberately do NOT support removal (no counting Bloom filter).  The
 * README states this plainly; supporting it would roughly double memory and
 * complicate the API, which defeats the purpose.
 */

/**
 * Number of bits in a byte.  Kept as a named constant so the bit-math reads
 * as intent rather than magic.
 */
const BITS_PER_BYTE = 8;

/**
 * FNV-1a offset basis for 32-bit.  This is the standard constant; using it
 * unchanged means our hashes match the well-known FNV-1a(32) output for the
 * unseeded case, which makes the implementation auditable.
 */
const FNV_OFFSET = 0x811c9dc5;

/**
 * FNV-1a 32-bit prime.  See FNV_OFFSET for rationale.
 */
const FNV_PRIME = 0x01000193;

/**
 * Mask to keep a 32-bit product within unsigned range.  Without this the
 * `*` operator can produce values above 2^32 in JS's 64-bit float, which
 * would corrupt the modular reduction when we later take `% m`.
 */
const MASK32 = 0xffffffff;

/**
 * Coerce `n` to a non-negative integer in the range [0, MAX_SAFE_INTEGER],
 * throwing on anything else.
 *
 * Bloom-filter parameters are counts; they must be whole and non-negative.
 * Accepting fractional or negative values here would surface as silently
 * wrong behaviour later (e.g. a fractional `k` truncated to 0 would make the
 * filter useless).  Failing early is friendlier.
 */
function assertNonNegInt(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer, got ${value}`);
  }
}

/**
 * Convert arbitrary bytes to an unsigned integer for hashing.
 *
 * We accept Uint8Array directly and strings (encoded as UTF-8).  This is the
 * entire input domain of the filter; accepting anything else would require a
 * policy for serialisation that the caller can apply more sensibly.
 */
function toBytes(input) {
  if (input instanceof Uint8Array) {
    // Copy so the caller's later mutation can't change what we hashed.
    return input.slice();
  }
  if (typeof input === 'string') {
    // TextEncoder is available in every modern JS runtime and in Node 12+.
    return new TextEncoder().encode(input);
  }
  throw new TypeError('BloomFilter only accepts string or Uint8Array input');
}

/**
 * Seeded FNV-1a over a byte sequence.
 *
 * The seed is mixed into the initial state by XOR before the first multiply,
 * which is enough to give distinct, well-distributed outputs for distinct
 * seeds without needing a separate hash function per `k`.
 */
function fnv1a(bytes, seed) {
  let h = FNV_OFFSET ^ seed;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME) & MASK32;
  }
  // Final avalanche mix to improve avalanche for short inputs; standard FNV-1a
  // does not include one, which can produce clustering for one- and two-byte
  // inputs.  A single extra multiply step is cheap and sufficient.
  h = Math.imul(h, FNV_PRIME) & MASK32;
  return h >>> 0; // force unsigned
}

/**
 * Decide bit count `m` and hash count `k` for a desired false-positive rate.
 *
 * The formulas are the standard optimal Bloom-filter sizing:
 *   m = -(n * ln(p)) / (ln(2)^2)
 *   k = (m/n) * ln(2)
 *
 * We round `m` up to a whole number of bits; `k` is rounded to the nearest
 * integer.  Rounding `k` down (the common suggestion) under-uses the bits
 * we allocated, so we round to nearest to honour the requested `p` more
 * closely.
 */
export function sizeFor(n, p) {
  assertNonNegInt(n, 'n');
  if (!(typeof p === 'number') || p <= 0 || p >= 1) {
    throw new TypeError('p must be a number in (0, 1)');
  }
  if (n === 0) {
    // An empty filter never has false positives, so the smallest valid size
    // is one bit and one hash.  This keeps downstream code free of zero-edges.
    return { m: 1, k: 1 };
  }
  const ln2 = Math.log(2);
  const mFloat = -(n * Math.log(p)) / (ln2 * ln2);
  const m = Math.max(1, Math.ceil(mFloat));
  const kFloat = (m / n) * ln2;
  const k = Math.max(1, Math.round(kFloat));
  return { m, k };
}

export class BloomFilter {
  /**
   * @param {number} n  Expected number of distinct items to be added.
   * @param {number} p  Desired false-positive probability in (0, 1).
   *
   * We size from `n` and `p` rather than letting the caller pass raw `m`/`k`
   * because the sizing math is the single easiest thing to get wrong, and
   * getting it wrong silently produces filters with wildly wrong `p`.
   */
  constructor(n, p) {
    const { m, k } = sizeFor(n, p);
    this.k = k;
    this.m = m;
    this.n = n;
    this.p = p;
    const byteLength = Math.ceil(m / BITS_PER_BYTE);
    // Uint8Array initialises to zero, so every bit is already clear.
    this.bits = new Uint8Array(byteLength);
    this._count = 0;
  }

  /**
   * Record that an item is in the set.
   *
   * Returns `this` so callers can chain adds, which is the only ergonomic
   * reason to return anything; some libraries return `void`, but chaining is
   * common enough in the JS ecosystem to be worth a single `return this`.
   */
  add(input) {
    const bytes = toBytes(input);
    for (let i = 0; i < this.k; i++) {
      const bit = fnv1a(bytes, i) % this.m;
      const byteIndex = (bit / BITS_PER_BYTE) | 0;
      const bitIndex = bit % BITS_PER_BYTE;
      this.bits[byteIndex] |= 1 << bitIndex;
    }
    this._count++;
    return this;
  }

  /**
   * Report whether an item *might* be in the set.
   *
   * A `true` result means "definitely or possibly"; a `false` result means
   * "definitely not".  We return a plain boolean rather than a tri-state
   * because the two-valued contract is what every Bloom-filter consumer
   * actually wants.
   */
  contains(input) {
    const bytes = toBytes(input);
    for (let i = 0; i < this.k; i++) {
      const bit = fnv1a(bytes, i) % this.m;
      const byteIndex = (bit / BITS_PER_BYTE) | 0;
      const bitIndex = bit % BITS_PER_BYTE;
      if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
        return false;
      }
    }
    return true;
  }

  /** Number of items explicitly added.  Useful for diagnostics; not used by `contains`. */
  get count() {
    return this._count;
  }

  /**
   * Approximate fraction of bits set.  Above ~0.5 the false-positive rate
   * degrades sharply; exposing this lets a caller decide when to rebuild a
   * larger filter without recomputing `p` empirically.
   */
  get fillRatio() {
    let set = 0;
    for (let i = 0; i < this.bits.length; i++) {
      let b = this.bits[i];
      // Popcount of a byte: we unroll the standard 5-step SWAR approach.
      // This is faster than a loop over 8 bits on V8 and keeps the hot path
      // branch-light.
      b = (b & 0x55) + ((b >> 1) & 0x55);
      b = (b & 0x33) + ((b >> 2) & 0x33);
      b = (b & 0x0f) + ((b >> 4) & 0x0f);
      set += b;
    }
    return set / this.m;
  }
}
