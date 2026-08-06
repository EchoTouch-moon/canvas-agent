import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { cn } from '@/lib/utils'

type TabsProps = Omit<React.ComponentProps<typeof BaseTabs.Root>, 'className'> & {
  className?: string
}

type TabsListProps = Omit<React.ComponentProps<typeof BaseTabs.List>, 'className'> & {
  className?: string
}

type TabsTriggerProps = Omit<React.ComponentProps<typeof BaseTabs.Tab>, 'className'> & {
  className?: string
}

type TabsContentProps = Omit<React.ComponentProps<typeof BaseTabs.Panel>, 'className'> & {
  className?: string
}

export function Tabs({ className, ...props }: TabsProps): React.JSX.Element {
  return (
    <BaseTabs.Root data-slot="tabs" className={cn('flex min-w-0 flex-col', className)} {...props} />
  )
}

export function TabsList({ className, ...props }: TabsListProps): React.JSX.Element {
  return (
    <BaseTabs.List
      data-slot="tabs-list"
      activateOnFocus
      className={cn('inline-flex min-h-9 items-center gap-1 border-b border-border', className)}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: TabsTriggerProps): React.JSX.Element {
  return (
    <BaseTabs.Tab
      data-slot="tabs-trigger"
      className={cn(
        'relative inline-flex h-9 items-center justify-center rounded-t-[var(--radius-control)] px-2.5 text-[12px] font-medium text-muted-foreground outline-none transition-colors after:absolute after:inset-x-2.5 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[active]:text-primary data-[active]:after:bg-primary disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: TabsContentProps): React.JSX.Element {
  return (
    <BaseTabs.Panel
      data-slot="tabs-content"
      className={cn('min-w-0 outline-none', className)}
      {...props}
    />
  )
}

export type { TabsProps, TabsListProps, TabsTriggerProps, TabsContentProps }
