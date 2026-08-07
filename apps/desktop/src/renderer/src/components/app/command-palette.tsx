import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, Command, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

export interface CommandItem {
  readonly id: string
  readonly label: string
  readonly hint?: string
  readonly shortcut?: string
  readonly icon: LucideIcon
}

interface CommandPaletteProps {
  readonly open: boolean
  readonly commands: readonly CommandItem[]
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (command: CommandItem) => void
}

export function CommandPalette({
  open,
  commands,
  onOpenChange,
  onSelect
}: CommandPaletteProps): React.JSX.Element | null {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLElement | null>(null)
  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return commands
    return commands.filter((command) =>
      `${command.label} ${command.hint ?? ''}`.toLowerCase().includes(normalized)
    )
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-foreground/20 px-4 pt-[12vh] backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false)
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="w-full max-w-[560px] overflow-hidden rounded-[var(--radius-panel)] border border-border bg-popover shadow-[0_18px_60px_rgb(15_23_42/0.22)]"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <h2 id="command-palette-title" className="sr-only">
            {t('palette.title')}
          </h2>
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onOpenChange(false)
              if (event.key === 'Enter' && filteredCommands[0]) onSelect(filteredCommands[0])
            }}
            placeholder={t('palette.searchPlaceholder')}
            className="h-11 border-0 px-0 shadow-none focus-visible:ring-0"
          />
          <kbd className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('palette.close')}
            onClick={() => onOpenChange(false)}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className="max-h-[min(460px,60vh)] overflow-y-auto p-2">
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {t('palette.commands')}
          </p>
          {filteredCommands.length ? (
            <ul className="space-y-0.5" role="listbox" aria-label={t('palette.commands')}>
              {filteredCommands.map((command) => {
                const Icon = command.icon
                return (
                  <li key={command.id}>
                    <button
                      type="button"
                      role="option"
                      className="flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-control)] px-2.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                      onClick={() => onSelect(command)}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded border border-border bg-muted text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {command.label}
                        </span>
                        {command.hint ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {command.hint}
                          </span>
                        ) : null}
                      </span>
                      {command.shortcut ? (
                        <kbd className="hidden shrink-0 text-[10px] text-muted-foreground sm:block">
                          {command.shortcut}
                        </kbd>
                      ) : (
                        <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className={cn('px-2 py-8 text-center text-[12px] text-muted-foreground')}>
              {t('palette.noMatches')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-border bg-muted/40 px-3 py-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Command className="size-3" aria-hidden="true" />
            {t('palette.navigate')}
          </span>
          <span>{t('palette.enterToRun')}</span>
          <span>{t('palette.escToClose')}</span>
        </div>
      </section>
    </div>
  )
}

export type { CommandPaletteProps }
