import { describe, expect, it } from 'vitest';
import { cn } from '../src/cn';

describe('cn', () => {
  it('keeps a token colour utility next to a token size utility', () => {
    expect(cn('text-accent-ink', 'text-body')).toBe('text-accent-ink text-body');
    expect(cn('text-body', 'text-supporting')).toBe('text-supporting');
    expect(cn('text-text', 'text-accent')).toBe('text-accent');
  });

  it('resolves ordinary conflicts', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2');
    expect(cn('bg-accent', undefined, false, 'bg-error')).toBe('bg-error');
  });
});
