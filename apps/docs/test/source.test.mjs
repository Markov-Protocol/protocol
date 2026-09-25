import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadManifest,
  manifestProblems,
  ROOT,
  readManifest,
  unlistedSitePages,
} from '../scripts/content-manifest.mjs';
import {
  encodeSegments,
  isSafeBranch,
  linksFor,
  resolveSource,
} from '../scripts/source-metadata.mjs';

const REPOSITORY = 'https://github.com/Markov-Protocol/protocol';
const COMMIT = 'c52ecabd106d94a88bf443e8d23f4d2f6ddb6c2f';
const OTHER = '7067e13aa7d1e1b5c3b3f2d64f1f0f4e1e2d3c4b';

/** A stand-in for git: HEAD and whether the worktree is clean. */
function fakeGit({ head = COMMIT, dirty = false } = {}) {
  return (_root, args) => {
    if (args[0] === 'rev-parse') return head;
    if (args[0] === 'status') return dirty ? ' M docs/markov/api.md' : '';
    return null;
  };
}

function resolve(env, git = fakeGit(), maintainedBranch = 'main') {
  return resolveSource({ repository: REPOSITORY, maintainedBranch, root: ROOT, env, runGit: git });
}

describe('build source', () => {
  it('pins trusted commit metadata and cross-checks it against the checkout', () => {
    const source = resolve({ VERCEL_GIT_COMMIT_SHA: COMMIT });
    expect(source).toMatchObject({
      commit: COMMIT,
      state: 'commit',
      origin: 'VERCEL_GIT_COMMIT_SHA',
    });
    expect(resolve({ MARKOV_DOCS_SOURCE_COMMIT: COMMIT, GITHUB_SHA: OTHER }).origin).toBe(
      'MARKOV_DOCS_SOURCE_COMMIT',
    );
    expect(() => resolve({ GITHUB_SHA: OTHER })).toThrow(/checkout is at c52ecabd106d/);
    expect(() => resolve({ GITHUB_SHA: 'c52ecab' })).toThrow(/full 40-character/);
    expect(() => resolve({ GITHUB_SHA: `${COMMIT}?x=1` })).toThrow(/full 40-character/);
  });

  it('uses a clean checkout, and says so honestly when there is no verified revision', () => {
    expect(resolve({})).toMatchObject({ commit: COMMIT, state: 'commit', origin: 'git checkout' });
    expect(resolve({}, fakeGit({ dirty: true }))).toMatchObject({
      commit: null,
      state: 'local-uncommitted',
    });
    expect(resolve({}, () => null)).toMatchObject({
      commit: null,
      state: 'unknown',
      origin: 'none',
    });
    // Without git (a hosted build that drops .git), trusted metadata still pins the commit.
    expect(resolve({ VERCEL_GIT_COMMIT_SHA: COMMIT }, () => null).commit).toBe(COMMIT);
  });

  it('accepts only real branch names for edit links, from the manifest or a validated override', () => {
    for (const name of ['main', 'claude/affectionate-gauss-2ml7ll', 'release/v1.2']) {
      expect(isSafeBranch(name)).toBe(true);
    }
    for (const name of [
      '',
      '../main',
      'a//b',
      '/main',
      'main/',
      'x?y=1',
      'x#y',
      'a b',
      '.hidden',
      'a.lock',
      '-x',
      'https://evil.example',
    ]) {
      expect(isSafeBranch(name)).toBe(false);
    }
    expect(resolve({}, fakeGit(), 'claude/affectionate-gauss-2ml7ll').branch).toBe(
      'claude/affectionate-gauss-2ml7ll',
    );
    expect(resolve({ MARKOV_DOCS_EDIT_BRANCH: 'release/v1' }).branch).toBe('release/v1');
    expect(() => resolve({ MARKOV_DOCS_EDIT_BRANCH: 'main?ref=evil' })).toThrow(
      /MARKOV_DOCS_EDIT_BRANCH/,
    );
    expect(() =>
      resolveSource({
        repository: 'https://evil.example/x',
        maintainedBranch: 'main',
        root: ROOT,
        env: {},
        runGit: fakeGit(),
      }),
    ).toThrow(/repository/);
  });

  it('builds slash-safe links: evidence at the commit, edits on the maintained branch', () => {
    const pinned = linksFor(resolve({}, fakeGit(), 'claude/affectionate-gauss-2ml7ll'));
    expect(pinned.blob('docs/markov/open-decisions.md', 'od-16')).toBe(
      `${REPOSITORY}/blob/${COMMIT}/docs/markov/open-decisions.md#od-16`,
    );
    expect(pinned.edit('docs/markov/open-decisions.md')).toBe(
      `${REPOSITORY}/edit/claude/affectionate-gauss-2ml7ll/docs/markov/open-decisions.md`,
    );
    expect(pinned.commit()).toBe(`${REPOSITORY}/commit/${COMMIT}`);
    const local = linksFor(
      resolve({}, fakeGit({ dirty: true }), 'claude/affectionate-gauss-2ml7ll'),
    );
    expect(local.blob('docs/frontend/evidence/F01/a b.png')).toBe(
      `${REPOSITORY}/blob/claude/affectionate-gauss-2ml7ll/docs/frontend/evidence/F01/a%20b.png`,
    );
    expect(local.commit()).toBeNull();
    expect(encodeSegments('a/b c/d#e.md')).toBe('a/b%20c/d%23e.md');
  });
});

