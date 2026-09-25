/**
 * Where the published documentation came from, and the links back to it.
 *
 * Source evidence links point at an immutable commit; edit links point at
 * the maintained branch named in the content manifest. The commit comes only
 * from trusted build metadata (an explicit MARKOV_DOCS_SOURCE_COMMIT, the
 * hosting provider's or CI's commit variable) or from a clean local
 * checkout; every value is validated, and anything else is an honest
 * "unknown" rather than a guess. Nothing here reads request data: the site
 * is static and every URL is decided at build time.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const COMMIT = /^[0-9a-f]{40}$/;

/** Environment variables that may carry the built commit, in order of precedence. */
export const COMMIT_VARIABLES = [
  'MARKOV_DOCS_SOURCE_COMMIT',
  'VERCEL_GIT_COMMIT_SHA',
  'GITHUB_SHA',
];

/**
 * A branch name git would accept (git check-ref-format --branch), restricted
 * further to the characters branch names here use, so it can never smuggle a
 * query, fragment, scheme or path traversal into a URL.
 */
export function isSafeBranch(name) {
  if (typeof name !== 'string' || name.length === 0 || name.length > 200) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) return false;
  if (name.startsWith('/') || name.endsWith('/') || name.startsWith('-')) return false;
  if (name.includes('//') || name.includes('..') || name.endsWith('.lock') || name.endsWith('.'))
    return false;
  return name.split('/').every((part) => part.length > 0 && !part.startsWith('.'));
}

/** Encode each path segment and keep the separators, so a/b/c.md and feature/x stay readable. */
export function encodeSegments(path) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve the build's source. Returns
 *   { repository, branch, commit, state, origin }
 * where state is 'commit' (links pin `commit`), 'local-uncommitted' (a
 * checkout with changes: nothing pins, the footer says so) or 'unknown'.
 * Throws when configured metadata is malformed or contradicts the checkout.
 */
export function resolveSource({
  repository,
  maintainedBranch,
  root,
  env = process.env,
  runGit = git,
}) {
  if (!/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repository)) {
    throw new Error(
      `content manifest: repository must be https://github.com/<owner>/<name>, got ${repository}`,
    );
  }
  const override = env.MARKOV_DOCS_EDIT_BRANCH;
  const branch = override === undefined || override === '' ? maintainedBranch : override;
  if (!isSafeBranch(branch)) {
    throw new Error(
      `docs source: edit branch ${JSON.stringify(branch)} is not a valid branch name (${override ? 'MARKOV_DOCS_EDIT_BRANCH' : 'content manifest maintainedBranch'})`,
    );
  }
  const head = runGit(root, ['rev-parse', 'HEAD']);
  for (const name of COMMIT_VARIABLES) {
    const value = env[name];
    if (value === undefined || value === '') continue;
    const commit = value.toLowerCase();
    if (!COMMIT.test(commit)) {
      throw new Error(`docs source: ${name} must be a full 40-character commit hash`);
    }
    if (head && COMMIT.test(head) && head !== commit) {
      throw new Error(
        `docs source: ${name} names ${commit.slice(0, 12)} but the checkout is at ${head.slice(0, 12)}; refusing to publish links to a revision the site was not built from`,
      );
    }
    return { repository, branch, commit, state: 'commit', origin: name };
  }
  if (head && COMMIT.test(head)) {
    const dirty = runGit(root, ['status', '--porcelain', '--untracked-files=no']);
    if (dirty === '') {
      return { repository, branch, commit: head, state: 'commit', origin: 'git checkout' };
    }
    return { repository, branch, commit: null, state: 'local-uncommitted', origin: 'git checkout' };
  }
  return { repository, branch, commit: null, state: 'unknown', origin: 'none' };
}

/** Links for one resolved source. */
export function linksFor(source) {
  const base = source.repository;
  const branch = encodeSegments(source.branch);
  return {
    /** The file at the built commit; at the maintained branch when the revision is unknown. */
    blob(path, anchor) {
      const ref = source.commit ?? branch;
      return `${base}/blob/${ref}/${encodeSegments(path)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
    },
    /** GitHub's editor for the file on the maintained branch. */
    edit(path) {
      return `${base}/edit/${branch}/${encodeSegments(path)}`;
    },
    /** The commit page, or null. */
    commit() {
      return source.commit ? `${base}/commit/${source.commit}` : null;
    },
  };
}

/** Where the resolved source is written for the generators and the site config (gitignored). */
export const BUILD_SOURCE_PATH = 'apps/docs/generated/source.json';

/** Writes only the resolved fields: no environment is copied into the build. */
export function writeBuildSource(root, source) {
  const path = join(root, ...BUILD_SOURCE_PATH.split('/'));
  mkdirSync(dirname(path), { recursive: true });
  const { repository, branch, commit, state, origin } = source;
  writeFileSync(
    path,
    `${JSON.stringify({ schemaVersion: 1, repository, branch, commit, state, origin }, null, 2)}\n`,
  );
}

/** The source the sync step resolved; throws when the sync has not run. */
export function readBuildSource(root) {
  const path = join(root, ...BUILD_SOURCE_PATH.split('/'));
  if (!existsSync(path)) {
    throw new Error(
      `${BUILD_SOURCE_PATH} is missing; run \`pnpm --filter @markov/docs run sync\` first`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}
