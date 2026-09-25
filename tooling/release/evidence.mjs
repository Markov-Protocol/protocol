#!/usr/bin/env node
/**
 * Assemble the evidence record of one CI run for one commit.
 *
 *   node tooling/release/evidence.mjs --dir <downloaded artifacts> --out <dir> [--jobs <json>]
 *
 * <dir> holds one sub-directory per uploaded artifact (actions/download-artifact
 * without merge). The record lists every file with its size and SHA-256, the
 * result of every job, the commit and tree the run built, the run URL and the
 * digest of the reviewed release status manifest. It describes what the run
 * observed; it grants no capability and does not authorize a release. Outside
 * GitHub Actions the run fields are null and the conclusion says so, so a
 * local assembly can never pass for CI evidence.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVIDENCE_NOTICE =
  'Describes what one CI run observed for one commit. It grants no capability and does not authorize a release: runtime configuration, capability readiness records and the release gates decide what may run.';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

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
  return files.sort();
}

/** Every file under dir grouped by its top-level directory (the artifact name). */
export function inventory(dir) {
  const artifacts = new Map();
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split(sep).join('/');
    const [artifact, ...rest] = rel.split('/');
    const path = rest.join('/');
    if (!artifacts.has(artifact)) {
      artifacts.set(artifact, { name: artifact, files: [], redacted: false });
    }
    const entry = artifacts.get(artifact);
    if (path === 'redaction.json') {
      entry.redacted = true;
    }
    const bytes = readFileSync(file);
    entry.files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  return [...artifacts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Job results from the `needs` context: success only when every job succeeded. */
export function conclude(jobs, isCi) {
  if (!isCi) {
    return 'local-assembly-not-ci-evidence';
  }
  if (jobs.length === 0) {
    return 'incomplete';
  }
  if (jobs.every((job) => job.result === 'success')) {
    return 'success';
  }
  if (jobs.some((job) => job.result === 'failure')) {
    return 'failure';
  }
  return 'incomplete';
}

export function parseJobs(json) {
  if (!json) {
    return [];
  }
  const needs = JSON.parse(json);
  return Object.entries(needs)
    .map(([name, value]) => ({ name, result: String(value?.result ?? 'unknown') }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

export function buildRecord({ dir, jobs, env, root }) {
  const isCi = env.GITHUB_ACTIONS === 'true' && Boolean(env.GITHUB_RUN_ID);
  const commit = env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']);
  const statusPath = join(root, 'docs/markov/release-status.json');
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  return {
    schemaVersion: 1,
    kind: 'markov-ci-evidence',
    notice: EVIDENCE_NOTICE,
    candidate: {
      repository: env.GITHUB_REPOSITORY ?? null,
      // On pull_request runs GITHUB_SHA is the temporary merge commit; headCommit is the branch head.
      commit,
      headCommit: env.MARKOV_CI_HEAD_SHA ?? commit,
      tree: commit ? git(['rev-parse', `${commit}^{tree}`]) : null,
      ref: env.GITHUB_REF ?? null,
      event: env.GITHUB_EVENT_NAME ?? null,
      workflowRef: env.GITHUB_WORKFLOW_REF ?? null,
    },
    run: isCi
      ? {
          id: env.GITHUB_RUN_ID,
          attempt: env.GITHUB_RUN_ATTEMPT ?? null,
          url: `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
        }
      : null,
    conclusion: conclude(jobs, isCi),
    jobs,
    releaseStatus: existsSync(statusPath)
      ? { path: 'docs/markov/release-status.json', sha256: sha256(readFileSync(statusPath)) }
      : null,
    artifacts: existsSync(dir) ? inventory(dir) : [],
  };
}

export function summaryMarkdown(record) {
  const lines = [
    '## Candidate evidence',
    '',
    `Built commit \`${record.candidate.commit ?? 'unknown'}\` (tree \`${record.candidate.tree ?? 'unknown'}\`), branch head \`${record.candidate.headCommit ?? 'unknown'}\`, conclusion **${record.conclusion}**.`,
    '',
    '| Job | Result |',
    '| --- | ------ |',
    ...record.jobs.map((job) => `| ${job.name} | ${job.result} |`),
    '',
    '| Artifact | Files | Redaction pass |',
    '| -------- | ----- | -------------- |',
    ...record.artifacts.map(
      (artifact) =>
        `| ${artifact.name} | ${artifact.files.length} | ${artifact.redacted ? 'yes' : 'no'} |`,
    ),
    '',
    record.notice,
    '',
  ];
  return lines.join('\n');
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const dir = argValue(args, '--dir');
  const out = argValue(args, '--out');
  if (!dir || !out) {
    process.stderr.write(
      'usage: node tooling/release/evidence.mjs --dir <artifacts> --out <dir> [--jobs <json>]\n',
    );
    process.exit(2);
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    process.stderr.write(`evidence: ${dir} is not a directory\n`);
    process.exit(2);
  }
  const root = git(['rev-parse', '--show-toplevel']) ?? process.cwd();
  const jobs = parseJobs(argValue(args, '--jobs') ?? process.env.MARKOV_CI_NEEDS);
  const record = buildRecord({ dir, jobs, env: process.env, root });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'ci-evidence.json'), `${JSON.stringify(record, null, 2)}\n`);
  const summary = summaryMarkdown(record);
  writeFileSync(join(out, 'SUMMARY.md'), summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  }
  process.stdout.write(
    `evidence: ${record.artifacts.length} artifact(s), ${record.artifacts.reduce((n, a) => n + a.files.length, 0)} file(s), conclusion ${record.conclusion}\n`,
  );
}
