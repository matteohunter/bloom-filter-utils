import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BloomFilter } from '../src/index.js';

describe('BloomFilter', () => {
  describe('construction', () => {
    it('sizes the bit array from n and p', () => {
      const bf = new BloomFilter(1000, 0.01);
      assert.equal(bf.n, 1000);
      assert.equal(bf.p, 0.01);
      assert.equal(bf.k, 7);
      assert.equal(bf.m, 9586);
      assert.equal(bf.bits.byteLength, Math.ceil(9586 / 8));
    });

    it('throws on non-integer n', () => {
      assert.throws(() => new BloomFilter(10.5, 0.01), /non-negative integer/);
    });

    it('throws on negative n', () => {
      assert.throws(() => new BloomFilter(-1, 0.01), /non-negative integer/);
    });

    it('throws on p out of range', () => {
      assert.throws(() => new BloomFilter(100, 0), /p must be/);
      assert.throws(() => new BloomFilter(100, 1), /p must be/);
      assert.throws(() => new BloomFilter(100, 1.5), /p must be/);
    });

    it('handles n = 0 without producing a zero-sized array', () => {
      const bf = new BloomFilter(0, 0.01);
      assert.equal(bf.m, 1);
      assert.equal(bf.k, 1);
      assert.equal(bf.bits.byteLength, 1);
    });
  });

  describe('add and contains', () => {
    it('returns true for items that were added (no false negatives)', () => {
      const bf = new BloomFilter(100, 0.01);
      const items = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
      for (const x of items) bf.add(x);
      for (const x of items) {
        assert.equal(bf.contains(x), true);
      }
    });

    it('returns false for items that were not added', () => {
      const bf = new BloomFilter(100, 0.01);
      bf.add('present');
      assert.equal(bf.contains('absent'), false);
    });

    it('accepts Uint8Array input', () => {
      const bf = new BloomFilter(100, 0.01);
      const bytes = new Uint8Array([1, 2, 3, 4]);
      bf.add(bytes);
      assert.equal(bf.contains(bytes), true);
      // A different byte sequence should not collide by construction here.
      assert.equal(bf.contains(new Uint8Array([1, 2, 3, 5])), false);
    });

    it('rejects unsupported input types', () => {
      const bf = new BloomFilter(100, 0.01);
      assert.throws(() => bf.add(42), /string or Uint8Array/);
      assert.throws(() => bf.contains({}), /string or Uint8Array/);
      assert.throws(() => bf.add(null), /string or Uint8Array/);
    });

    it('add returns this for chaining', () => {
      const bf = new BloomFilter(100, 0.01);
      const ret = bf.add('x');
      assert.equal(ret, bf);
    });

    it('distinguishes between distinct small inputs (no trivial collisions)', () => {
      // Single-byte inputs are the worst case for weak hashers; this pins
      // the fact that our final mix step prevents short-input clustering.
      const bf = new BloomFilter(1000, 0.001);
      bf.add('a');
      for (const ch of ['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
        assert.equal(bf.contains(ch), false, `false positive on ${ch}`);
      }
    });
  });

  describe('count and fillRatio', () => {
    it('tracks the number of added items', () => {
      const bf = new BloomFilter(100, 0.01);
      assert.equal(bf.count, 0);
      bf.add('a');
      bf.add('b');
      assert.equal(bf.count, 2);
    });

    it('reports a fill ratio between 0 and 1', () => {
      const bf = new BloomFilter(100, 0.01);
      assert.equal(bf.fillRatio, 0);
      bf.add('a');
      const r = bf.fillRatio;
      assert.ok(r > 0 && r < 1, `expected 0 < r < 1, got ${r}`);
    });
  });
});
