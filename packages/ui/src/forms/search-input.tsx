'use client';

import { Search, X } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../cn';
import { inputClassName } from './field';

export interface SearchInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly clearLabel?: string;
}

/** Controlled search box with a leading icon and an explicit clear button. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onValueChange, clearLabel = 'Clear search', className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(
          inputClassName,
          'pr-11 pl-9 [&::-webkit-search-cancel-button]:hidden',
          className,
        )}
        {...props}
      />
      {value !== '' ? (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onValueChange('')}
          className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-control text-text-muted hover:bg-surface-raised hover:text-text"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  );
});
