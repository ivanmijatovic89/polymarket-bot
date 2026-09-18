'use client'

import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Command } from 'cmdk'
import { Check, ChevronsUpDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SelectOption = { value: string; label: string }

/** shadcn's Radix Popover + Command composition, styled for the dashboard. */
export function SearchableSelect({
  label,
  value,
  options,
  onChange,
  className,
  clearable = false,
  disabled = false,
}: {
  label: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  className?: string
  clearable?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find((option) => option.value === value)
  // Keep bookmarked values visible even if the current option scope has no match.
  const choices = selected || !value ? options : [{ value, label: value }, ...options]
  return (
    <div className={cn('flex min-w-0 items-center rounded-md border bg-background', className)}>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            disabled={disabled}
            title={selected?.label ?? value}
            className="flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            <span className="truncate">{selected?.label ?? (value || label)}</span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            aria-label={`${label} options`}
            align="start"
            sideOffset={5}
            className="z-50 w-[max(260px,var(--radix-popover-trigger-width))] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg"
          >
            <Command
              loop
              label={`Search ${label.toLowerCase()}`}
              defaultValue={selected?.label ?? value}
            >
              <div className="flex items-center gap-2 border-b px-3">
                <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <Command.Input
                  aria-label={`Search ${label.toLowerCase()}`}
                  placeholder={`Search ${label.toLowerCase()}…`}
                  className="h-9 w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
              </div>
              <Command.List
                label={`${label} options`}
                className="max-h-64 overflow-y-auto overscroll-contain p-1"
              >
                <Command.Empty className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No options found.
                </Command.Empty>
                {choices.map((option) => (
                  <Command.Item
                    key={option.value}
                    value={option.label}
                    keywords={[option.value]}
                    onSelect={() => {
                      onChange(option.value)
                      setOpen(false)
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-xs outline-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
                  >
                    <Check
                      className={cn('h-3.5 w-3.5 shrink-0', option.value !== value && 'invisible')}
                    />
                    <span className="break-all">{option.label}</span>
                  </Command.Item>
                ))}
              </Command.List>
            </Command>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {clearable && value && (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange('')}
          disabled={disabled}
          className="mr-1 rounded-sm p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
