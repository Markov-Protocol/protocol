import { CircleX } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { Button } from '../primitives/button';

export interface ErrorBlockProps {
  readonly title: ReactNode;
  readonly message: ReactNode;
  /** Redacted request id from the API error envelope, for support. */
  readonly requestId?: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly className?: string;
}

/**
 * A failure is shown as a failure. Never render zeros or demo data in place
 * of a service error.
 */
export function ErrorBlock({
  title,
  message,
  requestId,
  onRetry,
  retryLabel = 'Try again',
  className,
}: ErrorBlockProps) {
  return (
    <div
      role="alert"
      className={cn('rounded-panel border border-error/40 bg-surface p-4 text-text', className)}
    >
      <div className="flex gap-3">
        <CircleX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-error" />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-medium">{title}</p>
          <p className="text-supporting text-text-muted">{message}</p>
          {requestId ? (
            <p className="text-caption text-text-muted">
              Request id <code className="font-mono text-text">{requestId}</code>
            </p>
          ) : null}
          {onRetry ? (
            <div className="pt-1">
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {retryLabel}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
