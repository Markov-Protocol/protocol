#!/usr/bin/env node
/**
 * Check every commit in a git range against the commit policy.
 * Usage: node tooling/commit-policy/check-range.mjs <base>..<head>
 * CI passes the pull request base and head; the default checks commits not
 * on origin/main.
 */
import { execFileSync } from 'node:child_process';
import { checkCommitMessage } from './policy.mjs';

const range = process.argv[2] ?? 'origin/main..HEAD';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

let hashes;
try {
  hashes = git(['rev-list', '--reverse', range])
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
} catch (error) {
  process.stderr.write(`could not read git range ${range}: ${error.message}\n`);
  process.exit(2);
}

let failures = 0;
for (const hash of hashes) {
  const message = git(['log', '-1', '--format=%B', hash]);
  const result = checkCommitMessage(message);
  if (!result.ok) {
    failures += 1;
    process.stderr.write(`${hash.slice(0, 12)} "${result.header}"\n`);
    for (const problem of result.problems) {
      process.stderr.write(`  - ${problem}\n`);
    }
  }
}
process.stdout.write(`checked ${hashes.length} commit(s) in ${range}: ${failures} violation(s)\n`);
process.exit(failures === 0 ? 0 : 1);
