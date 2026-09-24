import { CircleCheck, CircleDot, CircleX, Clock, Info, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export type StatusTone = 'neutral' | 'info' | 'success' | 'attention' | 'error' | 'pending';

const toneClasses: Record<StatusTone, string> = {
  neutral: 'border-border/60 text-text-muted',
  info: 'border-accent/50 text-accent',
  success: 'border-success/50 text-success',
  attention: 'border-attention/50 text-attention',
  error: 'border-error/50 text-error',
  pending: 'border-attention/50 text-attention',
};

const toneIcons = {
  neutral: CircleDot,
  info: Info,
  success: CircleCheck,
  attention: TriangleAlert,
  error: CircleX,
  pending: Clock,
} as const;

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone: StatusTone;
}

/** Status is always conveyed by icon and text together, never by colour alone. */
export function StatusBadge({ tone, className, children, ...props }: StatusBadgeProps) {
  const Icon = toneIcons[tone];
  return (
    <span
      className={cn(
        'inline-flex min-h-7 items-center gap-1.5 rounded-pill border bg-surface px-2.5 text-supporting font-medium',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-3.5 shrink-0', tone === 'pending' && 'animate-pulse')}
      />
      {children}
    </span>
  );
}
