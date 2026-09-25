import { describe, expect, it } from 'vitest';
import { rewriteLinks } from '../scripts/rewrite-links.mjs';
import { linksFor } from '../scripts/source-metadata.mjs';

const REPOSITORY = 'https://github.com/Markov-Protocol/protocol';
const COMMIT = 'c52ecabd106d94a88bf443e8d23f4d2f6ddb6c2f';

function context(overrides = {}) {
  const bundled = [];
  const warnings = [];
  const ctx = {
    sourcePath: 'docs/sessions/F01.md',
    destination: 'reference/sessions/f01.md',
    pages: new Map([
      ['docs/markov/api.md', { destination: 'reference/markov/api.md' }],
      ['docs/sessions/F02.md', { destination: 'reference/sessions/f02.md' }],
    ]),
    links: linksFor({
      repository: REPOSITORY,
      branch: 'claude/affectionate-gauss-2ml7ll',
      commit: COMMIT,
      state: 'commit',
      origin: 'test',
    }),
    bundleImage: (repoRel) => {
      bundled.push(repoRel);
      return `./_assets/${repoRel.replaceAll('/', '__')}`;
    },
    exists: () => true,
    warn: (message) => warnings.push(message),
    ...overrides,
  };
  return { ctx, bundled, warnings };
}

describe('synced document links', () => {
  it('keeps published pages on the site and pins everything else to the commit', () => {
    const { ctx } = context();
    const out = rewriteLinks(
      [
        'See [the API](../markov/api.md#errors), [F02](F02.md) and [the policy](../../AGENTS.md).',
        'Evidence: [screenshot](../frontend/evidence/F01/home%20320.png) and [site](https://markov.pet).',
        'Jump [down](#next).',
      ].join('\n'),
      ctx,
    );
    expect(out).toContain('[the API](../markov/api.md#errors)');
    expect(out).toContain('[F02](f02.md)');
    expect(out).toContain(`[the policy](${REPOSITORY}/blob/${COMMIT}/AGENTS.md)`);
    expect(out).toContain(
      `[screenshot](${REPOSITORY}/blob/${COMMIT}/docs/frontend/evidence/F01/home%20320.png)`,
    );
    expect(out).toContain('[site](https://markov.pet)');
    expect(out).toContain('[down](#next)');
  });

  it('bundles embedded images with the page instead of hot-linking a branch', () => {
    const { ctx, bundled } = context({
      sourcePath: 'docs/frontend/design-reference/README.md',
      destination: 'reference/frontend/design-reference/readme.md',
    });
    const out = rewriteLinks('![Explore](explore-strategies.png "reference")', ctx);
    expect(bundled).toEqual(['docs/frontend/design-reference/explore-strategies.png']);
    expect(out).toBe(
      '![Explore](./_assets/docs__frontend__design-reference__explore-strategies.png "reference")',
    );
    expect(out).not.toMatch(/githubusercontent|\/blob\//);
  });

  it('refuses a path that leaves the repository and reports a missing target', () => {
    const { ctx, warnings } = context({ exists: () => false });
    expect(() => rewriteLinks('[x](../../../etc/passwd)', ctx)).toThrow(/outside the repository/);
    rewriteLinks('[gone](missing.md)', ctx);
    expect(warnings).toEqual([
      'docs/sessions/F01.md links to a missing file docs/sessions/missing.md; left as a repository link',
    ]);
  });

  it('opens the maintained branch, slash-safe, when the build has no verified revision', () => {
    const { ctx } = context({
      links: linksFor({
        repository: REPOSITORY,
        branch: 'claude/affectionate-gauss-2ml7ll',
        commit: null,
        state: 'local-uncommitted',
        origin: 'git checkout',
      }),
    });
    expect(rewriteLinks('[log](../../README.md)', ctx)).toBe(
      `[log](${REPOSITORY}/blob/claude/affectionate-gauss-2ml7ll/README.md)`,
    );
  });
});
