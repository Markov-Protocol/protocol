/**
 * Commit message policy shared by the local commit-msg hook and the CI range
 * check. Kept dependency-free so it runs before `pnpm install`.
 *
 * Rules:
 * 1. Conventional Commits header: type(scope)!: subject, scope required for
 *    feature work, subject 1..72 characters, no trailing period.
 * 2. No Co-authored-by trailers, no bot co-author attribution lines and no
 *    tool or session attribution trailers (for example Claude-Session).
 * 3. Merge and revert commits produced by git are accepted as-is.
 */
export const ALLOWED_TYPES = [
  'feat',
  'fix',
  'docs',
  'chore',
  'refactor',
  'test',
  'build',
  'ci',
  'perf',
  'revert',
  'style',
];

const HEADER =
  /^(?<type>[a-z]+)(?:\((?<scope>[a-z0-9][a-z0-9-]*)\))?(?<breaking>!)?: (?<subject>.+)$/;
const FORBIDDEN_TRAILERS = [
  /^co-authored-by:/i,
  /^co-author:/i,
  /^co-developed-by:/i,
  /^authored-by:.*bot/i,
  /^generated-by:/i,
  /^generated-with:/i,
  /^claude-session:/i,
  /^assisted-by:/i,
];

export function checkCommitMessage(message) {
  const problems = [];
  const lines = message.replace(/\r\n/g, '\n').split('\n');
  const content = lines.filter((line) => !line.startsWith('#'));
  const header = content.find((line) => line.trim() !== '') ?? '';

  if (/^(Merge |Revert ")/.test(header)) {
    return { ok: true, problems: [], header };
  }

  const match = HEADER.exec(header);
  if (!match?.groups) {
    problems.push(`header "${header}" is not "type(scope): subject"`);
  } else {
    const { type, subject } = match.groups;
    if (!ALLOWED_TYPES.includes(type)) {
      problems.push(`type "${type}" is not one of ${ALLOWED_TYPES.join(', ')}`);
    }
    if (subject.length > 72) {
      problems.push(`subject is ${subject.length} characters; keep it at 72 or fewer`);
    }
    if (subject.endsWith('.')) {
      problems.push('subject must not end with a period');
    }
  }

  for (const [index, line] of content.entries()) {
    if (FORBIDDEN_TRAILERS.some((pattern) => pattern.test(line.trim()))) {
      problems.push(
        `line ${index + 1} contains a forbidden co-author, generator or session trailer`,
      );
    }
  }

  return { ok: problems.length === 0, problems, header };
}
