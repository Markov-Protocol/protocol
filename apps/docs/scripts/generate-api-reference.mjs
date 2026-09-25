#!/usr/bin/env node
/**
 * Generates the API reference (docs/api/**) from docs/markov/openapi.json,
 * the document the API exports and CI checks for drift. One page per tag,
 * every operation with its parameters, request body and responses; an
 * index with every route. Nothing is hand-written here, so the reference
 * cannot disagree with the running API.
 *
 *   node apps/docs/scripts/generate-api-reference.mjs
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const here = dirname(new URL(import.meta.url).pathname);
const root = resolve(here, '..', '..', '..');
const out = resolve(here, '..', 'docs', 'api');
const document = JSON.parse(readFileSync(join(root, 'docs', 'markov', 'openapi.json'), 'utf8'));
const REPOSITORY = 'https://github.com/Markov-Protocol/protocol';
const MAX_DEPTH = 3;
const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];

function escapeCell(text) {
  return String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .trim();
}

function code(text) {
  return `\`${String(text).replace(/`/g, '')}\``;
}

function typeLabel(schema) {
  if (!schema || typeof schema !== 'object') {
    return 'any';
  }
  if (schema.$ref) {
    return schema.$ref.split('/').pop();
  }
  if (schema.const !== undefined) {
    return code(JSON.stringify(schema.const));
  }
  if (schema.enum) {
    const values = schema.enum.map((value) => code(JSON.stringify(value)));
    return values.length > 8
      ? `${values.slice(0, 8).join(' \\| ')} … (${values.length} values)`
      : values.join(' \\| ');
  }
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    return variants.map((variant) => typeLabel(variant)).join(' \\| ');
  }
  if (schema.allOf) {
    return schema.allOf.map((variant) => typeLabel(variant)).join(' & ');
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const base = types
    .map((type) => {
      if (type === 'array') {
        return `array of ${typeLabel(schema.items)}`;
      }
      if (type === 'string' && schema.format) {
        return `string (${schema.format})`;
      }
      return type;
    })
    .join(' \\| ');
  return base || (schema.properties ? 'object' : 'any');
}

function constraints(schema) {
  const notes = [];
  if (!schema || typeof schema !== 'object') {
    return notes;
  }
  if (schema.description) {
    notes.push(schema.description);
  }
  if (schema.default !== undefined) {
    notes.push(`default ${code(JSON.stringify(schema.default))}`);
  }
  for (const key of [
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
  ]) {
    if (schema[key] !== undefined) {
      notes.push(`${key} ${schema[key]}`);
    }
  }
  return notes;
}

function objectSchemaOf(schema) {
  if (!schema || typeof schema !== 'object') {
    return null;
  }
  if (schema.properties) {
    return schema;
  }
  if (Array.isArray(schema.type) ? schema.type.includes('object') : schema.type === 'object') {
    return schema.properties ? schema : null;
  }
  return null;
}

/** Renders a schema as tables: the object's fields, then each nested object or array of objects, depth-limited. */
function renderSchema(schema, depth, lines, label) {
  const object = objectSchemaOf(schema);
  const variants = schema?.anyOf ?? schema?.oneOf;
  if (!object && variants && depth <= MAX_DEPTH) {
    variants.forEach((variant, index) => {
      lines.push(
        `${'#'.repeat(Math.min(6, depth + 4))} ${label} · variant ${index + 1}: ${typeLabel(variant)}`,
        '',
      );
      renderSchema(variant, depth + 1, lines, `${label} variant ${index + 1}`);
    });
    return;
  }
  if (!object) {
    const items = schema?.items;
    if (items && objectSchemaOf(items) && depth <= MAX_DEPTH) {
      lines.push(`Array of objects:`, '');
      renderSchema(items, depth + 1, lines, `${label} items`);
      return;
    }
    lines.push(`Type: ${typeLabel(schema)}`, '');
    return;
  }
  const required = new Set(object.required ?? []);
  lines.push('| Field | Type | Required | Notes |', '| --- | --- | --- | --- |');
  const nested = [];
  for (const [name, property] of Object.entries(object.properties)) {
    lines.push(
      `| ${code(name)} | ${escapeCell(typeLabel(property))} | ${required.has(name) ? 'yes' : 'no'} | ${escapeCell(constraints(property).join('; '))} |`,
    );
    const child = objectSchemaOf(property) ?? objectSchemaOf(property?.items);
    const childVariants = (property?.anyOf ?? property?.oneOf ?? []).filter((variant) =>
      objectSchemaOf(variant),
    );
    if ((child || childVariants.length > 0) && depth < MAX_DEPTH) {
      nested.push([name, property]);
    }
  }
  lines.push('');
  for (const [name, property] of nested) {
    const isArray = !objectSchemaOf(property) && objectSchemaOf(property?.items);
    lines.push(
      `${'#'.repeat(Math.min(6, depth + 4))} ${label ? `${label}.` : ''}${name}${isArray ? '[]' : ''}`,
      '',
    );
    renderSchema(
      isArray ? property.items : property,
      depth + 1,
      lines,
      `${label ? `${label}.` : ''}${name}`,
    );
  }
}

