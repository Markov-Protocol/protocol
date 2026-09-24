import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import { colorTokens, typeTokens } from './tokens';

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/**
 * tailwind-merge must know which custom `text-*` utilities are font sizes
 * and which are colours; otherwise `text-body` (size) would silently discard
 * `text-accent-ink` (colour) and break button contrast.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: Object.keys(typeTokens).map(kebab) }],
      'text-color': [{ text: Object.keys(colorTokens).map(kebab) }],
    },
  },
});

/** Merge Tailwind classes with conflict resolution aware of the Markov tokens. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
