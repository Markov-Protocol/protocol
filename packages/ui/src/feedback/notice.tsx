import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn';

export type NoticeTone = 'info' | 'success' | 'attention' | 'error';

const toneClasses: Record<NoticeTone, string> = {
  info: 'border-accent/40',
  success: 'border-success/40',
  attention: 'border-attention/40',
  error: 'border-error/40',
};

const toneIconClasses: Record<NoticeTone, string> = {
  info: 'text-accent',
  success: 'text-success',
  attention: 'text-attention',
  error: 'text-error',
};

const toneIcons = {
  info: Info,
  success: CircleCheck,
  attention: TriangleAlert,
  error: CircleX,
} as const;

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  readonly tone: NoticeTone;
  readonly title: ReactNode;
  readonly actions?: ReactNode;
  /** Announce changes: 'polite' for status, 'assertive' for errors that need attention now. */
  readonly live?: 'off' | 'polite' | 'assertive';
}

export function Notice({
  tone,
  title,
  actions,
  live = 'off',
  className,
  children,
  ...props
}: NoticeProps) {
  const Icon = toneIcons[tone];
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;
  return (
    <div
      role={role}
      className={cn(
        'flex gap-3 rounded-panel border bg-surface p-4 text-text',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', toneIconClasses[tone])} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">{title}</p>
        {children ? <div className="text-supporting text-text-muted">{children}</div> : null}
        {actions ? <div className="flex flex-wrap gap-2 pt-2">{actions}</div> : null}
      </div>
    </div>
  );
}
