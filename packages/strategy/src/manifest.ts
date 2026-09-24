import { createHash } from 'node:crypto';
import type { Maintenance, StrategyKind } from '@markov/contracts';

/**
 * The canonical off-chain manifest of a version: the economic content and
 * provenance a registry entry commits to, nothing about the author, budgets
 * or wallets. Keys are sorted, legs are sorted by instrument id, references
 * are sorted, and the hash is domain-separated by schema version and
 * network identity so a manifest for one cluster never verifies on another.
 * B08 must reproduce this byte for byte (test vectors in
 * `packages/strategy/test/strategy.test.ts`).
 */
export interface ManifestLeg {
  readonly instrumentId: string;
  readonly mint: string;
  readonly tokenProgram: string;
  readonly weightBps: number;
}

export interface ManifestInput {
  readonly schemaVersion: '1';
  readonly kind: StrategyKind;
  readonly genesisHash: string;
  readonly strategyId: string;
  readonly versionNumber: number;
  readonly parentVersionId: string | null;
  readonly forkOf: { readonly strategyId: string; readonly versionId: string } | null;
  readonly title: string;
  readonly thesis: string;
  readonly thesisId: string | null;
  readonly legs: readonly ManifestLeg[];
  readonly cashWeightBps: number;
  readonly maintenance: Maintenance;
  readonly references: readonly string[];
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, sortKeys(inner)]),
    );
  }
  return value;
}

/** The lineage of a version: excluded from the content digest, part of the manifest. */
export type ManifestLineage = Pick<
  ManifestInput,
  'strategyId' | 'versionNumber' | 'parentVersionId' | 'forkOf'
>;
export type ContentInput = Omit<ManifestInput, keyof ManifestLineage>;

function contentBody(input: ContentInput) {
  const legs = [...input.legs]
    .map((leg) => ({
      instrumentId: leg.instrumentId,
      mint: leg.mint,
      tokenProgram: leg.tokenProgram,
      weightBps: leg.weightBps,
    }))
    .sort((a, b) =>
      a.instrumentId < b.instrumentId ? -1 : a.instrumentId > b.instrumentId ? 1 : 0,
    );
  return {
    schemaVersion: input.schemaVersion,
    kind: input.kind,
    network: { chain: 'solana', genesisHash: input.genesisHash },
    title: input.title,
    thesis: input.thesis,
    thesisId: input.thesisId,
    legs,
    cashWeightBps: input.cashWeightBps,
    maintenance: {
      suggestion: input.maintenance.suggestion,
      driftThresholdBps: input.maintenance.driftThresholdBps,
      reviewEveryDays: input.maintenance.reviewEveryDays,
    },
    references: [...input.references].sort(),
  };
}

/**
 * The economic content alone, canonically encoded: what a follower accepts
 * when they pin a version. Two versions with the same content share one
 * digest whatever their number, parent or fork, which is how a freeze of an
 * unchanged draft answers the existing version instead of minting a twin.
 */
export function canonicalContent(input: ContentInput): string {
  return JSON.stringify(sortKeys(contentBody(input)));
}

export function canonicalManifest(input: ManifestInput): string {
  const manifest = {
    ...contentBody(input),
    strategyId: input.strategyId,
    versionNumber: input.versionNumber,
    parentVersionId: input.parentVersionId,
    forkOf: input.forkOf,
  };
  return JSON.stringify(sortKeys(manifest));
}

/** Domain prefix of the content digest; distinct from the manifest domain so the two can never collide. */
export function contentDomain(schemaVersion: string, genesisHash: string): string {
  return `markov-strategy-content/v${schemaVersion}/${genesisHash}`;
}

export function contentDigestOf(
  canonical: string,
  schemaVersion: string,
  genesisHash: string,
): string {
  return createHash('sha256')
    .update(`${contentDomain(schemaVersion, genesisHash)}\n`)
    .update(canonical)
    .digest('hex');
}

/** Domain prefix: schema version and the genesis hash of the network the legs live on. */
export function manifestDomain(schemaVersion: string, genesisHash: string): string {
  return `markov-strategy-manifest/v${schemaVersion}/${genesisHash}`;
}

export function manifestHashOf(
  canonical: string,
  schemaVersion: string,
  genesisHash: string,
): string {
  return createHash('sha256')
    .update(`${manifestDomain(schemaVersion, genesisHash)}\n`)
    .update(canonical)
    .digest('hex');
}
