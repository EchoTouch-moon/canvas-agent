import type {
  BaselineStatus,
  RunOutcome,
  RunStatus,
  SnapshotFreshness,
  TaskStatus
} from '@canvas-agent/domain'

export interface DashboardFixture {
  readonly project: {
    readonly name: string
    readonly description: string
    readonly branch: string
    readonly baselineLabel: string
    readonly baselineStatus: BaselineStatus
  }
  readonly activeTask: {
    readonly id: string
    readonly title: string
    readonly objective: string
    readonly status: TaskStatus
    readonly criteriaPassed: number
    readonly criteriaTotal: number
  }
  readonly snapshot: {
    readonly label: string
    readonly freshness: SnapshotFreshness
    readonly selectedItems: number
    readonly tokenEstimate: number
    readonly tokenBudget: number
  }
  readonly latestRun: {
    readonly id: string
    readonly status: RunStatus
    readonly outcome: RunOutcome
    readonly testsPassed: number
    readonly changedFiles: number
  }
}

export const musicdbDashboardFixture: DashboardFixture = {
  project: {
    name: 'MUSICDB',
    description: 'Personal music library, listening notes, and recording-version workspace.',
    branch: 'main',
    baselineLabel: 'Baseline 1.0',
    baselineStatus: 'ACTIVE'
  },
  activeTask: {
    id: 'TASK-011',
    title: 'Add recording-version notes',
    objective: 'Separate song-wide notes from notes tied to a specific recording version.',
    status: 'IN_PROGRESS',
    criteriaPassed: 3,
    criteriaTotal: 6
  },
  snapshot: {
    label: 'Snapshot draft 04',
    freshness: 'CURRENT',
    selectedItems: 16,
    tokenEstimate: 18_450,
    tokenBudget: 32_000
  },
  latestRun: {
    id: 'RUN-008',
    status: 'FINISHED',
    outcome: 'PARTIAL',
    testsPassed: 10,
    changedFiles: 7
  }
}
