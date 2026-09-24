'use client';

import { Check, ChevronDown } from 'lucide-react';
import { Select } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { inputClassName } from './field';

export interface SelectOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
}

export interface SelectInputProps {
  readonly id?: string;
  readonly name?: string;
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly 'aria-describedby'?: string | undefined;
  readonly 'aria-invalid'?: true | undefined;
  readonly 'aria-required'?: true | undefined;
  readonly 'aria-label'?: string;
  readonly className?: string;
}

/** Radix select with keyboard navigation and typeahead; options are data, never HTML. */
export function SelectInput({
  id,
  name,
  value,
  onValueChange,
  options,
  placeholder = 'Select',
  disabled,
  className,
  ...aria
}: SelectInputProps) {
  return (
    <Select.Root
      onValueChange={onValueChange}
      {...(value !== null ? { value } : {})}
      {...(name !== undefined ? { name } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
    >
      <Select.Trigger
        id={id}
        aria-describedby={aria['aria-describedby']}
        aria-invalid={aria['aria-invalid']}
        aria-required={aria['aria-required']}
        aria-label={aria['aria-label']}
        className={cn(
          inputClassName,
          'flex items-center justify-between gap-2 text-left data-[placeholder]:text-text-muted/80',
          className,
        )}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon>
          <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={6}
          className="z-30 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-control border border-border/60 bg-surface-raised text-text shadow-lg"
        >
          <Select.Viewport className="p-1">
            {options.map((option) => (
              <Select.Item
                key={option.value}
                value={option.value}
                {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
                className="flex min-h-10 cursor-default select-none items-center gap-2 rounded-[6px] px-3 text-body outline-none data-[highlighted]:bg-surface data-[disabled]:opacity-50"
              >
                <span className="flex-1">
                  <Select.ItemText>{option.label}</Select.ItemText>
                  {option.description ? (
                    <span className="block text-supporting text-text-muted">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                <Select.ItemIndicator>
                  <Check aria-hidden="true" className="size-4 text-accent" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
