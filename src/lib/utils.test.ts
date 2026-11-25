import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

describe('cn', () => {
  it('joins class names and skips falsy ones', () => {
    expect(cn('a', false && 'b', 'c')).toBe('a c');
  });
});
