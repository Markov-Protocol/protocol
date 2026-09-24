import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../cn';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Accessible name of the scroll region wrapping a wide table. */
  readonly regionLabel: string;
}

/**
 * Semantic table inside a labelled, keyboard-focusable scroll region so a
 * wide financial table never forces the whole page to scroll horizontally.
 */
export function Table({ regionLabel, className, ...props }: TableProps) {
  return (
    <section
      aria-label={regionLabel}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1)
      tabIndex={0}
      className="overflow-x-auto rounded-panel border border-border/60"
    >
      <table className={cn('w-full border-collapse text-body', className)} {...props} />
    </section>
  );
}

export function TableCaption({ className, ...props }: HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      className={cn('px-4 py-3 text-left text-supporting text-text-muted', className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead className={cn('bg-surface text-supporting text-text-muted', className)} {...props} />
  );
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border/40', className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('hover:bg-surface/60', className)} {...props} />;
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  readonly numeric?: boolean;
}

export function TableHeaderCell({
  className,
  numeric = false,
  scope = 'col',
  ...props
}: TableHeaderCellProps) {
  return (
    <th
      scope={scope}
      className={cn('px-4 py-3 font-medium', numeric ? 'text-right' : 'text-left', className)}
      {...props}
    />
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  readonly numeric?: boolean;
}

export function TableCell({ className, numeric = false, ...props }: TableCellProps) {
  return (
    <td
      className={cn('px-4 py-3 align-top', numeric ? 'tabular text-right' : 'text-left', className)}
      {...props}
    />
  );
}
