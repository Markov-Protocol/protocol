'use client';

import { Tabs as RadixTabs } from 'radix-ui';
import type { ComponentPropsWithoutRef } from 'react';
import { cn } from '../cn';

export const Tabs = RadixTabs.Root;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof RadixTabs.List>) {
  return (
    <RadixTabs.List
      className={cn('flex flex-wrap gap-1 border-b border-border/60', className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        'min-h-11 border-b-2 border-transparent px-3 text-body text-text-muted transition-colors duration-fast hover:text-text data-[state=active]:border-accent data-[state=active]:text-text',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof RadixTabs.Content>) {
  return (
    <RadixTabs.Content className={cn('pt-4 focus-visible:outline-none', className)} {...props} />
  );
}
