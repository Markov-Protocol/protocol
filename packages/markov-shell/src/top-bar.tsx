import type { ReactNode } from 'react';

export interface TopBarProps {
  /** Page context (route title). */
  readonly title: ReactNode;
  /** Data/network status indicators. */
  readonly status?: ReactNode;
  /** Selected wallet and account access. */
  readonly account?: ReactNode;
  readonly presence?: ReactNode;
}

export function TopBar({ title, status, account, presence }: TopBarProps) {
  return (
    <header className="markov-topbar flex min-h-14 items-center gap-3 border-b border-border/40 px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        {presence}
        <p className="truncate text-supporting font-medium text-text">{title}</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {status}
        {account}
      </div>
    </header>
  );
}
