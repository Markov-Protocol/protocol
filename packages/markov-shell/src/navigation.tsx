'use client';

import { cn } from '@markov/ui';
import type { ComponentType, ReactNode, SVGProps } from 'react';

export interface NavigationItem {
  readonly key: string;
  readonly label: string;
  readonly href: string;
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Matches when the current path equals the href or starts with it (for nested routes). */
  readonly match?: 'exact' | 'prefix';
}

export interface RenderLinkProps {
  readonly href: string;
  readonly className: string;
  readonly 'aria-current': 'page' | undefined;
  readonly children: ReactNode;
}

export type RenderLink = (props: RenderLinkProps) => ReactNode;

export interface NavigationProps {
  readonly items: readonly NavigationItem[];
  readonly currentPath: string;
  readonly renderLink: RenderLink;
  /** Rendered after the items (for example a "More" menu trigger). */
  readonly trailing?: ReactNode;
  readonly variant: 'rail' | 'bottom';
}

export function isCurrentNavigationItem(item: NavigationItem, currentPath: string): boolean {
  if (item.match === 'prefix') {
    return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
  }
  return currentPath === item.href;
}

const itemClass =
  'flex min-h-11 items-center gap-2 rounded-control px-3 text-supporting font-medium text-text-muted transition-colors duration-fast hover:bg-surface hover:text-text aria-[current=page]:bg-surface aria-[current=page]:text-text';

/** Primary navigation: a vertical rail on wide screens, a bottom bar on phones. */
export function Navigation({ items, currentPath, renderLink, trailing, variant }: NavigationProps) {
  return (
    <nav
      aria-label="Primary"
      className={cn(
        variant === 'rail'
          ? 'flex flex-col gap-1 p-2'
          : 'grid auto-cols-fr grid-flow-col gap-1 p-1',
      )}
      data-navigation={variant}
    >
      {items.map((item) => {
        const current = isCurrentNavigationItem(item, currentPath);
        const Icon = item.icon;
        return (
          <div key={item.key} className="contents">
            {renderLink({
              href: item.href,
              className: cn(
                itemClass,
                variant === 'bottom' && 'flex-col justify-center gap-0.5 px-1 text-caption',
              ),
              'aria-current': current ? 'page' : undefined,
              children: (
                <>
                  <Icon aria-hidden="true" className="size-5 shrink-0" />
                  <span>{item.label}</span>
                </>
              ),
            })}
          </div>
        );
      })}
      {trailing}
    </nav>
  );
}

export { itemClass as navigationItemClass };
