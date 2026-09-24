export interface ConfigIssue {
  /** Environment variable name or dotted config path the issue refers to. */
  readonly path: string;
  /** Secret-free description of what is wrong and how to fix it. */
  readonly message: string;
}

/**
 * Thrown when configuration is missing, malformed, or violates a runtime
 * invariant. The message lists every issue so an operator fixes them in one
 * pass. Values are never echoed back.
 */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `invalid configuration (${issues.length} issue${issues.length === 1 ? '' : 's'}):\n` +
        issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n'),
    );
    this.issues = issues;
  }
}
