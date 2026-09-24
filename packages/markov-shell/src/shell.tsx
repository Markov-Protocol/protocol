'use client';

import type { ReactNode } from 'react';
import { DeviceFrame } from './device-frame';
import { Navigation, type NavigationItem, type RenderLink } from './navigation';
import { type ShellMode, ShellModeProvider, useShellMode } from './shell-mode';
import { SkipLink } from './skip-link';

export interface MarkovShellProps {
  readonly mode: ShellMode;
  readonly currentPath: string;
  readonly items: readonly NavigationItem[];
  readonly renderLink: RenderLink;
  /** Rendered after the navigation items of each variant (for example a "More" menu). */
  readonly navigationTrailing?: (variant: 'rail' | 'bottom') => ReactNode;
  readonly topBar: ReactNode;
  /** Companion dock content shown beside the workspace on wide screens. */
  readonly dock?: ReactNode;
  readonly children: ReactNode;
}

function ShellLayout({
  currentPath,
  items,
  renderLink,
  navigationTrailing,
  topBar,
  dock,
  children,
}: Omit<MarkovShellProps, 'mode'>) {
  const { mode, focus } = useShellMode();
  return (
    <DeviceFrame mode={mode} focus={focus}>
      <SkipLink />
      <div className="markov-screen__grid">
        <div className="markov-screen__topbar">{topBar}</div>
        <aside className="markov-screen__rail" aria-label="Navigation rail">
          <Navigation
            items={items}
            currentPath={currentPath}
            renderLink={renderLink}
            trailing={navigationTrailing?.('rail')}
            variant="rail"
          />
        </aside>
        <main id="main-content" tabIndex={-1} className="markov-screen__main">
          {children}
        </main>
        {dock ? (
          <aside className="markov-screen__dock" aria-label="Companion">
            {dock}
          </aside>
        ) : null}
        <div className="markov-screen__bottom">
          <Navigation
            items={items}
            currentPath={currentPath}
            renderLink={renderLink}
            trailing={navigationTrailing?.('bottom')}
            variant="bottom"
          />
        </div>
      </div>
    </DeviceFrame>
  );
}

/**
 * The persistent shell. Mode and focus preference come from the provider so
 * route changes never remount the frame.
 */
export function MarkovShell({ mode, ...props }: MarkovShellProps) {
  return (
    <ShellModeProvider mode={mode}>
      <ShellLayout {...props} />
    </ShellModeProvider>
  );
}
