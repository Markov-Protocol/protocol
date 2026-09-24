'use client';

import { useEffect, useRef } from 'react';
import { cn } from '../cn';

export interface ValidationSummaryItem {
  /** id of the control the message belongs to; the summary links and focuses it. */
  readonly fieldId: string;
  readonly message: string;
}

export interface ValidationSummaryProps {
  readonly title?: string;
  readonly errors: readonly ValidationSummaryItem[];
  /** Move focus to the summary when errors appear (after a submit attempt). */
  readonly focusOnAppear?: boolean;
  readonly className?: string;
}

/** Accessible list of form errors that links each message to its control. */
export function ValidationSummary({
  title = 'Fix the following before continuing',
  errors,
  focusOnAppear = true,
  className,
}: ValidationSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnAppear && errors.length > 0) {
      ref.current?.focus();
    }
  }, [errors.length, focusOnAppear]);
  if (errors.length === 0) {
    return null;
  }
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className={cn(
        'rounded-panel border border-error/40 bg-surface p-4 text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-supporting">
        {errors.map((error) => (
          <li key={`${error.fieldId}-${error.message}`}>
            <a
              href={`#${error.fieldId}`}
              className="text-accent underline-offset-2 hover:underline"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(error.fieldId)?.focus();
              }}
            >
              {error.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
