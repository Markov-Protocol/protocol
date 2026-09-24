import { describe, expect, it } from 'vitest';
import { checkCommitMessage } from './policy.mjs';

describe('commit policy', () => {
  it('accepts scoped conventional commits', () => {
    expect(
      checkCommitMessage('feat(platform): bootstrap stock strategy backend\n\nBody text.\n').ok,
    ).toBe(true);
    expect(checkCommitMessage('fix(api)!: change readiness contract').ok).toBe(true);
    expect(checkCommitMessage('docs: update session log').ok).toBe(true);
  });

  it('rejects co-author and generator trailers wherever they appear', () => {
    const result = checkCommitMessage(
      'feat(auth): add wallet linking\n\nCo-Authored-By: Some Bot <bot@example.test>\n',
    );
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain('forbidden co-author');
    expect(checkCommitMessage('chore: x\n\nco-authored-by: a <a@b>').ok).toBe(false);
    expect(checkCommitMessage('chore: x\n\nGenerated-By: tool').ok).toBe(false);
    expect(checkCommitMessage('chore: x\n\nClaude-Session: https://example.test/session').ok).toBe(
      false,
    );
    expect(checkCommitMessage('chore: x\n\nAssisted-By: some tool').ok).toBe(false);
  });

  it('rejects malformed headers, unknown types and long subjects', () => {
    expect(checkCommitMessage('Added stuff').ok).toBe(false);
    expect(checkCommitMessage('feature(api): x').ok).toBe(false);
    expect(checkCommitMessage(`feat(api): ${'x'.repeat(73)}`).ok).toBe(false);
    expect(checkCommitMessage('feat(api): ends with period.').ok).toBe(false);
  });

  it('accepts git-generated merge and revert headers', () => {
    expect(checkCommitMessage("Merge branch 'main' into feature").ok).toBe(true);
    expect(checkCommitMessage('Revert "feat(api): x"\n\nThis reverts commit abc.').ok).toBe(true);
  });

  it('ignores comment lines from the editor template', () => {
    expect(
      checkCommitMessage('# Please enter the commit message\nfeat(api): real header\n').ok,
    ).toBe(true);
  });
});