describe('content manifest', () => {
  const manifest = readManifest();
  const exists = (path) => existsSync(join(ROOT, ...path.split('/')));

  it('is sound against this checkout and lists every page Docusaurus would publish', () => {
    expect(manifestProblems(manifest, exists)).toEqual([]);
    expect(unlistedSitePages(manifest)).toEqual([]);
    expect(() => loadManifest()).not.toThrow();
  });

  it('names a missing source, a duplicate, a bad audience and an undeclared section', () => {
    const broken = structuredClone(manifest);
    broken.pages.push({ ...broken.pages[0] });
    broken.pages.push({
      id: 'reference/markov/gone',
      source: 'docs/markov/gone.md',
      audience: 'user',
      kind: 'curated',
    });
    broken.pages.push({
      id: 'reference/secret/x',
      source: 'docs/markov/api.md',
      audience: 'everyone',
      kind: 'curated',
    });
    const problems = manifestProblems(broken, exists).join('\n');
    expect(problems).toMatch(/duplicate id/);
    expect(problems).toMatch(/source docs\/markov\/gone\.md does not exist/);
    expect(problems).toMatch(/audience must be one of/);
    expect(problems).toMatch(/declared section/);
    expect(problems).toMatch(/published twice/);
  });

  it('refuses paths that leave the repository and generated ids in site pages', () => {
    const broken = structuredClone(manifest);
    broken.pages.push({
      id: 'reference/markov/escape',
      source: '../etc/passwd.md',
      audience: 'user',
      kind: 'curated',
    });
    broken.sitePages.push({
      id: 'api/extra',
      source: 'apps/docs/docs/api/extra.md',
      audience: 'user',
      kind: 'curated',
    });
    const problems = manifestProblems(broken, () => true).join('\n');
    expect(problems).toMatch(/escape: invalid source path/);
    expect(problems).toMatch(/generated at build time/);
  });

  it('keeps every published source in the repository, never an ignored or remote file', () => {
    for (const entry of [...manifest.pages, ...manifest.sitePages]) {
      expect(entry.source).not.toMatch(/^(\/|[a-z]+:)/);
      expect(entry.source.endsWith('.md')).toBe(true);
    }
    expect(manifest.pages.some((entry) => entry.source === 'docs/sessions/P01.md')).toBe(true);
  });
});
