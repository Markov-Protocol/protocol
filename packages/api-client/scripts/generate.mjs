#!/usr/bin/env node
/**
 * Generates `src/generated/openapi.ts` from the committed OpenAPI document
 * (`docs/markov/openapi.json`, exported by the API). `--check` fails when the
 * committed types differ from what the document produces, so the client can
 * never drift from the backend contract silently.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const input = resolve(root, 'docs/markov/openapi.json');
const output = resolve(here, '../src/generated/openapi.ts');
const check = process.argv.includes('--check');

const header = `// Generated from docs/markov/openapi.json by packages/api-client/scripts/generate.mjs.
// Do not edit by hand; run \`pnpm api-client:generate\` after the API contract changes.
`;
const ast = await openapiTS(new URL(`file://${input}`), {
  exportType: true,
  immutable: true,
  rootTypes: true,
  rootTypesNoSchemaPrefix: true,
  defaultNonNullable: true,
});
const generated = `${header}${astToString(ast)}`;

if (check) {
  let current = '';
  try {
    current = readFileSync(output, 'utf8');
  } catch {
    current = '';
  }
  if (current !== generated) {
    console.error(
      'packages/api-client/src/generated/openapi.ts is out of date with docs/markov/openapi.json; run `pnpm api-client:generate`',
    );
    process.exit(1);
  }
  console.log('api-client types are current');
} else {
  writeFileSync(output, generated);
  console.log(`wrote ${output}`);
}
