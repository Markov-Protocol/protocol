'use client';

import { StatusBadge, type StatusTone } from '@markov/ui';
import Link from 'next/link';
import type { FactState } from './readiness';
import { useReadiness } from './readiness';

const tones: Record<FactState, StatusTone> = {
  yes: 'success',
  no: 'neutral',
  partial: 'attention',
  loading: 'pending',
  error: 'error',
};
const words: Record<FactState, string> = {
  yes: 'Yes',
  no: 'No',
  partial: 'Partly',
  loading: 'Checking',
  error: 'Unknown',
};

/** The four readiness facts, each with its own state and a place to resolve it. */
export function ReadinessSummary({ compact = false }: { readonly compact?: boolean }) {
  const { facts } = useReadiness();
  return (
    <ul aria-label="Trading readiness" className={compact ? 'space-y-1' : 'space-y-2'}>
      {facts.map((fact) => (
        <li key={fact.key} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <span className="font-medium">{fact.label}</span>
            {compact ? null : <p className="text-supporting text-text-muted">{fact.detail}</p>}
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={tones[fact.state]}>{words[fact.state]}</StatusBadge>
            {fact.href && fact.state !== 'yes' ? (
              <Link href={fact.href} className="text-supporting underline underline-offset-2">
                Resolve
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
