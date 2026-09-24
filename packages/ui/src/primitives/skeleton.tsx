import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

/** Loading placeholder. Purely decorative: the surrounding region must carry its own busy state. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-control bg-surface-raised', className)}
      {...props}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  readonly lines?: number;
  readonly className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => index + 1).map((line) => (
        <Skeleton key={`line-${line}`} className={cn('h-4', line === lines ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  );
}
