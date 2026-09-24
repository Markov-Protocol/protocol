import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface EmptyStateProps {
  readonly icon?: ReactNode;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

/** An honest "nothing here yet" with a real next step; never a fabricated placeholder. */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-panel border border-dashed border-border/60 px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? <div className="text-text-muted">{icon}</div> : null}
      <p className="text-heading-sm font-semibold text-text">{title}</p>
      {description ? (
        <p className="max-w-prose text-supporting text-text-muted">{description}</p>
      ) : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
