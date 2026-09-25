#!/usr/bin/env node
/**
 * Content digest of a build output directory, for CI build evidence.
 *
 *   node tooling/release/digest.mjs <dir> [--label <name>]
 *
 * Prints JSON: the file count, total bytes, and one SHA-256 over the sorted
 * list of "relative path, NUL, file SHA-256" lines, so two builds with the
 * same content have the same digest regardless of file timestamps. A digest
 * identifies what was built; it says nothing about whether it is safe to run.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

export function digestDirectory(dir) {
  const lines = [];
  let bytes = 0;
  for (const file of walk(dir)) {
    const content = readFileSync(file);
    bytes += content.length;
    const rel = relative(dir, file).split(sep).join('/');
    lines.push(`${rel}\u0000${createHash('sha256').update(content).digest('hex')}\n`);
  }
  lines.sort();
  const aggregate = createHash('sha256');
  for (const line of lines) {
    aggregate.update(line);
  }
  return { files: lines.length, bytes, sha256: aggregate.digest('hex') };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const dir = args[0];
  const labelIndex = args.indexOf('--label');
  if (!dir || !statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    process.stderr.write('usage: node tooling/release/digest.mjs <dir> [--label <name>]\n');
    process.exit(2);
  }
  const result = {
    label: labelIndex >= 0 ? args[labelIndex + 1] : dir,
    directory: dir,
    ...digestDirectory(dir),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
