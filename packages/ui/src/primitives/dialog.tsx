'use client';

import { X } from 'lucide-react';
import { Dialog as RadixDialog } from 'radix-ui';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from '../cn';
import { Button } from './button';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export interface DialogContentProps
  extends Omit<ComponentPropsWithoutRef<typeof RadixDialog.Content>, 'title'> {
  /** Required: every dialog has an accessible name. */
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly footer?: ReactNode;
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' } as const;

/**
 * App-owned dialog rendered through a portal so it escapes decorative
 * clipping. Focus moves into the dialog on open and returns to the trigger
 * on close (Radix behaviour, verified in tests).
 */
export function DialogContent({
  title,
  description,
  size = 'md',
  footer,
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-screen/70 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in" />
      <RadixDialog.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-panel border border-border/60 bg-surface-raised p-6 text-text shadow-xl focus-visible:outline-none',
          sizes[size],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <RadixDialog.Title className="text-heading-sm font-semibold">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="text-supporting text-text-muted">
                {description}
              </RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close dialog"
              className="-mt-1 -mr-2 px-2"
            >
              <X aria-hidden="true" className="size-5" />
            </Button>
          </RadixDialog.Close>
        </div>
        <div className="space-y-4">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 pt-2">{footer}</div> : null}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
