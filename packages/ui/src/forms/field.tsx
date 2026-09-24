import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '../cn';

export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby': string | undefined;
  readonly 'aria-invalid': true | undefined;
  readonly 'aria-required': true | undefined;
}

export interface FieldProps {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  /** Validation message. Rendered with an id the summary can link to. */
  readonly error?: ReactNode;
  readonly required?: boolean;
  /** Stable id for the control (needed for validation summaries); generated otherwise. */
  readonly id?: string;
  readonly className?: string;
  readonly children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label, description and error wiring for one control. The render prop
 * receives the ids so any input (native or Radix) is associated correctly.
 */
export function Field({
  label,
  description,
  error,
  required = false,
  id,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;
  const describedBy =
    [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={controlId} className="block text-supporting font-medium text-text">
        {label}
        {required ? (
          <span aria-hidden="true" className="text-error">
            {' *'}
          </span>
        ) : null}
      </label>
      {description ? (
        <p id={descriptionId} className="text-supporting text-text-muted">
          {description}
        </p>
      ) : null}
      {children({
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
      })}
      {error ? (
        <p id={errorId} className="text-supporting text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const inputClassName =
  'block w-full min-h-11 rounded-control border border-border bg-surface px-3 text-body text-text placeholder:text-text-muted/80 aria-invalid:border-error disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-text-muted';
