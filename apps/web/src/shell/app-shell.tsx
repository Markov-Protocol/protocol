'use client';

import {
  CompanionPresence,
  MarkovShell,
  type NavigationItem,
  navigationItemClass,
  PixelEyes,
  type RenderLink,
  TopBar,
  useShellMode,
} from '@markov/shell';
import {
  cn,
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
  StatusBadge,
} from '@markov/ui';
import {
  Activity,
  BookOpen,
  Compass,
  Ellipsis,
  House,
  PieChart,
  Settings,
  SlidersHorizontal,
  Trophy,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccountMenu } from '@/features/auth/account-menu';
import { useSession } from '@/features/auth/session-context';
import { SessionExpiredNotice } from '@/features/auth/session-expired-notice';
import { WalletChip } from '@/features/wallets/wallet-chip';
import { routeInfoFor } from './routes';

/** The four sections of the design reference; the eyes and wordmark in the top bar lead home. */
const primaryItems: readonly NavigationItem[] = [
  { key: 'explore', label: 'Explore', href: '/explore', icon: Compass, match: 'prefix' },
  { key: 'build', label: 'Build', href: '/strategies/new', icon: Wrench, match: 'exact' },
  { key: 'portfolio', label: 'Portfolio', href: '/portfolio', icon: PieChart, match: 'prefix' },
  { key: 'activity', label: 'Activity', href: '/activity', icon: Activity, match: 'prefix' },
];

const moreItems = [
  { href: '/', label: 'Home', icon: House },
  { href: '/research', label: 'Research', icon: BookOpen },
  { href: '/rankings', label: 'Rankings', icon: Trophy },
  { href: '/automations', label: 'Automations', icon: SlidersHorizontal },
  { href: '/settings', label: 'Settings', icon: Settings },
] as const;

/** The build-state chip of the reference: the real environment, never a made-up label; nothing in production. */
function environmentLabel(markovEnv: string): string | null {
  switch (markovEnv) {
    case 'local':
      return 'Local build';
    case 'test':
      return 'Test build';
    case 'staging':
      return 'Staging';
    default:
      return null;
  }
}

const renderLink: RenderLink = ({ href, className, children, ...rest }) => (
  <Link href={href} className={className} aria-current={rest['aria-current']}>
    {children}
  </Link>
);

function FocusMenuItem() {
  const { focus, setFocus } = useShellMode();
  return (
    <MenuItem onSelect={() => setFocus(!focus)} aria-checked={focus} role="menuitemcheckbox">
      {focus ? 'Leave focus mode' : 'Focus mode'}
    </MenuItem>
  );
}

function MoreMenu({ variant }: { readonly variant: 'rail' | 'bottom' }) {
  const router = useRouter();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className={cn(
            navigationItemClass,
            variant === 'bottom' && 'flex-col justify-center gap-0.5 px-1 text-caption',
          )}
          aria-label="More"
        >
          <Ellipsis aria-hidden="true" className="size-5 shrink-0" />
          <span>More</span>
        </button>
      </MenuTrigger>
      <MenuContent
        align={variant === 'bottom' ? 'end' : 'start'}
        side={variant === 'bottom' ? 'top' : 'right'}
      >
        <MenuLabel>Sections</MenuLabel>
        {moreItems.map((item) => (
          <MenuItem key={item.href} onSelect={() => router.push(item.href)}>
            <item.icon aria-hidden="true" className="size-4" />
            {item.label}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>Presentation</MenuLabel>
        <FocusMenuItem />
      </MenuContent>
    </Menu>
  );
}

function ConnectionStatus() {
  const { platform } = useSession();
  if (platform.state === 'unreachable') {
    return <StatusBadge tone="error">Backend unreachable</StatusBadge>;
  }
  return (
    <StatusBadge tone="success" className="whitespace-nowrap">
      Connected{platform.solanaCluster ? ` · ${platform.solanaCluster}` : ''}
    </StatusBadge>
  );
}

function EnvironmentChip() {
  const { platform } = useSession();
  const label = platform.state === 'connected' ? environmentLabel(platform.markovEnv) : null;
  if (label === null) {
    return null;
  }
  return (
    <StatusBadge tone="neutral" className="whitespace-nowrap" data-testid="environment-chip">
      {label}
    </StatusBadge>
  );
}

/** Eyes and wordmark lead home, as in the reference; the page title follows on wide screens. */
function HomeMark({ title }: { readonly title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Link
        href="/"
        className="flex items-center gap-2 text-supporting font-semibold text-text"
        aria-label="Home"
      >
        <PixelEyes size="compact" />
        <span className="hidden sm:inline">markov.pet</span>
      </Link>
      <span aria-hidden="true" className="hidden h-4 w-px bg-border/60 sm:block" />
      <span className="truncate text-supporting text-text-muted">{title}</span>
    </div>
  );
}

/**
 * The app-owned composition of the Mark I shell. The connection status and
 * the account control come from the verified session; the wallet chip says
 * which wallet would sign and whether it is verified.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  const info = routeInfoFor(pathname);
  const mode = pathname === '/' ? 'companion' : 'workspace';
  return (
    <MarkovShell
      mode={mode}
      currentPath={pathname}
      items={primaryItems}
      renderLink={renderLink}
      navigationTrailing={(variant) => <MoreMenu variant={variant} />}
      topBar={
        <TopBar
          title={<HomeMark title={info.title} />}
          status={
            <div className="flex flex-wrap items-center gap-2">
              <EnvironmentChip />
              <WalletChip />
              <ConnectionStatus />
            </div>
          }
          account={<AccountMenu />}
        />
      }
      dock={
        <div className="space-y-3 p-4">
          <CompanionPresence status="Markov is ready" size="compact" />
          <p className="text-supporting text-text-muted">
            The companion panel (questions, evidence cards and typed proposals) arrives with session
            F14 and backend session B15.
          </p>
        </div>
      }
    >
      <SessionExpiredNotice />
      {children}
    </MarkovShell>
  );
}
