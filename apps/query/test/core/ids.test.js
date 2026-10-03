import { describe, expect, it } from 'vitest';
import { byNumber, sortIds } from '../../src/core/ids.js';

describe('ids', () => {
  it('orders id strings by number', () => {
    expect(['10', '9', '100'].sort(byNumber)).toEqual(['9', '10', '100']);
  });
  it('drops duplicates and turns numbers into strings', () => {
    expect(sortIds([3, '1', '3', 2])).toEqual(['1', '2', '3']);
    expect(sortIds(new Set(['20', '3']))).toEqual(['3', '20']);
  });
});
