'use client';

import type { PublicStrategy } from '@markov/contracts';
import { shortenAddress } from '@markov/formatters';
import { SkeletonText } from '@markov/ui';
import Link from 'next/link';
import { usePublicVersion } from '../publishing/queries';
import { summarizeEntry } from './discovery-model';
import { useRankings } from './queries';

/**
 * On a public strategy page: who registered the newest version (the wallet
 * on chain, nothing more) and where that version stands in the model
 * ranking, with the reason when it stands nowhere.
 */
export function StrategyProvenance({ strategy }: { readonly strategy: PublicStrategy }) {
  const newest = [...strategy.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const version = usePublicVersion(
    strategy.strategyId,
    newest?.versionId ?? null,
    newest !== undefined,
  );
  const rankings = useRankings('30d', newest !== undefined);
  if (!newest) {
    return null;
  }
  const entry = rankings.data?.entries.find(
    (candidate) => candidate.versionId === newest.versionId,
  );
  const summary =
    entry && rankings.data ? summarizeEntry(entry, rankings.data.minHistoryDays) : null;
  return (
    <dl
      className="grid gap-x-6 gap-y-1 text-supporting sm:grid-cols-[auto_minmax(0,1fr)]"
      data-testid="strategy-provenance"
    >
      <dt className="text-text-muted">Creator</dt>
      <dd>
        {version.data ? (
          <Link
            href={`/creators/${version.data.registration.publisher}`}
            className="font-mono underline underline-offset-2"
            title={version.data.registration.publisher}
            data-testid="creator-link"
          >
            {shortenAddress(version.data.registration.publisher)}
          </Link>
        ) : version.error ? (
          <span className="text-text-muted">not readable right now</span>
        ) : (
          <SkeletonText lines={1} />
        )}
        <span className="block text-caption text-text-muted">
          The wallet that signed the newest registration; Markov attaches no name or badge.
        </span>
      </dd>
      <dt className="text-text-muted">Model ranking</dt>
      <dd data-testid="strategy-ranking">
        {summary ? (
          summary.kind === 'ranked' ? (
            <>
              <span className="font-mono">#{summary.rank}</span> ·{' '}
              <span className="font-mono">{summary.returnText}</span> over the last 30 days ·{' '}
              {summary.drawdownText} · {summary.historyText}
            </>
          ) : (
            <>
              Unranked · {summary.reasonText} · {summary.historyText}
            </>
          )
        ) : rankings.data ? (
          <span className="text-text-muted">not in the current cohort</span>
        ) : rankings.error ? (
          <span className="text-text-muted">the ranking could not be read right now</span>
        ) : (
          <SkeletonText lines={1} />
        )}
        <span className="block text-caption text-text-muted">
          The model series of version {newest.versionNumber} under stocks-v1, never an account;{' '}
          <Link href="/rankings" className="underline underline-offset-2">
            see the whole cohort
          </Link>
          .
        </span>
      </dd>
    </dl>
  );
}
