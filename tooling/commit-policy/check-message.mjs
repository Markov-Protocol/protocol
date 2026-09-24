#!/usr/bin/env node
/**
 * Usage: node tooling/commit-policy/check-message.mjs <path-to-message-file>
 *        echo "message" | node tooling/commit-policy/check-message.mjs -
 */
import { readFileSync } from 'node:fs';
import { checkCommitMessage } from './policy.mjs';

const [target] = process.argv.slice(2);
if (!target) {
  process.stderr.write('usage: check-message.mjs <file|->\n');
  process.exit(64);
}
const message = target === '-' ? readFileSync(0, 'utf8') : readFileSync(target, 'utf8');
const result = checkCommitMessage(message);
if (!result.ok) {
  process.stderr.write('commit message rejected by repository policy:\n');
  for (const problem of result.problems) {
    process.stderr.write(`  - ${problem}\n`);
  }
  process.stderr.write('see AGENTS.md (Git and documentation contract)\n');
  process.exit(1);
}
