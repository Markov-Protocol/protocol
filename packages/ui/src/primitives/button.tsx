import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { Slot } from 'radix-ui';
import {
  type ButtonHTMLAttributes,
  forwardRef,
  type MouseEvent,
  type ReactNode,
  useId,
} from 'react';
import { cn } from '../cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-fast ease-markov select-none whitespace-nowrap aria-disabled:cursor-not-allowed aria-disabled:border aria-disabled:border-border aria-disabled:bg-surface-raised aria-disabled:text-text-muted aria-disabled:hover:bg-surface-raised disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-surface-raised disabled:text-text-muted',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-ink hover:bg-accent/90 active:bg-accent/80',
        secondary:
          'border border-border bg-surface text-text hover:bg-surface-raised active:bg-surface-raised/80',
        ghost: 'text-text hover:bg-surface-raised active:bg-surface-raised/80',
        danger: 'bg-error text-accent-ink hover:bg-error/90 active:bg-error/80',
      },
      size: {
        sm: 'min-h-9 px-3 text-supporting',
        md: 'min-h-11 px-4 text-body',
        lg: 'min-h-12 px-6 text-body',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a <button> (for example a Next.js Link). */
  readonly asChild?: boolean;
  /** Shows a spinner, announces busy state and blocks activation. */
  readonly loading?: boolean;
  /**
   * Explains why the action is unavailable. The button stays focusable and
   * readable (aria-disabled) and the reason is rendered as visible text
   * linked with aria-describedby, so no capability is silently hidden.
   */
  readonly disabledReason?: string;
  readonly leadingIcon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild = false,
    className,
    variant,
    size,
    loading = false,
    disabledReason,
    leadingIcon,
    children,
    onClick,
    type,
    disabled,
    ...props
  },
  ref,
) {
  const reasonId = useId();
  const Component = asChild ? Slot.Root : 'button';
  const blocked = loading || disabledReason !== undefined;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (blocked) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  const describedBy =
    disabledReason !== undefined
      ? cn(props['aria-describedby'], reasonId)
      : props['aria-describedby'];
  const button = (
    <Component
      ref={ref}
      type={asChild ? undefined : (type ?? 'button')}
      {...props}
      className={cn(buttonVariants({ variant, size }), className)}
      aria-disabled={blocked || disabled ? true : undefined}
      aria-busy={loading || undefined}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={handleClick}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : leadingIcon}
          {children}
        </>
      )}
    </Component>
  );
  if (disabledReason === undefined) {
    return button;
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {button}
      <span id={reasonId} className="text-supporting text-text-muted">
        {disabledReason}
      </span>
    </span>
  );
});
