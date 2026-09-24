import { cn } from '@markov/ui';
import { type EyeExpression, PixelEyes } from './pixel-eyes';

export interface CompanionPresenceProps {
  readonly expression?: EyeExpression;
  /** Short status text read by assistive technology (for example "Markov is ready"). */
  readonly status: string;
  readonly size?: 'hero' | 'compact';
  readonly className?: string;
}

/** The eyes plus their textual status; the text is the accessible source of truth. */
export function CompanionPresence({
  expression = 'ready',
  status,
  size = 'compact',
  className,
}: CompanionPresenceProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2',
        size === 'hero' ? 'flex-col gap-4' : 'flex-row',
        className,
      )}
      data-presence={size}
    >
      <PixelEyes expression={expression} size={size} />
      <span
        className={cn(size === 'hero' ? 'sr-only' : 'text-caption text-text-muted')}
        role="status"
        aria-live="polite"
      >
        {status}
      </span>
    </div>
  );
}
