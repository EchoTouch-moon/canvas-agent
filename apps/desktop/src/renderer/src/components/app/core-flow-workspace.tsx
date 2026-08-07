import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { RuntimeInfo } from '@canvas-agent/contracts'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardCheck,
  Code2,
  FileCheck2,
  FileClock,
  FileText,
  Filter,
  GitBranch,
  Info,
  Layers3,
  LockKeyhole,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  TestTube2,
  TriangleAlert,
  XCircle
} from 'lucide-react'
import { AppShell } from './app-shell'
import { EmptyState } from './empty-state'
import { FlowProgress } from './flow-progress'
import { PageToolbar } from './page-toolbar'
import {
  BaselineStatusBadge,
  NodeTypeBadge,
  RunOutcomeBadge,
  RunStatusBadge,
  SnapshotFreshnessBadge,
  StatusBadge,
  TaskStatusBadge,
  type StatusTone
} from '@/components/domain'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  createCoreFlowFixtureService,
  type ArtifactReviewStatus,
  type ArtifactTab,
  type ContextCandidate,
  type CoreFlowNode,
  type CoreFlowState,
  type FlowRoute,
  type NoticeTone
} from '@/data/core-flow-fixture'
import {
  coreFlowReducer,
  getFreezeBlockers,
  getSelectedContextItems,
  getSelectedContextTokens,
  type CoreFlowCommand
} from '@/state/core-flow-reducer'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

interface FlowScreenProps {
  readonly state: CoreFlowState
  readonly dispatch: Dispatch<CoreFlowCommand>
}

interface SectionProps {
  readonly title: string
  readonly icon: LucideIcon
  readonly eyebrow?: string
  readonly action?: ReactNode
  readonly className?: string
  readonly children: ReactNode
}

const sidebarRoutes: Readonly<Record<string, FlowRoute>> = {
  Dashboard: 'dashboard',
  Outline: 'outline',
  Nodes: 'node',
  Tasks: 'task',
  Context: 'context',
  Runs: 'run',
  Artifacts: 'artifact',
  Baselines: 'baseline'
}

const artifactTone: Record<ArtifactReviewStatus, StatusTone> = {
  READY: 'info',
  ACCEPTED: 'success',
  REJECTED: 'danger',
  CHANGES_REQUESTED: 'warning'
}

const artifactLabelKey: Record<ArtifactReviewStatus, string> = {
  READY: 'ready',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  CHANGES_REQUESTED: 'changesRequested'
}

const noticeIcon: Record<NoticeTone, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: XCircle
}

const noticeTitleZh: Record<string, string> = {
  'Node unavailable': '节点不可用',
  'Context item unavailable': '上下文项不可用',
  'Snapshot is read-only': '快照为只读',
  'Required item is pinned': '必选项已固定',
  'Snapshot is already frozen': '快照已冻结',
  'Freeze required before Run': '运行前需要冻结',
  'Run already started': '运行已开始',
  'Run transition blocked': '运行流转被阻止',
  'No mock step available': '没有可用的模拟步骤',
  'Run is not ready to finish': '运行尚未准备完成',
  'Task review gate unavailable': '任务审核门槛不可用',
  'Run evidence required': '需要运行证据',
  'Apply is separate from accept': '应用与接受相互独立',
  'Acceptance evaluation is gated': '验收评估被限制',
  'Task is not awaiting review': '任务不在待审核状态',
  'Task completion blocked': '任务完成被阻止',
  'Task transition blocked': '任务流转被阻止',
  'Task completion required': '需要先完成任务',
  'Baseline is not activatable': '基线不可激活',
  'Context item removed': '已移除上下文项',
  'Context item added': '已添加上下文项',
  'Snapshot frozen': '快照已冻结',
  'Run queued': '运行已排队',
  'Worker preparing': 'Worker 准备中',
  'Run executing': '运行执行中',
  'Run succeeded': '运行成功',
  'Artifact applied': '产物已应用',
  'Artifact accepted': '产物已接受',
  'Artifact already accepted': '产物已被接受',
  'Artifact rejected': '产物已拒绝',
  'Changes requested': '已请求变更',
  'Acceptance evaluated': '已评估验收',
  'Task completed': '任务已完成',
  'Baseline activated': '基线已激活',
  'Freeze blocked': '冻结被阻止'
}

const noticeMessageZh: Record<string, string> = {
  'That node is not present in the current fixture.': '该节点不在当前 fixture 中。',
  'Choose an item from the fixture list.': '请从 fixture 列表中选择一项。',
  'Frozen context cannot be changed. Create a new draft snapshot for another Run.':
    '冻结的上下文不可更改。请为下一次运行创建新的草稿快照。',
  'Starting a Run is a separate action.': '启动运行是独立操作。',
  'Resolve ContextSnapshot blockers and freeze the selected context first.':
    '请先解决上下文快照的阻止项并冻结所选上下文。',
  'Continue the existing Run from its timeline.': '请从时间线继续现有运行。',
  'The mock Run cannot enter the queue from its current state.': '模拟运行无法从当前状态进入队列。',
  'Start or finish the Run from its current timeline state.': '请从当前时间线状态启动或完成运行。',
  'Advance the mock Run until it is executing.': '请推进模拟运行，直到其进入执行状态。',
  'The Task cannot enter review from its current status.': '任务无法从当前状态进入审核。',
  'Apply is available after a succeeded Run.': '运行成功后才可应用。',
  'Accept is available after a succeeded Run.': '运行成功后才可接受。',
  'This artifact has already been accepted.': '该产物已被接受。',
  'The patch is applied and human review is recorded. Task completion remains a separate explicit action.':
    '补丁已应用并记录人工审核。完成任务仍是独立的显式操作。',
  'The patch is applied to the mock workspace; it is not accepted yet.':
    '补丁已应用到模拟工作区，但尚未被接受。',
  'Apply the reviewed artifact before accepting it.': '在接受前请先应用已审核的产物。',
  'Task completion remains a separate explicit action.': '任务完成仍是独立的显式操作。',
  'The Task remains open and the Baseline stays Draft.': '任务保持开启，基线保持草稿状态。',
  'The Run result remains evidence; a new attempt is required for review.':
    '运行结果仍是证据；需要新的尝试才能进入审核。',
  'Accept the Artifact while the Task is Waiting review before evaluating criteria.':
    '在任务处于待审核状态时接受产物，再评估验收标准。',
  'All six criteria are recorded as passed; completing the Task is still separate.':
    '六项标准均已记录为通过；完成任务仍是独立操作。',
  'A succeeded Run must enter Waiting review first.': '成功的运行必须先进入待审核状态。',
  'Accept the Artifact and evaluate acceptance before completing the Task.':
    '完成任务前请先接受产物并评估验收。',
  'The domain transition does not allow completion here.': '域流转不允许在此处完成。',
  'Baseline 1.1 remains Draft until its own activation confirmation.':
    '基线 1.1 在自身激活确认前保持草稿状态。',
  'Complete the accepted Task before activating a Baseline.': '激活基线前请先完成已被接受的任务。',
  'Only a Draft Baseline can be activated once.': '只有草稿基线可以被激活一次。',
  'Baseline 1.1 is now the active project anchor.': '基线 1.1 现在是当前项目锚点。',
  'Worker preparation is visible in the timeline as a separate step.':
    'Worker 准备在时间线中作为独立步骤可见。',
  'The next explicit mock action starts execution.': '下一个显式模拟动作将开始执行。',
  'RUN-009 is still separate from Task acceptance.': 'RUN-009 仍独立于任务验收。',
  'Selected context is now read-only. Starting RUN-009 remains a separate action.':
    '所选上下文现已只读。启动 RUN-009 仍是独立操作。'
}

