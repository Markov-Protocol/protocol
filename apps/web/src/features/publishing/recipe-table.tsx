'use client';

import type { SolanaCluster } from '@markov/contracts';
import { formatBasisPoints, shortenAddress } from '@markov/formatters';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@markov/ui';
import Link from 'next/link';
import { explorerAddressUrl, ISSUER_LABELS } from '../markets/labels';
import type { RecipeLeg } from './publication-state';

const PROGRAM_LABELS: Readonly<Record<RecipeLeg['tokenProgram'], string>> = {
  'spl-token': 'SPL Token',
  'token-2022': 'Token-2022',
  unknown: 'unknown program',
};

/**
 * The frozen recipe exactly as the version carries it: constituents by
 * canonical id with their mint, token program and integer weight, and the
 * cash remainder. Nothing here is rounded or renormalised.
 */
export function RecipeTable({
  legs,
  cashWeightBps,
  cluster,
}: {
  readonly legs: readonly RecipeLeg[];
  readonly cashWeightBps: number;
  readonly cluster: SolanaCluster | null;
}) {
  return (
    <Table regionLabel="Recipe constituents">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Constituent</TableHeaderCell>
          <TableHeaderCell>Issuer</TableHeaderCell>
          <TableHeaderCell>Mint</TableHeaderCell>
          <TableHeaderCell numeric>Weight</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {legs.map((leg) => {
          const explorer = explorerAddressUrl(leg.mint, cluster);
          return (
            <TableRow key={leg.instrumentId} data-testid="recipe-leg">
              <TableCell>
                <Link
                  href={`/markets/${leg.instrumentId}`}
                  className="font-medium underline underline-offset-2"
                >
                  {leg.symbol}
                </Link>
                <span className="block text-caption text-text-muted">{leg.companyName}</span>
              </TableCell>
              <TableCell>{ISSUER_LABELS[leg.issuer]}</TableCell>
              <TableCell>
                <code className="font-mono" title={leg.mint}>
                  {shortenAddress(leg.mint)}
                </code>
                <span className="block text-caption text-text-muted">
                  {PROGRAM_LABELS[leg.tokenProgram]}
                  {explorer ? (
                    <>
                      {' · '}
                      <a
                        href={explorer}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="underline underline-offset-2"
                      >
                        Explorer
                      </a>
                    </>
                  ) : null}
                </span>
              </TableCell>
              <TableCell numeric className="font-mono">
                {formatBasisPoints(leg.weightBps)}
              </TableCell>
            </TableRow>
          );
        })}
        <TableRow data-testid="recipe-cash">
          <TableCell>Cash</TableCell>
          <TableCell className="text-text-muted">stays as stablecoin</TableCell>
          <TableCell className="text-text-muted">—</TableCell>
          <TableCell numeric className="font-mono">
            {formatBasisPoints(cashWeightBps)}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
