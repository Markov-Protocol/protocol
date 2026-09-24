'use client';

import {
  formatBasisPoints,
  type PercentParseResult,
  parsePercentToBasisPoints,
} from '@markov/formatters';
import { forwardRef, type InputHTMLAttributes, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../cn';
import { inputClassName } from './field';

export type PercentFailure = Extract<PercentParseResult, { ok: false }>['reason'];

export interface PercentChange {
  readonly bps: number | null;
  readonly text: string;
  readonly error: PercentFailure | null;
}

export interface PercentInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** Integer basis points owned by the parent; null when empty. */
  readonly valueBps: number | null;
  readonly onValueChange: (change: PercentChange) => void;
  readonly locale?: string;
}

/** Percentage editing that reports integer basis points; more than two decimals are rejected, never rounded. */
export const PercentInput = forwardRef<HTMLInputElement, PercentInputProps>(function PercentInput(
  { valueBps, onValueChange, locale, className, onBlur, ...props },
  ref,
) {
  const unitId = useId();
  const format = (bps: number) => formatBasisPoints(bps, locale ? { locale } : {}).replace('%', '');
  const [text, setText] = useState(() => (valueBps === null ? '' : format(valueBps)));
  const lastReported = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (lastReported.current !== undefined && valueBps === lastReported.current) {
      return;
    }
    lastReported.current = valueBps;
    setText(
      valueBps === null
        ? ''
        : formatBasisPoints(valueBps, locale ? { locale } : {}).replace('%', ''),
    );
  }, [valueBps, locale]);

  return (
    <div className="relative">
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        {...props}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          const parsed = parsePercentToBasisPoints(nextText, locale ? { locale } : {});
          lastReported.current = parsed.ok ? parsed.bps : null;
          onValueChange(
            parsed.ok
              ? { bps: parsed.bps, text: nextText, error: null }
              : { bps: null, text: nextText, error: parsed.reason },
          );
        }}
        onBlur={(event) => {
          const parsed = parsePercentToBasisPoints(text, locale ? { locale } : {});
          if (parsed.ok) {
            setText(format(parsed.bps));
          }
          onBlur?.(event);
        }}
        className={cn(inputClassName, 'tabular pr-10', className)}
        aria-describedby={cn(props['aria-describedby'], unitId)}
      />
      <span
        id={unitId}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-supporting text-text-muted"
      >
        %
      </span>
    </div>
  );
});
