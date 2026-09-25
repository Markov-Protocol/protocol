#!/usr/bin/env node
/**
 * Generates the CLI reference (docs/cli/**) by walking the real command
 * tree of `markov` (apps/cli, built to dist). Every command, argument,
 * option and default comes from the program definition, so the reference
 * cannot drift from what the binary accepts.
 *
 *   pnpm build && node apps/docs/scripts/generate-cli-reference.mjs
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { linksFor, readBuildSource } from './source-metadata.mjs';

const here = dirname(new URL(import.meta.url).pathname);
const root = resolve(here, '..', '..', '..');
const out = resolve(here, '..', 'docs', 'cli');
const source = readBuildSource(root);
const links = linksFor(source);
const GENERATOR = 'apps/docs/scripts/generate-cli-reference.mjs';
const INPUT = 'apps/cli/src/program.ts';
/** Where a generated page came from: the input and the generator, pinned to the build's commit when known. */
const provenance = `[\`${INPUT}\`](${links.blob(INPUT)}) by [\`${GENERATOR}\`](${links.blob(GENERATOR)})${
  source.commit
    ? ` at commit [\`${source.commit.slice(0, 12)}\`](${links.commit()})`
    : ' (this build has no verified source revision; the links open the maintained branch)'
}`;
const dist = join(root, 'apps', 'cli', 'dist', 'index.js');
if (!existsSync(dist)) {
  throw new Error('apps/cli/dist/index.js is missing; run `pnpm build` first');
}
const { buildProgram } = await import(pathToFileURL(dist).href);
const program = buildProgram({ out: () => {}, err: () => {} });

function escapeCell(text) {
  return String(text ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n+/g, ' ')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

function code(text) {
  return `\`${String(text)}\``;
}

function argumentsOf(command) {
  return command.registeredArguments ?? command._args ?? [];
}

function usageOf(command, trail) {
  const args = argumentsOf(command)
    .map((argument) => (argument.required ? `<${argument.name()}>` : `[${argument.name()}]`))
    .join(' ');
  return [...trail, command.name(), args].filter(Boolean).join(' ');
}

function renderCommand(command, trail, lines, level) {
  const usage = usageOf(command, trail);
  lines.push(`${'#'.repeat(Math.min(level, 6))} ${code(usage)}`, '');
  if (command.description()) {
    lines.push(command.description(), '');
  }
  const args = argumentsOf(command);
  if (args.length > 0) {
    lines.push('| Argument | Required | Description |', '| --- | --- | --- |');
    for (const argument of args) {
      lines.push(
        `| ${code(argument.name())} | ${argument.required ? 'yes' : 'no'} | ${escapeCell(argument.description ?? '')} |`,
      );
    }
    lines.push('');
  }
  const options = command.options ?? [];
  if (options.length > 0) {
    lines.push('| Option | Description | Default |', '| --- | --- | --- |');
    for (const option of options) {
      const required = option.mandatory ? ' (required)' : '';
      const fallback =
        option.defaultValue === undefined ? '' : code(JSON.stringify(option.defaultValue));
      lines.push(
        `| ${code(option.flags)}${required} | ${escapeCell(option.description ?? '')} | ${fallback} |`,
      );
    }
    lines.push('');
  }
  for (const child of command.commands ?? []) {
    renderCommand(child, [...trail, command.name()], lines, level + 1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const groups = program.commands;
const rows = [];
groups.forEach((command, index) => {
  const name = command.name();
  const subcommands = command.commands ?? [];
  rows.push(
    `| [${code(`markov ${name}`)}](./${name}.md) | ${escapeCell(command.description() ?? '')} | ${subcommands.length} |`,
  );
  const lines = [
    '---',
    `title: ${JSON.stringify(`markov ${name}`)}`,
    `sidebar_label: ${JSON.stringify(name)}`,
    `sidebar_position: ${index + 1}`,
    `description: ${JSON.stringify(command.description() ?? `The markov ${name} commands`)}`,
    '---',
    '',
    `:::info Generated\nGenerated from the command tree in ${provenance} (\`pnpm build\` then \`node apps/docs/scripts/generate-cli-reference.mjs\`). Run commands with \`pnpm markov …\` or \`node apps/cli/dist/main.js …\`.\n:::`,
    '',
  ];
  renderCommand(command, ['markov'], lines, 2);
  writeFileSync(join(out, `${name}.md`), `${lines.join('\n')}\n`);
});

const rootOptions = (program.options ?? []).map(
  (option) => `| ${code(option.flags)} | ${escapeCell(option.description ?? '')} |`,
);
const index = [
  '---',
  'title: "CLI reference"',
  'sidebar_label: "Overview"',
  'sidebar_position: 0',
  `description: "The markov command line: ${groups.length} command groups generated from the program definition."`,
  '---',
  '',
  `:::info Generated\nGenerated from ${provenance}. The [CLI guide](../guides/cli.md) walks through the flows the startup check verifies.\n:::`,
  '',
  '```bash',
  'pnpm build                      # builds apps/cli/dist',
  'pnpm markov --help              # or: node apps/cli/dist/main.js --help',
  '```',
  '',
  'Exit codes: 0 ok; 1 not ready or a failed verification; 64 usage; 69 unavailable; 78 configuration (see [operations](../reference/markov/operations.md)). Database commands read `DATABASE_URL` and the runtime mode from the environment; API commands take `--url` and a bearer `--token`.',
  '',
  ...(rootOptions.length > 0
    ? ['| Global option | Description |', '| --- | --- |', ...rootOptions, '']
    : []),
  '| Group | Description | Commands |',
  '| --- | --- | --- |',
  ...rows,
  '',
];
writeFileSync(join(out, 'index.md'), `${index.join('\n')}\n`);
process.stdout.write(`generate-cli-reference: ${groups.length} command groups\n`);
