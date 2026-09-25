/** Types for scripts/source-metadata.mjs, used by docusaurus.config.ts. */
export interface BuildSource {
  readonly schemaVersion?: 1;
  readonly repository: string;
  readonly branch: string;
  readonly commit: string | null;
  readonly state: 'commit' | 'local-uncommitted' | 'unknown';
  readonly origin: string;
}
export interface SourceLinks {
  blob(path: string, anchor?: string): string;
  edit(path: string): string;
  commit(): string | null;
}
export const COMMIT_VARIABLES: readonly string[];
export const BUILD_SOURCE_PATH: string;
export function isSafeBranch(name: unknown): boolean;
export function encodeSegments(path: string): string;
export function resolveSource(options: {
  repository: string;
  maintainedBranch: string;
  root: string;
  env?: Record<string, string | undefined>;
  runGit?: (root: string, args: string[]) => string | null;
}): BuildSource;
export function linksFor(source: BuildSource): SourceLinks;
export function writeBuildSource(root: string, source: BuildSource): void;
export function readBuildSource(root: string): BuildSource;
