import type { NodeType } from '@canvas-agent/domain'
import {
  Braces,
  CircleDot,
  Component,
  Goal,
  Lightbulb,
  LockKeyhole,
  PenLine,
  Route
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { StatusTone } from './status-tone'

const nodeTypeMeta: Record<NodeType, { label: string; tone: StatusTone; icon: typeof CircleDot }> =
  {
    IDEA: { label: 'Idea', tone: 'warning', icon: Lightbulb },
    GOAL: { label: 'Goal', tone: 'accent', icon: Goal },
    REQUIREMENT: { label: 'Requirement', tone: 'info', icon: Braces },
    CONSTRAINT: { label: 'Constraint', tone: 'warning', icon: LockKeyhole },
    DESIGN: { label: 'Design', tone: 'info', icon: PenLine },
    DECISION: { label: 'Decision', tone: 'success', icon: Route },
    COMPONENT: { label: 'Component', tone: 'accent', icon: Component }
  }

interface NodeTypeBadgeProps {
  readonly type: NodeType
}

export function NodeTypeBadge({ type }: NodeTypeBadgeProps): React.JSX.Element {
  const meta = nodeTypeMeta[type]
  const Icon = meta.icon

  return (
    <Badge tone={meta.tone}>
      <Icon className="size-3" aria-hidden="true" />
      {meta.label}
    </Badge>
  )
}

export type { NodeTypeBadgeProps }
