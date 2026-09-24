/**
 * Design tokens: the single source of truth for the Markov design system.
 * `pnpm tokens:build` renders src/styles/tokens.css from this file; CI fails
 * when the generated file drifts. Values follow the frontend build prompt's
 * initial token proposal; refinements are recorded in
 * docs/frontend/design-system.md together with measured contrast.
 */

export const colorTokens = {
  frameCream: '#ECEBE6',
  frameLight: '#F6F5F0',
  screen: '#080B10',
  surface: '#121820',
  surfaceRaised: '#19212C',
  text: '#F3F1E9',
  textMuted: '#A8B2C1',
  accent: '#89C9FF',
  accentInk: '#09121D',
  success: '#80D8AE',
  attention: '#F0C77A',
  error: '#FF9C9C',
  border: '#677487',
} as const;
export type ColorToken = keyof typeof colorTokens;

/** Spacing scale in CSS pixels; Tailwind utilities map 1 unit to 4px (p-4 = 16px). */
export const spaceTokens = {
  4: '4px',
  8: '8px',
  12: '12px',
  16: '16px',
  24: '24px',
  32: '32px',
  48: '48px',
} as const;

export const radiusTokens = {
  control: '10px',
  panel: '16px',
  screenDesktop: '32px',
  screenMobile: '20px',
  pill: '999px',
} as const;

/** Font sizes and line heights. Body 16px; supporting 14px; metrics 28 to 40px. */
export const typeTokens = {
  caption: { size: '12px', lineHeight: '16px' },
  supporting: { size: '14px', lineHeight: '20px' },
  body: { size: '16px', lineHeight: '24px' },
  headingSm: { size: '20px', lineHeight: '28px' },
  headingMd: { size: '24px', lineHeight: '32px' },
  headingLg: { size: '28px', lineHeight: '36px' },
  metricSm: { size: '28px', lineHeight: '34px' },
  metricLg: { size: '40px', lineHeight: '46px' },
} as const;

export const motionTokens = {
  fast: '120ms',
  base: '180ms',
  slow: '220ms',
  ease: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/** Stacking layers shared by the shell and overlays. */
export const layerTokens = {
  base: 0,
  dock: 10,
  nav: 20,
  overlay: 30,
  dialog: 40,
  toast: 50,
} as const;

/** Mark I perimeter and screen geometry starting values (see mark-i-shell.md). */
export const frameTokens = {
  perimeterDesktop: '16px',
  perimeterPhone: '6px',
  minTouchTarget: '44px',
} as const;

/**
 * Colour pairs that must meet WCAG 2.2 contrast. `minimum` is the required
 * ratio: 4.5 for ordinary text, 3 for large text and essential non-text UI.
 */
export const contrastRequirements: ReadonlyArray<{
  readonly foreground: ColorToken;
  readonly background: ColorToken;
  readonly minimum: number;
  readonly use: string;
}> = [
  { foreground: 'text', background: 'screen', minimum: 4.5, use: 'body text on the screen' },
  { foreground: 'text', background: 'surface', minimum: 4.5, use: 'body text on panels' },
  {
    foreground: 'text',
    background: 'surfaceRaised',
    minimum: 4.5,
    use: 'body text on dialogs and menus',
  },
  {
    foreground: 'textMuted',
    background: 'surface',
    minimum: 4.5,
    use: 'supporting labels and timestamps',
  },
  {
    foreground: 'textMuted',
    background: 'surfaceRaised',
    minimum: 4.5,
    use: 'supporting labels in dialogs',
  },
  {
    foreground: 'accentInk',
    background: 'accent',
    minimum: 4.5,
    use: 'text on filled accent buttons',
  },
  { foreground: 'accent', background: 'surface', minimum: 4.5, use: 'links and active labels' },
  { foreground: 'success', background: 'surface', minimum: 4.5, use: 'success status text' },
  { foreground: 'attention', background: 'surface', minimum: 4.5, use: 'attention status text' },
  { foreground: 'error', background: 'surface', minimum: 4.5, use: 'error status text' },
  { foreground: 'border', background: 'surface', minimum: 3, use: 'control boundaries (non-text)' },
  { foreground: 'accent', background: 'screen', minimum: 3, use: 'focus ring against the screen' },
  { foreground: 'accent', background: 'surface', minimum: 3, use: 'focus ring against panels' },
  {
    foreground: 'accentInk',
    background: 'frameCream',
    minimum: 4.5,
    use: 'wordmark on the cream frame',
  },
];

function channel(hex: string, offset: number): number {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance per WCAG 2.x for a #RRGGBB colour. */
export function relativeLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
    throw new TypeError(`expected #RRGGBB, received ${hex}`);
  }
  return 0.2126 * channel(clean, 0) + 0.7152 * channel(clean, 2) + 0.0722 * channel(clean, 4);
}

/** WCAG contrast ratio between two #RRGGBB colours, rounded to two decimals. */
export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [light, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100;
}
