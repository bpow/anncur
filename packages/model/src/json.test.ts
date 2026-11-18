import { describe, expect, it } from 'vitest';
import { stableStringify } from './json.js';

describe('stableStringify', () => {
  it('compares JSON independently of object key order without changing the inputs', () => {
    const before = { b: [1, { d: 1, c: 2 }], a: null };
    expect(stableStringify(before)).toBe(stableStringify({ a: null, b: [1, { c: 2, d: 1 }] }));
    expect(Object.keys(before)).toEqual(['b', 'a']);
  });

  it('preserves differences in value types and array order', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: '1' }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});
