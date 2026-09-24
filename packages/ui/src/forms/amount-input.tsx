'use client';

import { formatRawAmount, type ParseDecimalFailure, parseDecimalToRaw } from '@markov/formatters';
import { forwardRef, type InputHTMLAttributes, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../cn';
import { inputClassName } from './field';

export interface AmountChange {
  /** Exact base-unit amount, or null when the text is empty or invalid. */
  readonly raw: string | null;
  readonly text: string;
  readonly error: ParseDecimalFailure | null;
}

export interface AmountInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> {
  /** Exact base-unit amount owned by the parent; null when empty. */
  readonly value: string | null;
  readonly decimals: number;
  readonly unit: string;
  readonly onValueChange: (change: AmountChange) => void;
  readonly locale?: string;
}

/**
 * Amount editing without floats. Typing is free-form; the exact raw amount
 * is reported on every change, and the text is normalised (grouped, no
 * trailing zeros) when the field loses focus. The visible text follows the
 * parent's value only when the parent changes it to something other than
 * what this field last reported, so invalid input is never silently erased.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, decimals, unit, onValueChange, locale, className, onBlur, ...props },
  ref,
) {
  const unitId = useId();
  const format = (raw: string) =>
    formatRawAmount(raw.replace('-', ''), decimals, locale ? { locale } : {});
  const [text, setText] = useState(() => (value === null ? '' : format(value)));
  const lastReported = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (lastReported.current !== undefined && value === lastReported.current) {
      return;
    }
    lastReported.current = value;
    setText(
      value === null
        ? ''
        : formatRawAmount(value.replace('-', ''), decimals, locale ? { locale } : {}),
    );
  }, [value, decimals, locale]);

  return (
    <div className="relative">
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        {...props}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          const parsed = parseDecimalToRaw(nextText, decimals, locale ? { locale } : {});
          lastReported.current = parsed.ok ? parsed.raw : null;
          onValueChange(
            parsed.ok
              ? { raw: parsed.raw, text: nextText, error: null }
              : { raw: null, text: nextText, error: parsed.reason },
          );
        }}
        onBlur={(event) => {
          const parsed = parseDecimalToRaw(text, decimals, locale ? { locale } : {});
          if (parsed.ok) {
            setText(format(parsed.raw));
          }
          onBlur?.(event);
        }}
        className={cn(inputClassName, 'tabular pr-16', className)}
        aria-describedby={cn(props['aria-describedby'], unitId)}
      />
      <span
        id={unitId}
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-supporting text-text-muted"
      >
        {unit}
      </span>
    </div>
  );
});