function translateNoticeTitle(title: string): string {
  return noticeTitleZh[title] ?? title
}

function translateNoticeMessage(title: string, message: string): string {
  const exact = noticeMessageZh[message]
  if (exact) return exact
  if (title === 'Required item is pinned') {
    const label = message.split(' is required')[0]
    return `${label} 由 TaskSpecVersion 强制要求，不可移除。`
  }
  if (title === 'Context item added') {
    const label = message.split(' is now selected')[0]
    return `${label} 已加入快照草稿 04。`
  }
  if (title === 'Context item removed') {
    const label = message.split(' is no longer selected')[0]
    return `${label} 已从快照草稿 04 移除。`
  }
  if (title === 'Freeze blocked') {
    const rest = message.replace('Snapshot stays Draft. ', '')
    return `快照保持草稿状态。${rest}`
  }
  return message
}

function translateBlocker(blocker: string): string {
  const conflict = /^(.+) conflicts with (.+)\.$/.exec(blocker)
  if (conflict) {
    return `${conflict[1]} 与 ${conflict[2]} 冲突。`
  }
  const overflow = /^Selected context uses (.+?) tokens, over the (.+?) token budget\.$/.exec(
    blocker
  )
  if (overflow) {
    return `所选上下文使用 ${overflow[1]} 个 Token，超出 ${overflow[2]} 的 Token 预算。`
  }
  return blocker
}

function Section({
  title,
  icon: Icon,
  eyebrow,
  action,
  className,
  children
}: SectionProps): React.JSX.Element {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-[var(--radius-panel)] border border-border bg-card',
        className
      )}
    >
      <header className="flex min-h-11 items-center gap-2 border-b border-border px-3.5">
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {eyebrow}
            </p>
          ) : null}
          <h2 className="truncate text-[12px] font-semibold">{title}</h2>
        </div>
        {action}
      </header>
      <div className="p-3.5">{children}</div>
    </section>
  )
}

