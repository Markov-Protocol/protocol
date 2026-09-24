'use client';

import { Button } from '@markov/ui';
import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Copies exactly the given text; announces the result; degrades honestly when the clipboard is unavailable. */
export function CopyButton({ value, label }: { readonly value: string; readonly label: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (status === 'idle') {
      return;
    }
    const timer = setTimeout(() => setStatus('idle'), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setStatus('copied');
        } catch {
          setStatus('failed');
        }
      }}
    >
      {status === 'copied' ? (
        <Check aria-hidden="true" className="size-4" />
      ) : (
        <Copy aria-hidden="true" className="size-4" />
      )}
      <span>
        {status === 'copied'
          ? 'Copied'
          : status === 'failed'
            ? 'Copy failed; select the text'
            : 'Copy'}
      </span>
      <span role="status" className="sr-only">
        {status === 'copied'
          ? 'Copied to the clipboard'
          : status === 'failed'
            ? 'The clipboard is unavailable; select the text instead'
            : ''}
      </span>
    </Button>
  );
}
