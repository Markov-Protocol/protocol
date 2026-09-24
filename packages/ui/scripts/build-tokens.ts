/**
 * Render src/styles/tokens.css from src/tokens.ts.
 *   tsx scripts/build-tokens.ts          writes the file
 *   tsx scripts/build-tokens.ts --check  exits 1 when the committed file differs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  colorTokens,
  frameTokens,
  layerTokens,
  motionTokens,
  radiusTokens,
  spaceTokens,
  typeTokens,
} from '../src/tokens';

const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const lines: string[] = [
  '/* GENERATED from packages/ui/src/tokens.ts by `pnpm tokens:build`. Do not edit by hand. */',
  '',
  ':root {',
];
for (const [name, value] of Object.entries(colorTokens)) {
  lines.push(`  --markov-color-${kebab(name)}: ${value};`);
}
for (const [name, value] of Object.entries(spaceTokens)) {
  lines.push(`  --markov-space-${name}: ${value};`);
}
for (const [name, value] of Object.entries(radiusTokens)) {
  lines.push(`  --markov-radius-${kebab(name)}: ${value};`);
}
for (const [name, value] of Object.entries(typeTokens)) {
  lines.push(`  --markov-text-${kebab(name)}: ${value.size};`);
  lines.push(`  --markov-text-${kebab(name)}--line-height: ${value.lineHeight};`);
}
for (const [name, value] of Object.entries(motionTokens)) {
  lines.push(`  --markov-motion-${kebab(name)}: ${value};`);
}
for (const [name, value] of Object.entries(layerTokens)) {
  lines.push(`  --markov-layer-${kebab(name)}: ${value};`);
}
for (const [name, value] of Object.entries(frameTokens)) {
  lines.push(`  --markov-frame-${kebab(name)}: ${value};`);
}
lines.push(
  '}',
  '',
  '/* Tailwind theme mapping: utilities such as bg-surface, text-text-muted, rounded-control, text-body. */',
  '@theme inline {',
);
lines.push('  --color-*: initial;');
for (const name of Object.keys(colorTokens)) {
  lines.push(`  --color-${kebab(name)}: var(--markov-color-${kebab(name)});`);
}
lines.push('  --color-transparent: transparent;', '  --color-current: currentColor;');
lines.push('  --radius-*: initial;');
for (const name of Object.keys(radiusTokens)) {
  lines.push(`  --radius-${kebab(name)}: var(--markov-radius-${kebab(name)});`);
}
lines.push('  --text-*: initial;');
for (const name of Object.keys(typeTokens)) {
  lines.push(`  --text-${kebab(name)}: var(--markov-text-${kebab(name)});`);
  lines.push(
    `  --text-${kebab(name)}--line-height: var(--markov-text-${kebab(name)}--line-height);`,
  );
}
lines.push('  --font-sans: var(--font-inter), "Inter", system-ui, sans-serif;');
lines.push(
  '  --font-mono: ui-monospace, "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace;',
);
for (const [name, value] of Object.entries(motionTokens)) {
  if (name !== 'ease') {
    lines.push(`  --duration-${name}: ${value};`);
  }
}
lines.push('  --ease-markov: var(--markov-motion-ease);');
lines.push('}', '');
const output = `${lines.join('\n')}`;

const target = fileURLToPath(new URL('../src/styles/tokens.css', import.meta.url));
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = '';
  }
  if (current !== output) {
    process.stderr.write(
      'tokens drift: packages/ui/src/styles/tokens.css differs from src/tokens.ts; run `pnpm tokens:build`\n',
    );
    process.exit(1);
  }
  process.stdout.write('tokens.css is current\n');
} else {
  writeFileSync(target, output);
  process.stdout.write(`wrote ${target}\n`);
}
