import { describe, expect, it } from 'vitest';
import { colorTokens, contrastRatio, contrastRequirements, relativeLuminance } from '../src/tokens';

describe('design tokens', () => {
  it('computes WCAG luminance and contrast', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(() => relativeLuminance('#12')).toThrow(TypeError);
  });

  it('meets every documented contrast requirement', () => {
    const failures = contrastRequirements
      .map((requirement) => ({
        ...requirement,
        ratio: contrastRatio(
          colorTokens[requirement.foreground],
          colorTokens[requirement.background],
        ),
      }))
      .filter((entry) => entry.ratio < entry.minimum);
    expect(failures).toEqual([]);
  });
});