const tags = new Map();
const tagInfo = new Map((document.tags ?? []).map((tag) => [tag.name, tag.description ?? '']));
for (const [path, operations] of Object.entries(document.paths)) {
  for (const method of METHOD_ORDER) {
    const operation = operations[method];
    if (!operation) {
      continue;
    }
    const tag = operation.tags?.[0] ?? 'untagged';
    if (!tags.has(tag)) {
      tags.set(tag, []);
    }
    tags.get(tag).push({ path, method, operation });
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const orderedTags = [
  ...(document.tags ?? []).map((tag) => tag.name),
  ...[...tags.keys()].filter((tag) => !tagInfo.has(tag)),
].filter((tag) => tags.has(tag));
let position = 1;
const indexRows = [];
for (const tag of orderedTags) {
  const operations = tags.get(tag);
  const lines = [
    '---',
    `title: ${JSON.stringify(`${tag[0].toUpperCase()}${tag.slice(1)} routes`)}`,
    `sidebar_label: ${JSON.stringify(tag)}`,
    `sidebar_position: ${position}`,
    `description: ${JSON.stringify(tagInfo.get(tag) || `Routes tagged ${tag}`)}`,
    '---',
    '',
    `:::info Generated\nThis page is generated from [\`docs/markov/openapi.json\`](${REPOSITORY}/blob/main/docs/markov/openapi.json), the document the API exports (\`pnpm openapi:generate\`) and CI checks for drift. Authentication, principals, scopes and rate limits are described in [the API conventions](../guides/api.md).\n:::`,
    '',
  ];
  if (tagInfo.get(tag)) {
    lines.push(tagInfo.get(tag), '');
  }
  lines.push('| Method | Path | Summary |', '| --- | --- | --- |');
  for (const { path, method, operation } of operations) {
    lines.push(
      `| ${method.toUpperCase()} | ${code(path)} | ${escapeCell(operation.summary ?? '')} |`,
    );
    indexRows.push(
      `| ${method.toUpperCase()} | ${code(path)} | ${escapeCell(operation.summary ?? '')} | [${tag}](./${tag}.md) |`,
    );
  }
  lines.push('');
  for (const { path, method, operation } of operations) {
    lines.push(`## ${method.toUpperCase()} ${path}`, '');
    if (operation.summary) {
      lines.push(`**${operation.summary}**`, '');
    }
    if (operation.description) {
      lines.push(operation.description, '');
    }
    if (operation.deprecated) {
      lines.push(':::caution Deprecated\nThis route is deprecated.\n:::', '');
    }
    const parameters = operation.parameters ?? [];
    if (parameters.length > 0) {
      lines.push(
        '### Parameters',
        '',
        '| Name | In | Type | Required | Notes |',
        '| --- | --- | --- | --- | --- |',
      );
      for (const parameter of parameters) {
        lines.push(
          `| ${code(parameter.name)} | ${parameter.in} | ${escapeCell(typeLabel(parameter.schema))} | ${parameter.required ? 'yes' : 'no'} | ${escapeCell([parameter.description, ...constraints(parameter.schema)].filter(Boolean).join('; '))} |`,
        );
      }
      lines.push('');
    }
    const body = operation.requestBody?.content?.['application/json']?.schema;
    if (body) {
      lines.push('### Request body', '');
      renderSchema(body, 0, lines, '');
    }
    lines.push('### Responses', '');
    for (const [status, response] of Object.entries(operation.responses ?? {})) {
      const schema = response.content?.['application/json']?.schema;
      const isSuccess = status.startsWith('2');
      lines.push(`#### ${status} ${isSuccess ? '' : '(error envelope)'}`.trim(), '');
      if (response.description && response.description !== 'Default Response') {
        lines.push(response.description, '');
      }
      if (schema && isSuccess) {
        renderSchema(schema, 0, lines, '');
      } else if (schema) {
        lines.push(`Type: ${typeLabel(schema)} — see [errors](../guides/api.md#errors).`, '');
      }
    }
  }
  writeFileSync(join(out, `${tag}.md`), `${lines.join('\n')}\n`);
  position += 1;
}

const index = [
  '---',
  'title: "API reference"',
  'sidebar_label: "Overview"',
  'sidebar_position: 0',
  `description: "Every route of the Markov API (${indexRows.length} operations), generated from the OpenAPI document the API exports."`,
  '---',
  '',
  `:::info Generated\nGenerated from [\`docs/markov/openapi.json\`](${REPOSITORY}/blob/main/docs/markov/openapi.json) (OpenAPI ${document.openapi}, ${document.info?.title ?? 'Markov API'} ${document.info?.version ?? ''}). Run \`pnpm openapi:generate\` after changing a route; CI fails on drift.\n:::`,
  '',
  'The API is a Fastify service with zod-validated routes. Read [the conventions](../guides/api.md) first: bearer principals (users, agents, devices, operators), scopes, the error envelope, idempotency and rate limits. Routes are grouped by tag below; each tag page lists every operation with its parameters, request body and responses.',
  '',
  '| Method | Path | Summary | Tag |',
  '| --- | --- | --- | --- |',
  ...indexRows,
  '',
];
writeFileSync(join(out, 'index.md'), `${index.join('\n')}\n`);
process.stdout.write(
  `generate-api-reference: ${indexRows.length} operations in ${orderedTags.length} tag pages\n`,
);
