'use client';

import { Button, SearchInput, StatusBadge } from '@markov/ui';
import { useEffect, useState } from 'react';
import { ISSUER_LABELS } from './labels';
import { useInstrumentPages } from './queries';

/**
 * Search the admitted catalog and add an instrument by its canonical id.
 * The API decides what is listed; the picker never invents an id and
 * refuses duplicates through `excluded`.
 */
export function InstrumentPicker({
  excluded,
  onAdd,
  label = 'Search admitted instruments',
  addLabel = 'Add',
}: {
  readonly excluded: ReadonlySet<string>;
  readonly onAdd: (instrumentId: string) => void;
  readonly label?: string;
  readonly addLabel?: string;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const handle = setTimeout(() => setQ(text.trim().slice(0, 60)), 300);
    return () => clearTimeout(handle);
  }, [text]);
  const pages = useInstrumentPages({ q, issuer: null, kind: null });
  const rows = q === '' ? [] : (pages.data?.pages[0]?.instruments ?? []);
  return (
    <div className="space-y-2" data-testid="instrument-picker">
      <SearchInput
        aria-label={label}
        value={text}
        onValueChange={setText}
        placeholder="Search admitted instruments by company or symbol"
      />
      {q !== '' ? (
        pages.isPending ? (
          <p className="text-caption text-text-muted" aria-busy="true">
            Searching…
          </p>
        ) : pages.error ? (
          <p className="text-caption text-error">The catalog could not be searched right now.</p>
        ) : rows.length === 0 ? (
          <p className="text-caption text-text-muted">
            No admitted instrument matches. A company the catalog does not carry can be a research
            subject; it can never be a constituent.
          </p>
        ) : (
          <ul className="space-y-1" aria-label="Search results">
            {rows.slice(0, 8).map((row) => (
              <li
                key={row.instrumentId}
                className="flex flex-wrap items-center justify-between gap-2 text-supporting"
              >
                <span>
                  {row.symbol} · {row.companyName}{' '}
                  <StatusBadge tone="info">{ISSUER_LABELS[row.issuer]}</StatusBadge>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onAdd(row.instrumentId)}
                  {...(excluded.has(row.instrumentId) ? { disabledReason: 'Already added.' } : {})}
                >
                  {addLabel} {row.symbol}
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
