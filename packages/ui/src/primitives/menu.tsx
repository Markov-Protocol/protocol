'use client';

import { DropdownMenu } from 'radix-ui';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../cn';

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        className={cn(
          'z-30 min-w-48 rounded-control border border-border/60 bg-surface-raised p-1 text-text shadow-lg',
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

export interface MenuItemProps extends ComponentPropsWithoutRef<typeof DropdownMenu.Item> {
  readonly destructive?: boolean;
}

export function MenuItem({ className, destructive = false, ...props }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={cn(
        'flex min-h-10 cursor-default select-none items-center gap-2 rounded-[6px] px-3 text-body outline-none data-[highlighted]:bg-surface data-[disabled]:opacity-50',
        destructive ? 'text-error' : 'text-text',
        className,
      )}
      {...props}
    />
  );
}

export function MenuLabel({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn('px-3 py-1.5 text-caption uppercase tracking-wide text-text-muted', className)}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn('my-1 h-px bg-border/60', className)} {...props} />;
}