function Notice({ notice }: Pick<CoreFlowState, 'notice'>): React.JSX.Element | null {
  const { locale } = useI18n()
  if (!notice) return null
  const Icon = noticeIcon[notice.tone]
  const toneClass = {
    info: 'border-status-info/30 bg-status-info/8 text-status-info',
    success: 'border-status-success/30 bg-status-success/8 text-status-success',
    warning: 'border-status-warning/30 bg-status-warning/8 text-status-warning',
    danger: 'border-status-danger/30 bg-status-danger/8 text-status-danger'
  }[notice.tone]
  const title = locale === 'zh' ? translateNoticeTitle(notice.title) : notice.title
  const message =
    locale === 'zh' ? translateNoticeMessage(notice.title, notice.message) : notice.message

  return (
    <div
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-[var(--radius-control)] border px-3 py-2.5',
        toneClass
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[11px] leading-5 text-foreground/75">{message}</p>
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  detail
}: {
  readonly label: string
  readonly value: string
  readonly detail: string
}): React.JSX.Element {
  return (
    <div className="min-w-0 border-l border-border pl-3 first:border-l-0 first:pl-0">
      <p className="text-[9px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-1 truncate text-[16px] font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  )
}

function FlowInspector({ state }: { readonly state: CoreFlowState }): React.JSX.Element {
  const { t } = useI18n()
  const selectedTokens = getSelectedContextTokens(state)
  const selectedCount = state.selectedContextItemIds.length

  return (
    <div className="space-y-3">
      <Section
        title={t('gates.formalGates')}
        icon={ShieldCheck}
        eyebrow={t('gates.explicitTransitions')}
      >
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{t('gates.snapshot')}</span>
            <StatusBadge status={state.snapshot.status} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{t('gates.runStatus')}</span>
            <RunStatusBadge status={state.run.status} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{t('gates.runOutcome')}</span>
            {state.run.outcome ? (
              <RunOutcomeBadge outcome={state.run.outcome} />
            ) : (
              <Badge>{t('gates.pending')}</Badge>
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{t('gates.task')}</span>
            <TaskStatusBadge status={state.task.status} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{t('gates.artifact')}</span>
            <Badge tone={artifactTone[state.artifact.reviewStatus]}>
              {t(`artifactLabel.${artifactLabelKey[state.artifact.reviewStatus]}`)}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">{t('gates.baseline')}</span>
            <BaselineStatusBadge status={state.baseline.status} />
          </div>
        </div>
      </Section>

      <Section title={t('gates.contextSnapshot')} icon={Layers3}>
        <div className="grid grid-cols-2 gap-2">
          <Stat label={t('gates.selected')} value={`${selectedCount}`} detail={t('gates.items')} />
          <Stat
            label={t('gates.tokens')}
            value={selectedTokens.toLocaleString()}
            detail={t('gates.ofTokens', { n: state.snapshot.tokenBudget.toLocaleString() })}
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <SnapshotFreshnessBadge freshness={state.snapshot.freshness} />
          <span className="truncate text-[10px] text-muted-foreground">
            {state.snapshot.revision}
          </span>
        </div>
      </Section>

      <Section title={t('gates.readOnlyReminder')} icon={LockKeyhole}>
        <p className="text-[11px] leading-5 text-muted-foreground">
          {t('gates.readOnlyReminderDesc')}
        </p>
      </Section>
    </div>
  )
}

function DashboardScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const { t } = useI18n()
  const passedCriteria = state.task.criteria.filter((criterion) => criterion.passed).length
  const previousRun = state.priorRuns[0]

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow={t('dashboard.eyebrow')}
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        meta={
          <>
            <Badge tone="accent">{t('dashboard.typedFixture')}</Badge>
            <Badge tone="neutral">{t('dashboard.mockService')}</Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'outline' })}
          >
            {t('dashboard.openOutline')} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />

      <section className="rounded-[var(--radius-panel)] border border-border bg-card p-4">
        <div className="flex flex-wrap items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-foreground text-base font-semibold text-background">
            M
          </span>
          <div className="min-w-[220px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold">{state.project.name}</h2>
              <Badge tone="success">{t('dashboard.workspaceReady')}</Badge>
            </div>
            <p className="mt-1 max-w-xl text-[12px] leading-5 text-muted-foreground">
              {state.project.description}
            </p>
          </div>
          <div className="grid min-w-[300px] flex-1 grid-cols-3 gap-4 sm:max-w-[420px]">
            <Stat label={t('dashboard.task')} value={state.task.id} detail={t('flow.task.label')} />
            <Stat
              label={t('dashboard.snapshot')}
              value={`${state.selectedContextItemIds.length}`}
              detail={t('dashboard.selectedItems')}
            />
            <Stat
              label={t('dashboard.baseline')}
              value={state.project.activeBaseline}
              detail={t('dashboard.activeAnchor')}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title={t('dashboard.activeTask')}
          icon={FileClock}
          action={<TaskStatusBadge status={state.task.status} />}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">{state.task.title}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {state.task.objective}
              </p>
            </div>
            <Button size="sm" onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}>
              {t('dashboard.openTask')} <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-border pt-3">
            <div
              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={t('dashboard.criteriaPassed', {
                a: passedCriteria,
                b: state.task.criteria.length
              })}
              aria-valuemin={0}
              aria-valuemax={state.task.criteria.length}
              aria-valuenow={passedCriteria}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${(passedCriteria / state.task.criteria.length) * 100}%` }}
              />
            </div>
            <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
              {t('dashboard.criteriaCount', { a: passedCriteria, b: state.task.criteria.length })}
            </span>
          </div>
        </Section>

        <Section
          title={t('dashboard.latestException')}
          icon={TriangleAlert}
          action={
            previousRun ? (
              <RunOutcomeBadge outcome={previousRun.outcome ?? 'PARTIAL'} />
            ) : (
              <Badge>{t('dashboard.none')}</Badge>
            )
          }
        >
          {previousRun ? (
            <div className="flex items-start gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-control)] border border-status-warning/25 bg-status-warning/10 text-status-warning">
                <AlertTriangle className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[12px] font-medium">{previousRun.id}</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {t('dashboard.previousEvidence')}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: 'NAVIGATE', route: 'run' })}
              >
                {t('dashboard.reviewRun')}
              </Button>
            </div>
          ) : (
            <EmptyState
              title={t('dashboard.noPreviousException')}
              description={t('dashboard.noPreviousExceptionDesc')}
              compact
            />
          )}
        </Section>
      </div>

      <Section
        title={t('dashboard.nextAction')}
        icon={Sparkles}
        eyebrow={t('dashboard.noHiddenAutomation')}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium">{t('dashboard.inspectTask')}</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {t('dashboard.noSilentChain')}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
          >
            {t('dashboard.continueTaskFlow')}
          </Button>
        </div>
      </Section>
    </div>
  )
}

function NodeRow({
  node,
  selected,
  onSelect
}: {
  readonly node: CoreFlowNode
  readonly selected: boolean
  readonly onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        selected ? 'border-primary/35 bg-accent' : 'border-border bg-background hover:bg-muted'
      )}
      onClick={onSelect}
    >
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-[var(--radius-control)] bg-muted text-muted-foreground">
        <CircleDot className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold">{node.title}</span>
          <NodeTypeBadge type={node.type} />
        </span>
        <span className="mt-1 block truncate text-[10px] text-muted-foreground">
          {node.summary}
        </span>
      </span>
      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{node.version}</span>
    </button>
  )
}

function OutlineScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const { t } = useI18n()
  const selectedNode =
    state.nodes.find((node) => node.id === state.selectedNodeId) ?? state.nodes[0]

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow={t('outline.eyebrow')}
        title={t('outline.title')}
        description={t('outline.description')}
        actions={
          <Button onClick={() => dispatch({ type: 'NAVIGATE', route: 'node' })}>
            {t('outline.openNodeWorkspace')} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Section
          title={t('outline.nodeOutline')}
          icon={GitBranch}
          eyebrow={t('outline.activeVersions')}
        >
          <div className="space-y-2">
            {state.nodes.map((node) => (
              <NodeRow
                key={node.id}
                node={node}
                selected={node.id === selectedNode.id}
                onSelect={() => dispatch({ type: 'SELECT_NODE', nodeId: node.id })}
              />
            ))}
          </div>
        </Section>
        <Section
          title={t('outline.selectedNode')}
          icon={CircleDot}
          action={<NodeTypeBadge type={selectedNode.type} />}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h3 className="text-[16px] font-semibold">{selectedNode.title}</h3>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {selectedNode.summary}
              </p>
            </div>
            <Badge tone="success">{t(`status.${selectedNode.lifecycle}`)}</Badge>
          </div>
          <Separator className="my-3" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
            <dt className="text-muted-foreground">{t('outline.nodeId')}</dt>
            <dd className="truncate text-right font-mono">{selectedNode.id}</dd>
            <dt className="text-muted-foreground">{t('outline.currentVersion')}</dt>
            <dd className="text-right font-medium">{selectedNode.version}</dd>
            <dt className="text-muted-foreground">{t('outline.linkedRecords')}</dt>
            <dd className="text-right font-medium tabular-nums">{selectedNode.links.length}</dd>
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {selectedNode.links.map((link) => (
              <Badge key={link} tone="neutral">
                {link}
              </Badge>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
            >
              {t('outline.viewLinkedTask')}
            </Button>
            <Button size="sm" onClick={() => dispatch({ type: 'NAVIGATE', route: 'context' })}>
              {t('outline.composeContext')}
            </Button>
          </div>
        </Section>
      </div>
    </div>
  )
}

function TaskScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const { t } = useI18n()
  const gatesRef = useRef<HTMLDivElement>(null)
  const previousEvaluated = useRef(state.task.acceptanceEvaluated)
  const passedCriteria = state.task.criteria.filter((criterion) => criterion.passed).length
  const canComplete =
    state.task.status === 'WAITING_REVIEW' && state.artifact.reviewStatus === 'ACCEPTED'

  useEffect(() => {
    if (state.task.acceptanceEvaluated && !previousEvaluated.current) {
      gatesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
    previousEvaluated.current = state.task.acceptanceEvaluated
  }, [state.task.acceptanceEvaluated])

  const gateBlock = (() => {
    if (state.run.outcome !== 'SUCCEEDED') {
      return { message: t('gates.hintRunFirst'), route: 'run' as FlowRoute | null }
    }
    if (state.artifact.reviewStatus !== 'ACCEPTED') {
      return { message: t('gates.hintAcceptFirst'), route: 'artifact' as FlowRoute | null }
    }
    return null
  })()
  const gateRoute = gateBlock?.route

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow={t('task.eyebrow')}
        title={state.task.title}
        description={t('task.description')}
        meta={
          <>
            <TaskStatusBadge status={state.task.status} />
            <Badge tone="neutral">{state.task.type}</Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'context' })}
          >
            {t('task.openContextComposer')} <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Section title={t('task.taskSpec')} icon={ClipboardCheck} eyebrow={state.task.id}>
          <p className="text-[13px] font-semibold">{t('task.objective')}</p>
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">{state.task.objective}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-[11px] font-semibold">{t('task.nonGoals')}</h3>
              <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                {state.task.nonGoals.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span
                      className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-[11px] font-semibold">{t('task.targets')}</h3>
              <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                {state.task.targets.map((item) => (
                  <li key={item} className="flex gap-2">
                    <Check
                      className="mt-0.5 size-3.5 shrink-0 text-status-success"
                      aria-hidden="true"
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <Section
          title={t('task.acceptanceCriteria')}
          icon={ClipboardCheck}
          action={
            <Badge tone={passedCriteria === state.task.criteria.length ? 'success' : 'warning'}>
              {t('dashboard.criteriaCount', { a: passedCriteria, b: state.task.criteria.length })}
            </Badge>
          }
        >
          <ol className="space-y-2">
            {state.task.criteria.map((criterion) => (
              <li key={criterion.id} className="flex items-start gap-2 text-[11px]">
                {criterion.passed ? (
                  <CheckCircle2
                    className="mt-0.5 size-3.5 shrink-0 text-status-success"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleDot
                    className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    'leading-5',
                    criterion.passed ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {criterion.label}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-border pt-3 text-[10px] leading-4 text-muted-foreground">
            {t('task.criteriaNote')}
          </p>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title={t('task.currentSnapshot')}
          icon={Layers3}
          action={<StatusBadge status={state.snapshot.status} />}
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium">{state.snapshot.label}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">{state.snapshot.revision}</p>
            </div>
            <SnapshotFreshnessBadge freshness={state.snapshot.freshness} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3">
            <Stat
              label={t('gates.selected')}
              value={`${state.selectedContextItemIds.length}`}
              detail={t('gates.items')}
            />
            <Stat
              label={t('gates.tokens')}
              value={getSelectedContextTokens(state).toLocaleString()}
              detail={t('gates.ofTokens', { n: state.snapshot.tokenBudget.toLocaleString() })}
            />
            <Stat
              label={t('task.frozen')}
              value={state.snapshot.frozenAt ?? t('task.draft')}
              detail={t('task.snapshotState')}
            />
          </div>
        </Section>

        <Section
          title={t('task.runEvidence')}
          icon={TestTube2}
          action={
            state.run.outcome ? (
              <RunOutcomeBadge outcome={state.run.outcome} />
            ) : (
              <RunStatusBadge status={state.run.status} />
            )
          }
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[12px] font-medium">{state.run.id}</p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {t('task.runEvidenceNote')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: 'NAVIGATE', route: 'run' })}
            >
              {t('task.openTimeline')}
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <TaskStatusBadge status={state.task.status} />
            {state.task.acceptanceEvaluated ? (
              <Badge tone="success">
                <Check className="size-3" aria-hidden="true" />
                {t('task.acceptanceEvaluated')}
              </Badge>
            ) : (
              <Badge tone="warning">
                <TriangleAlert className="size-3" aria-hidden="true" />
                {t('task.evaluationPending')}
              </Badge>
            )}
          </div>
        </Section>
      </div>

      <div ref={gatesRef} className="scroll-mt-4">
        <Section
          title={t('task.completeTask')}
          icon={ShieldCheck}
          eyebrow={t('task.separateCommands')}
        >
          {gateBlock ? (
            <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-status-warning/30 bg-status-warning/8 px-3 py-2">
              <TriangleAlert className="size-3.5 shrink-0 text-status-warning" aria-hidden="true" />
              <span className="text-[11px] text-foreground/80">{gateBlock.message}</span>
              {gateRoute ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded text-[11px] font-semibold text-status-warning outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => dispatch({ type: 'NAVIGATE', route: gateRoute })}
                >
                  {t('progress.go')} <ArrowRight className="size-3" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] leading-5 text-muted-foreground">
                {t('task.completeHint', { run: state.run.id })}
              </p>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => dispatch({ type: 'COMPLETE_TASK' })}
                  disabled={!canComplete}
                >
                  <Check className="size-3.5" aria-hidden="true" />
                  {t('task.completeTask')}
                </Button>
              </div>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function ContextCandidateRow({
  item,
  selected,
  readOnly,
  order,
  onToggle
}: {
  readonly item: ContextCandidate
  readonly selected: boolean
  readonly readOnly: boolean
  readonly order: number | null
  readonly onToggle: () => void
}): React.JSX.Element {
  const { t, locale } = useI18n()
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 transition-colors',
        selected ? 'border-primary/30 bg-accent/60' : 'border-border bg-background hover:bg-muted',
        readOnly && 'cursor-default opacity-80'
      )}
    >
      <input
        type="checkbox"
        checked={selected}
        disabled={readOnly || (item.required && selected)}
        aria-label={t('context.includeAria', { label: item.label })}
        className="mt-0.5 size-3.5 accent-[var(--primary)]"
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-[12px] font-semibold">{item.label}</span>
          {item.required ? (
            <Badge tone="success">{t('context.required')}</Badge>
          ) : (
            <Badge tone="neutral">{t('context.optional')}</Badge>
          )}
          <Badge tone={item.priority === 'P0' ? 'warning' : 'neutral'}>{item.priority}</Badge>
        </span>
        <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
          {item.description}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[9px] font-medium text-muted-foreground uppercase">
          <span>{item.type.replaceAll('_', ' ')}</span>
          <span aria-hidden="true">·</span>
          <span>{item.authority.replaceAll('_', ' ')}</span>
          {item.conflictsWith ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="text-status-danger">{locale === 'zh' ? '冲突' : 'Conflicts'}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-right">
        {order !== null ? (
          <span className="block text-[10px] font-semibold text-primary">#{order}</span>
        ) : null}
        <span className="mt-1 block text-[10px] tabular-nums text-muted-foreground">
          {item.tokens.toLocaleString()} t
        </span>
      </span>
    </label>
  )
}

function ContextScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const { t, locale } = useI18n()
  const [query, setQuery] = useState('')
  const selectedItems = getSelectedContextItems(state)
  const blockers = getFreezeBlockers(state)
  const selectedTokens = getSelectedContextTokens(state)
  const readOnly = state.snapshot.status !== 'DRAFT'
  const selectedOrder = new Map(selectedItems.map((item, index) => [item.id, index + 1]))
  const filteredItems = state.contextItems.filter((item) =>
    `${item.label} ${item.description} ${item.type}`.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow={t('context.eyebrow')}
        title={t('context.title')}
        description={t('context.description')}
        meta={
          <>
            <StatusBadge status={state.snapshot.status} />
            <SnapshotFreshnessBadge freshness={state.snapshot.freshness} />
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t('context.backToTask')}
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Section
          title={t('context.candidates')}
          icon={Search}
          eyebrow={t('context.available', { n: filteredItems.length })}
          action={
            <div className="relative w-44">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label={t('context.filterAria')}
                placeholder={t('context.filterCandidates')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-7 pl-7 text-[11px]"
              />
            </div>
          }
        >
          <div className="space-y-2">
            {filteredItems.map((item) => (
              <ContextCandidateRow
                key={item.id}
                item={item}
                selected={state.selectedContextItemIds.includes(item.id)}
                readOnly={readOnly}
                order={selectedOrder.get(item.id) ?? null}
                onToggle={() => dispatch({ type: 'TOGGLE_CONTEXT_ITEM', itemId: item.id })}
              />
            ))}
          </div>
          {filteredItems.length === 0 ? (
            <EmptyState
              icon={Search}
              title={t('context.noCandidates')}
              description={t('context.noCandidatesDesc')}
              compact
            />
          ) : null}
        </Section>

        <div className="space-y-4">
          <Section
            title={t('context.selectionPreview')}
            icon={Filter}
            action={
              <Badge tone={selectedTokens > state.snapshot.tokenBudget ? 'danger' : 'accent'}>
                {selectedTokens.toLocaleString()} / {state.snapshot.tokenBudget.toLocaleString()} t
              </Badge>
            }
          >
            <div className="flex items-center justify-between gap-3 text-[11px]">
              <span className="text-muted-foreground">{t('context.selectedContext')}</span>
              <span className="font-semibold tabular-nums">
                {t('context.selectedItemsCount', { n: selectedItems.length })}
              </span>
            </div>
            <div className="mt-3 space-y-1.5">
              {selectedItems.map((item, index) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-[var(--radius-control)] bg-muted/60 px-2.5 py-2 text-[10px]"
                >
                  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-background font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  {item.required ? (
                    <LockKeyhole
                      className="size-3.5 shrink-0 text-status-success"
                      aria-label={t('context.requiredItem')}
                    />
                  ) : (
                    <button
                      type="button"
                      className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      aria-label={t('context.removeAria', { label: item.label })}
                      disabled={readOnly}
                      onClick={() => dispatch({ type: 'TOGGLE_CONTEXT_ITEM', itemId: item.id })}
                    >
                      <XCircle className="size-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {item.tokens.toLocaleString()} t
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title={t('context.freezeConfirmation')} icon={LockKeyhole}>
            {blockers.length > 0 && !readOnly ? (
              <div
                className="rounded-[var(--radius-control)] border border-status-danger/30 bg-status-danger/8 p-3"
                role="alert"
              >
                <p className="flex items-center gap-2 text-[11px] font-semibold text-status-danger">
                  <TriangleAlert className="size-3.5" aria-hidden="true" />
                  {t('context.freezeBlocked')}
                </p>
                <ul className="mt-2 space-y-1 text-[10px] leading-4 text-foreground/75">
                  {blockers.map((blocker) => (
                    <li key={blocker}>{locale === 'zh' ? translateBlocker(blocker) : blocker}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-[11px] leading-5 text-muted-foreground">
              {readOnly ? t('context.readOnlyNote') : t('context.freezeNote')}
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
              >
                {t('context.keepEditing')}
              </Button>
              {readOnly ? (
                <Button
                  size="sm"
                  onClick={() => dispatch({ type: 'START_RUN' })}
                  disabled={state.run.status !== 'CREATED'}
                >
                  <Play className="size-3.5" aria-hidden="true" />
                  {t('context.startRun')}
                </Button>
              ) : (
                <Button size="sm" onClick={() => dispatch({ type: 'FREEZE_SNAPSHOT' })}>
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  {t('context.freezeSnapshot')}
                </Button>
              )}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

function runStepLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  status: CoreFlowState['run']['status']
): string {
  if (status === 'CREATED') return t('run.startRun')
  if (status === 'QUEUED') return t('run.prepareWorker')
  if (status === 'PREPARING') return t('run.startExecution')
  if (status === 'RUNNING') return t('run.finishSucceededRun')
  return t('run.runFinished')
}

function RunTimeline({
  events
}: {
  readonly events: CoreFlowState['run']['timeline']
}): React.JSX.Element {
  const { t } = useI18n()
  return (
    <ol className="space-y-3">
      {events.map((event) => {
        const Icon =
          event.state === 'complete'
            ? CheckCircle2
            : event.state === 'warning'
              ? TriangleAlert
              : event.state === 'active'
                ? RefreshCw
                : CircleDot
        const iconClass =
          event.state === 'complete'
            ? 'text-status-success'
            : event.state === 'warning'
              ? 'text-status-warning'
              : event.state === 'active'
                ? 'text-status-info'
                : 'text-muted-foreground'
        return (
          <li key={event.id} className="flex gap-3">
            <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-border bg-background">
              <Icon
                className={cn('size-3.5', iconClass, event.state === 'active' && 'animate-spin')}
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold">{event.label}</p>
              <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{event.detail}</p>
            </div>
            <Badge
              tone={
                event.state === 'complete'
                  ? 'success'
                  : event.state === 'warning'
                    ? 'warning'
                    : event.state === 'active'
                      ? 'info'
                      : 'neutral'
              }
            >
              {t(`timelineState.${event.state}`)}
            </Badge>
          </li>
        )
      })}
    </ol>
  )
}

function RunScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const { t } = useI18n()
  const previousRun = state.priorRuns[0]
  const canStart = state.snapshot.status === 'FROZEN' && state.run.status === 'CREATED'
  const canAdvance = state.run.status === 'QUEUED' || state.run.status === 'PREPARING'
  const canFinish = state.run.status === 'RUNNING'

  useEffect(() => {
    if (state.run.status === 'QUEUED' || state.run.status === 'PREPARING') {
      const timer = window.setTimeout(() => {
        dispatch({ type: 'ADVANCE_RUN' })
      }, 900)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [dispatch, state.run.status])

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow={t('run.eyebrow')}
        title={t('run.title', { id: state.run.id })}
        description={t('run.description')}
        meta={
          <>
            <RunStatusBadge status={state.run.status} />
            {state.run.outcome ? (
              <RunOutcomeBadge outcome={state.run.outcome} />
            ) : (
              <Badge tone="neutral">{t('run.outcomePending')}</Badge>
            )}
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'context' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t('run.contextSnapshotBack')}
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Section title={t('run.runState')} icon={Play} eyebrow={t('run.statusOutcomeSeparate')}>
          <div className="flex flex-wrap items-center gap-2">
            <RunStatusBadge status={state.run.status} />
            {state.run.outcome ? (
              <RunOutcomeBadge outcome={state.run.outcome} />
            ) : (
              <Badge tone="neutral">{t('run.noOutcomeYet')}</Badge>
            )}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-[11px]">
            <dt className="text-muted-foreground">{t('run.contextSnapshot')}</dt>
            <dd className="truncate text-right font-mono">{state.snapshot.id}</dd>
            <dt className="text-muted-foreground">{t('run.started')}</dt>
            <dd className="text-right">{state.run.startedAt ?? t('run.notStarted')}</dd>
            <dt className="text-muted-foreground">{t('run.taskStatus')}</dt>
            <dd className="flex justify-end">
              <TaskStatusBadge status={state.task.status} />
            </dd>
            <dt className="text-muted-foreground">{t('run.artifactReview')}</dt>
            <dd className="flex justify-end">
              <Badge tone={artifactTone[state.artifact.reviewStatus]}>
                {t(`artifactLabel.${artifactLabelKey[state.artifact.reviewStatus]}`)}
              </Badge>
            </dd>
          </dl>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {state.run.status === 'FINISHED' ? (
              <Button onClick={() => dispatch({ type: 'NAVIGATE', route: 'artifact' })}>
                {t('run.reviewArtifact')} <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                onClick={() =>
                  state.run.status === 'CREATED'
                    ? dispatch({ type: 'START_RUN' })
                    : state.run.status === 'RUNNING'
                      ? dispatch({ type: 'FINISH_RUN' })
                      : dispatch({ type: 'ADVANCE_RUN' })
                }
                disabled={
                  (state.run.status === 'CREATED' && !canStart) ||
                  (canAdvance === false && !canFinish && state.run.status !== 'CREATED')
                }
              >
                {state.run.status === 'CREATED' ? (
                  <Play className="size-3.5" aria-hidden="true" />
                ) : canFinish ? (
                  <Check className="size-3.5" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                )}
                {runStepLabel(t, state.run.status)}
              </Button>
            )}
          </div>
          {state.run.status === 'CREATED' && !canStart ? (
            <p className="mt-2 text-right text-[10px] text-status-warning">
              {t('run.freezeBeforeRun')}
            </p>
          ) : state.run.status === 'QUEUED' ||
            state.run.status === 'PREPARING' ||
            state.run.status === 'RUNNING' ? (
            <p className="mt-2 text-right text-[10px] text-muted-foreground">
              {t(
                state.run.status === 'QUEUED'
                  ? 'progress.nextRunQueued'
                  : state.run.status === 'PREPARING'
                    ? 'progress.nextRunPreparing'
                    : 'progress.nextRunRunning'
              )}
            </p>
          ) : null}
        </Section>

        <Section title={t('run.executionTimeline')} icon={RefreshCw}>
          <RunTimeline events={state.run.timeline} />
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title={t('run.testEvidence')}
          icon={TestTube2}
          action={
            <Badge tone="success">
              {t('run.testsPassed', {
                n: state.run.tests.filter((test) => test.status === 'PASSED').length
              })}
            </Badge>
          }
        >
          <ul className="space-y-2">
            {state.run.tests.map((test) => (
              <li key={test.id} className="flex items-start gap-2 text-[11px]">
                <CheckCircle2
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0',
                    test.status === 'PASSED' ? 'text-status-success' : 'text-status-danger'
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{test.label}</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    {test.detail}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {state.run.outcome === 'SUCCEEDED' ? (
            <p className="mt-3 border-t border-border pt-3 text-[10px] leading-4 text-muted-foreground">
              {t('run.runSuccessNote', {
                status:
                  state.task.status === 'WAITING_REVIEW'
                    ? t('run.waitingReview')
                    : t(`status.${state.task.status}`)
              })}
            </p>
          ) : null}
        </Section>

        <Section
          title={t('run.previousPartial')}
          icon={TriangleAlert}
          action={<RunOutcomeBadge outcome={previousRun?.outcome ?? 'PARTIAL'} />}
        >
          {previousRun ? (
            <details className="group rounded-[var(--radius-control)] border border-border bg-background p-3">
              <summary className="cursor-pointer list-none text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                {t('run.expandFailedEvidence')}
                <span className="float-right text-muted-foreground group-open:rotate-90">
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </span>
              </summary>
              <div className="mt-3 border-t border-border pt-3">
                {previousRun.tests.map((test) => (
                  <div key={test.id} className="flex items-start gap-2 text-[10px]">
                    <XCircle
                      className="mt-0.5 size-3.5 shrink-0 text-status-danger"
                      aria-hidden="true"
                    />
                    <span>
                      <span className="font-medium">{test.label}</span>
                      <span className="mt-0.5 block leading-4 text-muted-foreground">
                        {test.detail}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <EmptyState
              title={t('run.noPreviousRun')}
              description={t('run.noPreviousRunDesc')}
              compact
            />
          )}
        </Section>
      </div>
    </div>
  )
}

function isArtifactTab(value: string): value is ArtifactTab {
  return value === 'summary' || value === 'diff' || value === 'tests'
}

function ArtifactScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const { t } = useI18n()
  const canReview = state.run.outcome === 'SUCCEEDED'
  const canAccept = canReview && state.artifact.reviewStatus !== 'ACCEPTED'

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow={t('artifact.eyebrow')}
        title={state.artifact.title}
        description={t('artifact.description')}
        meta={
          <>
            <Badge tone={artifactTone[state.artifact.reviewStatus]}>
              {t(`artifactLabel.${artifactLabelKey[state.artifact.reviewStatus]}`)}
            </Badge>
            <Badge tone={state.artifact.applicationStatus === 'APPLIED' ? 'success' : 'neutral'}>
              {state.artifact.applicationStatus === 'APPLIED'
                ? t('artifactLabel.applied')
                : t('artifactLabel.notApplied')}
            </Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'run' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t('artifact.runTimelineBack')}
          </Button>
        }
      />
      <Section
        title={t('artifact.reviewEvidence')}
        icon={FileCheck2}
        action={
          <Badge tone="neutral">
            {t('artifact.files', { n: state.artifact.changedFiles.length })}
          </Badge>
        }
      >
        <Tabs
          value={state.artifact.activeTab}
          onValueChange={(value) => {
            if (isArtifactTab(value)) dispatch({ type: 'SET_ARTIFACT_TAB', tab: value })
          }}
        >
          <TabsList>
            <TabsTrigger value="summary">{t('artifact.summaryTab')}</TabsTrigger>
            <TabsTrigger value="diff">{t('artifact.diffTab')}</TabsTrigger>
            <TabsTrigger value="tests">{t('artifact.testsTab')}</TabsTrigger>
          </TabsList>
          <TabsContent value="summary" className="pt-4">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
              <div>
                <h3 className="text-[13px] font-semibold">{t('artifact.whatChanged')}</h3>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  {state.artifact.summary}
                </p>
                <ul className="mt-3 space-y-1.5 text-[11px]">
                  {state.artifact.changedFiles.map((file) => (
                    <li key={file} className="flex items-center gap-2">
                      <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      <span className="font-mono">{file}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-[var(--radius-control)] border border-border bg-muted/40 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('artifact.reviewDistinction')}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  {t('artifact.reviewDistinctionDesc')}
                </p>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="diff" className="pt-4">
            <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-border bg-background p-3 font-mono text-[11px] leading-6 text-muted-foreground">
              {state.artifact.diffLines.map((line) => (
                <code
                  key={line}
                  className={cn('block', line.startsWith('+') && 'text-status-success')}
                >
                  {line}
                </code>
              ))}
            </pre>
          </TabsContent>
          <TabsContent value="tests" className="pt-4">
            <div className="space-y-2">
              {state.run.tests.map((test) => (
                <div
                  key={test.id}
                  className="flex items-start gap-2 rounded-[var(--radius-control)] border border-border bg-background p-3 text-[11px]"
                >
                  <TestTube2
                    className="mt-0.5 size-3.5 shrink-0 text-status-success"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium">{test.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                      {test.detail}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </Section>

      <Section
        title={t('artifact.reviewCommands')}
        icon={ShieldCheck}
        eyebrow={t('artifact.noAutomaticChain')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => dispatch({ type: 'ACCEPT_ARTIFACT' })}
            disabled={!canAccept}
          >
            <Check className="size-3.5" aria-hidden="true" />
            {t('artifact.acceptArtifact')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'REQUEST_CHANGES' })}
            disabled={!canReview}
          >
            {t('artifact.requestChanges')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => dispatch({ type: 'REJECT_ARTIFACT' })}
            disabled={!canReview}
          >
            {t('artifact.rejectArtifact')}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-[10px] text-muted-foreground">
          <span>{t('artifact.currentState')}</span>
          <Badge tone={artifactTone[state.artifact.reviewStatus]}>
            {t(`artifactLabel.${artifactLabelKey[state.artifact.reviewStatus]}`)}
          </Badge>
          <span aria-hidden="true">·</span>
          <span>
            {state.artifact.applicationStatus === 'APPLIED'
              ? t('artifactLabel.patchApplied')
              : t('artifactLabel.patchNotApplied')}
          </span>
        </div>
      </Section>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
        >
          {t('artifact.continueToTaskReview')}{' '}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

function BaselineScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const { t } = useI18n()
  const canActivate = state.task.status === 'COMPLETED' && state.baseline.status === 'DRAFT'

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow={t('baseline.eyebrow')}
        title={state.baseline.label}
        description={t('baseline.description')}
        meta={<BaselineStatusBadge status={state.baseline.status} />}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'task' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t('baseline.taskWorkspaceBack')}
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title={t('baseline.currentAnchor')} icon={Layers3}>
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-[var(--radius-control)] bg-muted">
              <ShieldCheck className="size-4 text-status-success" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold">{state.project.activeBaseline}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {t('baseline.activeOn', { branch: state.project.branch })}
              </p>
            </div>
            <BaselineStatusBadge status="ACTIVE" />
          </div>
          <p className="mt-4 border-t border-border pt-3 text-[11px] leading-5 text-muted-foreground">
            {t('baseline.anchorUnchanged')}
          </p>
        </Section>
        <Section
          title={t('baseline.candidateBaseline')}
          icon={ShieldCheck}
          action={<BaselineStatusBadge status={state.baseline.status} />}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
            <dt className="text-muted-foreground">{t('baseline.sourceTask')}</dt>
            <dd className="text-right font-mono">{state.baseline.sourceTaskId}</dd>
            <dt className="text-muted-foreground">{t('baseline.revision')}</dt>
            <dd className="truncate text-right font-mono">{state.baseline.revision}</dd>
            <dt className="text-muted-foreground">{t('baseline.artifact')}</dt>
            <dd className="text-right">
              <Badge tone={artifactTone[state.artifact.reviewStatus]}>
                {t(`artifactLabel.${artifactLabelKey[state.artifact.reviewStatus]}`)}
              </Badge>
            </dd>
            <dt className="text-muted-foreground">{t('baseline.task')}</dt>
            <dd className="flex justify-end">
              <TaskStatusBadge status={state.task.status} />
            </dd>
          </dl>
        </Section>
      </div>
      <Section
        title={t('baseline.activationConfirmation')}
        icon={LockKeyhole}
        eyebrow={t('baseline.separateFromCompletion')}
      >
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium">
              {canActivate ? t('baseline.readyToActivate') : t('baseline.activationGated')}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              {canActivate ? t('baseline.activationReady') : t('baseline.activationHint')}
            </p>
          </div>
          <Button onClick={() => dispatch({ type: 'ACTIVATE_BASELINE' })} disabled={!canActivate}>
            {state.baseline.status === 'ACTIVE' ? (
              <Check className="size-3.5" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            )}
            {state.baseline.status === 'ACTIVE'
              ? t('baseline.baselineActive')
              : t('baseline.activateBaseline')}
          </Button>
        </div>
      </Section>
    </div>
  )
}

function FlowScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  switch (state.route) {
    case 'dashboard':
      return <DashboardScreen state={state} dispatch={dispatch} />
    case 'outline':
      return <OutlineScreen state={state} dispatch={dispatch} />
    case 'node':
      return <NodeWorkspaceScreen state={state} dispatch={dispatch} />
    case 'task':
      return <TaskScreen state={state} dispatch={dispatch} />
    case 'context':
      return <ContextScreen state={state} dispatch={dispatch} />
    case 'run':
      return <RunScreen state={state} dispatch={dispatch} />
    case 'artifact':
      return <ArtifactScreen state={state} dispatch={dispatch} />
    case 'baseline':
      return <BaselineScreen state={state} dispatch={dispatch} />
  }
}

function NodeWorkspaceScreen({ state, dispatch }: FlowScreenProps): React.JSX.Element {
  const { t } = useI18n()
  const node =
    state.nodes.find((candidate) => candidate.id === state.selectedNodeId) ?? state.nodes[0]
  if (!node)
    return (
      <EmptyState
        icon={Search}
        title={t('nodeWorkspace.noNode')}
        description={t('nodeWorkspace.noNodeDesc')}
      />
    )

  return (
    <div className="space-y-5">
      <PageToolbar
        eyebrow={t('nodeWorkspace.eyebrow')}
        title={node.title}
        description={t('nodeWorkspace.description')}
        meta={
          <>
            <NodeTypeBadge type={node.type} />
            <Badge tone="success">{t(`status.${node.lifecycle}`)}</Badge>
            <Badge tone="neutral">{node.version}</Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => dispatch({ type: 'NAVIGATE', route: 'outline' })}
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            {t('nodeWorkspace.projectOutlineBack')}
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <Section title={t('nodeWorkspace.nodeContent')} icon={Code2} eyebrow={node.id}>
          <p className="text-[16px] font-semibold">{node.summary}</p>
          <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
            {t('nodeWorkspace.nodeContentNote')}
          </p>
          <Separator className="my-4" />
          <div className="flex flex-wrap gap-2">
            <Badge tone="success">{t('nodeWorkspace.activeVersion')}</Badge>
            <Badge tone="neutral">{t('nodeWorkspace.immutableRecord')}</Badge>
          </div>
        </Section>
        <Section title={t('nodeWorkspace.linkedWork')} icon={GitBranch}>
          <div className="space-y-2">
            {node.links.map((link) => (
              <button
                key={link}
                type="button"
                className="flex w-full items-center gap-2 rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-left text-[11px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50"
                onClick={() =>
                  dispatch({
                    type: 'NAVIGATE',
                    route: link.startsWith('TASK') ? 'task' : 'outline'
                  })
                }
              >
                <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 font-mono">{link}</span>
                <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => dispatch({ type: 'NAVIGATE', route: 'context' })}>
              {t('nodeWorkspace.composeContext')}{' '}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </Section>
      </div>
    </div>
  )
}

export function CoreFlowWorkspace({
  runtimeInfo
}: {
  readonly runtimeInfo: RuntimeInfo | null
}): React.JSX.Element {
  const { t, locale } = useI18n()
  const service = useMemo(() => createCoreFlowFixtureService(locale), [locale])
  const [state, dispatch] = useReducer(coreFlowReducer, undefined, service.load)
  const meta = state.route
    ? {
        label: t(`flow.${state.route}.label`),
        title: t(`flow.${state.route}.title`),
        description: t(`flow.${state.route}.description`)
      }
    : undefined

  const handleSidebarNavigate = (label: string): void => {
    const route = sidebarRoutes[label]
    if (route) dispatch({ type: 'NAVIGATE', route })
  }

  return (
    <AppShell
      runtimeInfo={runtimeInfo}
      inspector={<FlowInspector state={state} />}
      sectionLabel={`MUSICDB / ${meta?.label ?? ''}`}
      title={meta?.title ?? ''}
      description={meta?.description ?? ''}
      activeItem={meta?.label ?? ''}
      onNavigate={handleSidebarNavigate}
    >
      <div className="space-y-3">
        <FlowProgress state={state} dispatch={dispatch} />
        <Notice notice={state.notice} />
        <FlowScreen state={state} dispatch={dispatch} />
      </div>
    </AppShell>
  )
}
