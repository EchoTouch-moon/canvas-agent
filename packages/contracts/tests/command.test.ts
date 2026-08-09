import { describe, expect, it } from 'vitest'
import {
  agentChooseExecutableResultSchema,
  agentRuntimeReasonSchema,
  agentRuntimeStateSchema,
  agentRuntimeStatusSchema,
  commandErrorSchema,
  commandRequestSchema,
  commandResponseSchemas,
  workspaceChooseResultSchema,
  workspaceErrorReasonSchema,
  workspaceLifecycleSchema,
  workspaceOperationErrorSchema,
  workspaceRuntimeStatusSchema,
  workspaceSummarySchema,
  type CommandRequest,
  type CommandResponse
} from '../src'

const COMMIT = 'b'.repeat(40)

function request(command: string, payload: unknown): CommandRequest {
  return { requestId: 'req_t', schemaVersion: 1, command: command as never, payload: payload as never }
}

describe('command envelope', () => {
  it('parses a valid command request', () => {
    const parsed = commandRequestSchema.parse(
      request('project.create', { name: 'MUSICDB', description: 'personal library' })
    ) as CommandRequest<'project.create'>
    expect(parsed.command).toBe('project.create')
    expect(parsed.payload.name).toBe('MUSICDB')
  })

  it('rejects unknown commands and extra fields', () => {
    expect(() => commandRequestSchema.parse(request('unknown.command', {}))).toThrow()
    expect(() =>
      commandRequestSchema.parse(request('project.create', { name: 'X', extra: true }))
    ).toThrow()
  })

  it('requires requestId and the pinned schemaVersion', () => {
    const { requestId: _requestId, ...noId } = request('project.create', { name: 'X' })
    expect(() => commandRequestSchema.parse(noId)).toThrow()
    expect(() =>
      commandRequestSchema.parse({ ...request('project.create', { name: 'X' }), schemaVersion: 2 })
    ).toThrow()
  })

  it('correlates the payload schema with the command', () => {
    expect(() => commandRequestSchema.parse(request('nodeDraft.upsert', { name: 'X' }))).toThrow()
    const draft = commandRequestSchema.parse(
      request('nodeDraft.upsert', { nodeId: 'node_1', title: 'Goal', expectedRevision: 3 })
    ) as CommandRequest<'nodeDraft.upsert'>
    expect(draft.payload).toEqual({ nodeId: 'node_1', title: 'Goal', expectedRevision: 3 })

    expect(() =>
      commandRequestSchema.parse(
        request('snapshot.freeze', {
          projectId: 'p',
          taskId: 't',
          taskSpecVersionId: 's',
          baseBaselineId: 'b',
          expectedRepositoryRevisionId: 'r',
          items: [{ itemType: 'NODE_VERSION' }]
        })
      )
    ).toThrow()
    expect(() =>
      commandRequestSchema.parse(
        request('snapshot.freeze', {
          projectId: 'p',
          taskId: 't',
          taskSpecVersionId: 's',
          baseBaselineId: 'b',
          expectedRepositoryRevisionId: 'r',
          selections: [{ source: { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' } }]
        })
      )
    ).not.toThrow()
    expect(() =>
      commandRequestSchema.parse(
        request('snapshot.freeze', {
          projectId: 'p',
          taskId: 't',
          taskSpecVersionId: 's',
          baseBaselineId: 'b',
          expectedRepositoryRevisionId: 'r',
          selections: [{ source: { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: 's' } }]
        })
      )
    ).toThrow()
  })

  it('validates context.resolve payloads with a full SourceReference union', () => {
    const resolve = commandRequestSchema.parse(
      request('context.resolve', {
        projectId: 'p',
        taskId: 't',
        taskSpecVersionId: 's',
        baseBaselineId: 'b',
        expectedRepositoryRevisionId: 'r',
        selections: [
          { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: 's' },
          { kind: 'NODE_VERSION', nodeVersionId: 'nv_1' },
          { kind: 'REPOSITORY_CONTENT', path: 'README.md' }
        ]
      })
    ) as CommandRequest<'context.resolve'>
    expect(resolve.payload.selections).toHaveLength(3)
    expect(() =>
      commandRequestSchema.parse(
        request('context.resolve', {
          projectId: 'p',
          taskId: 't',
          taskSpecVersionId: 's',
          baseBaselineId: 'b',
          expectedRepositoryRevisionId: 'r',
          selections: [{ kind: 'REPOSITORY_CONTENT', path: '../secret' }]
        })
      )
    ).toThrow()
  })

  it('validates execution.dispatch and execution.cancel payloads', () => {
    const dispatch = commandRequestSchema.parse(
      request('execution.dispatch', {
        executionRequestId: 'req_01',
        contextSnapshotId: 'snap_01'
      })
    ) as CommandRequest<'execution.dispatch'>
    expect(dispatch.command).toBe('execution.dispatch')
    expect(dispatch.payload).toEqual({
      executionRequestId: 'req_01',
      contextSnapshotId: 'snap_01'
    })

    expect(() =>
      commandRequestSchema.parse(
        request('execution.dispatch', { executionRequestId: 'req_01' })
      )
    ).toThrow()

    const cancel = commandRequestSchema.parse(
      request('execution.cancel', { executionRequestId: 'req_01' })
    ) as CommandRequest<'execution.cancel'>
    expect(cancel.payload).toEqual({ executionRequestId: 'req_01' })
  })

  it('validates project.list and project.state payloads', () => {
    const list = commandRequestSchema.parse(request('project.list', {})) as CommandRequest<
      'project.list'
    >
    expect(list.payload).toEqual({})

    const state = commandRequestSchema.parse(
      request('project.state', { projectId: 'proj_1' })
    ) as CommandRequest<'project.state'>
    expect(state.payload).toEqual({ projectId: 'proj_1' })
  })

  it('rejects worker.dispatch / worker.cancel as renderer commands', () => {
    expect(() => commandRequestSchema.parse(request('worker.dispatch', {}))).toThrow()
    expect(() =>
      commandRequestSchema.parse(request('worker.cancel', { executionRequestId: 'x' }))
    ).toThrow()
  })

  it('exposes revision.current but not revision.upsert to the renderer', () => {
    const current = commandRequestSchema.parse(
      request('revision.current', {})
    ) as CommandRequest<'revision.current'>
    expect(current.payload).toEqual({})

    expect(() =>
      commandRequestSchema.parse(
        request('revision.upsert', { baseCommit: COMMIT, treeHash: COMMIT })
      )
    ).toThrow()
  })
})

describe('command response correlation', () => {
  it('treats a dispatch outcome as data (ok), not a command error', () => {
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: true,
      command: 'execution.dispatch',
      data: {
        runId: 'run_1',
        executionRequestId: 'exec-1',
        result: {
          outcome: 'REVISION_MISMATCH',
          claimGranted: true,
          revisionMismatch: { field: 'baseCommit', expected: COMMIT, actual: 'c'.repeat(40) }
        }
      }
    }
    const parsed = commandResponseSchemas['execution.dispatch'].parse(
      response
    ) as Extract<CommandResponse<'execution.dispatch'>, { ok: true }>
    expect(parsed.ok).toBe(true)
    expect(parsed.data.runId).toBe('run_1')
    expect(parsed.data.result.outcome).toBe('REVISION_MISMATCH')
  })

  it('reports command failures separately as ok:false', () => {
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: false,
      command: 'nodeDraft.upsert',      error: { name: 'ConcurrencyError', message: 'stale revision' }
    }
    const parsed = commandResponseSchemas['nodeDraft.upsert'].parse(
      response
    ) as Extract<CommandResponse<'nodeDraft.upsert'>, { ok: false }>
    expect(parsed.ok).toBe(false)
    expect(parsed.error.name).toBe('ConcurrencyError')
  })

  it('validates per-command response data shapes', () => {
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: true,
      command: 'project.create',
      data: {
        id: 'proj_1',
        name: 'MUSICDB',
        description: null,
        createdAt: '2026-08-07T00:00:00.000Z',
        updatedAt: '2026-08-07T00:00:00.000Z'
      }
    }
    const parsed = commandResponseSchemas['project.create'].parse(
      response
    ) as Extract<CommandResponse<'project.create'>, { ok: true }>
    expect(parsed.data.id).toBe('proj_1')
  })

  it('rejects response data that does not match the command', () => {
    expect(() =>
      commandResponseSchemas['project.create'].parse({
        requestId: 'req_t',
        schemaVersion: 1,
        ok: true,
        command: 'project.create',
        data: { id: 'proj_1', name: 'X' }
      })
    ).toThrow()
  })

  it('validates a full project.state projection', () => {
    const now = '2026-08-07T00:00:00.000Z'
    const project = {
      id: 'proj_1',
      name: 'MUSICDB',
      description: null,
      createdAt: now,
      updatedAt: now
    }
    const response = {
      requestId: 'req_t',
      schemaVersion: 1,
      ok: true,
      command: 'project.state',
      data: {
        project,
        nodes: [],
        nodeDrafts: [],
        nodeVersions: [],
        edges: [],
        tasks: [],
        taskSpecs: [],
        baselines: [],
        activeBaseline: null
      }
    }
    const parsed = commandResponseSchemas['project.state'].parse(
      response
    ) as Extract<CommandResponse<'project.state'>, { ok: true }>
    expect(parsed.data.project.id).toBe('proj_1')
    expect(parsed.data.activeBaseline).toBeNull()

    const bad = { ...response, data: { ...response.data, project: null } }
    expect(() => commandResponseSchemas['project.state'].parse(bad)).toThrow()
  })
})

describe('command error schema', () => {
  it('accepts only the command-failure names', () => {
    expect(() =>
      commandErrorSchema.parse({ name: 'HostUnavailableError', message: 'worker down' })
    ).not.toThrow()
    expect(() => commandErrorSchema.parse({ name: 'REVISION_MISMATCH', message: 'x' })).toThrow()
  })
})

describe('executionRequestId and run commands', () => {
  it('rejects path-unsafe execution request ids at the schema boundary', () => {
    for (const id of ['', '.', '..', 'a/b', 'a\\b', 'a b', 'a%20b', 'a'.repeat(129)]) {
      expect(() =>
        commandRequestSchema.parse(
          request('execution.dispatch', { executionRequestId: id, contextSnapshotId: 'snap_1' })
        )
      ).toThrow()
    }
    expect(() =>
      commandRequestSchema.parse(
        request('execution.dispatch', { executionRequestId: 'exec_1', contextSnapshotId: 'snap_1' })
      )
    ).not.toThrow()
  })

  it('validates run.list and run.get payloads', () => {
    const list = commandRequestSchema.parse(
      request('run.list', { projectId: 'proj_1' })
    ) as CommandRequest<'run.list'>
    expect(list.command).toBe('run.list')

    const get = commandRequestSchema.parse(
      request('run.get', { runId: 'run_1' })
    ) as CommandRequest<'run.get'>
    expect(get.command).toBe('run.get')
  })
})

describe('acceptance and task completion commands', () => {
  const verdict = { criterionId: 'criterion_1', verdict: 'PASSED' as const }

  it('validates acceptance.evaluate payloads', () => {
    const payload = {
      projectId: 'proj_1',
      taskId: 'task_1',
      taskSpecVersionId: 'spec_1',
      runId: 'run_1',
      criteria: [verdict]
    }
    const parsed = commandRequestSchema.parse(request('acceptance.evaluate', payload))
    expect(parsed.command).toBe('acceptance.evaluate')

    // missing a required field
    expect(() =>
      commandRequestSchema.parse(
        request('acceptance.evaluate', { ...payload, runId: undefined })
      )
    ).toThrow()
    // empty criteria
    expect(() =>
      commandRequestSchema.parse(
        request('acceptance.evaluate', { ...payload, criteria: [] })
      )
    ).toThrow()
    // malformed criterion verdict
    expect(() =>
      commandRequestSchema.parse(
        request('acceptance.evaluate', {
          ...payload,
          criteria: [{ criterionId: 'criterion_1', verdict: 'MAYBE' }]
        })
      )
    ).toThrow()
    // extra field rejected
    expect(() =>
      commandRequestSchema.parse(
        request('acceptance.evaluate', { ...payload, extra: true })
      )
    ).toThrow()
  })

  it('validates acceptance.list and task.complete payloads', () => {
    const list = commandRequestSchema.parse(
      request('acceptance.list', { taskId: 'task_1' })
    ) as CommandRequest<'acceptance.list'>
    expect(list.command).toBe('acceptance.list')
    expect(() => commandRequestSchema.parse(request('acceptance.list', {}))).toThrow()

    const complete = commandRequestSchema.parse(
      request('task.complete', { taskId: 'task_1', evaluationId: 'evaluation_1' })
    ) as CommandRequest<'task.complete'>
    expect(complete.command).toBe('task.complete')
    expect(() =>
      commandRequestSchema.parse(request('task.complete', { taskId: 'task_1' }))
    ).toThrow()
  })

  it('validates the acceptance evaluation response aggregate', () => {
    const aggregate = {
      evaluation: {
        id: 'evaluation_1',
        projectId: 'proj_1',
        taskId: 'task_1',
        taskSpecVersionId: 'spec_1',
        runId: 'run_1',
        sequence: 0,
        status: 'PASSED',
        createdAt: '2026-08-08T00:00:00.000Z'
      },
      items: [
        {
          id: 'item_1',
          evaluationId: 'evaluation_1',
          criterionId: 'criterion_1',
          verdict: 'PASSED',
          note: null,
          position: 0
        }
      ]
    }
    expect(commandResponseSchemas['acceptance.evaluate'].parse({ requestId: 'req', schemaVersion: 1, ok: true, command: 'acceptance.evaluate', data: aggregate })).toBeTruthy()
    expect(() =>
      commandResponseSchemas['acceptance.evaluate'].parse({
        requestId: 'req',
        schemaVersion: 1,
        ok: true,
        command: 'acceptance.evaluate',
        data: { ...aggregate, evaluation: { ...aggregate.evaluation, status: 'PENDING' } }
      })
    ).toThrow()
  })

  it('validates the task.complete response Task schema', () => {
    const task = {
      id: 'task_1',
      projectId: 'proj_1',
      type: 'IMPLEMENT_CHANGE',
      status: 'COMPLETED',
      title: 'T',
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z'
    }
    expect(() =>
      commandResponseSchemas['task.complete'].parse({
        requestId: 'req',
        schemaVersion: 1,
        ok: true,
        command: 'task.complete',
        data: task
      })
    ).not.toThrow()
  })
})

describe('result adoption commands', () => {
  it('validates artifact.apply payloads', () => {
    const payload = { taskId: 'task_1', evaluationId: 'evaluation_1', artifactId: 'artifact_1' }
    const parsed = commandRequestSchema.parse(request('artifact.apply', payload))
    expect(parsed.command).toBe('artifact.apply')
    expect(() =>
      commandRequestSchema.parse(request('artifact.apply', { ...payload, artifactId: undefined }))
    ).toThrow()
    expect(() => commandRequestSchema.parse(request('artifact.apply', { taskId: 'task_1' }))).toThrow()
    expect(() =>
      commandRequestSchema.parse(request('artifact.apply', { ...payload, extra: true }))
    ).toThrow()
  })

  it('validates artifactApplication.list payloads', () => {
    const parsed = commandRequestSchema.parse(request('artifactApplication.list', { taskId: 'task_1' }))
    expect(parsed.command).toBe('artifactApplication.list')
    expect(() => commandRequestSchema.parse(request('artifactApplication.list', {}))).toThrow()
  })

  it('validates baseline.createCandidateFromTask payloads', () => {
    const payload = { applicationId: 'app_1', name: 'Baseline 1.1' }
    const parsed = commandRequestSchema.parse(request('baseline.createCandidateFromTask', payload))
    expect(parsed.command).toBe('baseline.createCandidateFromTask')
    expect(() =>
      commandRequestSchema.parse(request('baseline.createCandidateFromTask', { applicationId: 'app_1' }))
    ).toThrow()
    expect(() =>
      commandRequestSchema.parse(
        request('baseline.createCandidateFromTask', { ...payload, name: '' })
      )
    ).toThrow()
  })

  it('validates the artifact application aggregate response', () => {
    const aggregate = {
      application: {
        id: 'app_1',
        projectId: 'proj_1',
        taskId: 'task_1',
        evaluationId: 'evaluation_1',
        runId: 'run_1',
        executionRequestId: 'exec-1',
        artifactId: 'artifact_1',
        baseBaselineId: 'baseline_1',
        baseRepositoryRevisionId: 'rev_1',
        patchHash: 'a'.repeat(64),
        authorizedAt: '2026-08-08T00:00:00.000Z'
      },
      events: [
        {
          id: 'event_1',
          applicationId: 'app_1',
          sequence: 0,
          kind: 'AUTHORIZED',
          repositoryRevisionId: null,
          reasonCode: null,
          detail: null,
          createdAt: '2026-08-08T00:00:00.000Z'
        }
      ],
      effectiveStatus: 'AUTHORIZED',
      repositoryRevision: null
    }
    expect(() =>
      commandResponseSchemas['artifact.apply'].parse({
        requestId: 'req',
        schemaVersion: 1,
        ok: true,
        command: 'artifact.apply',
        data: aggregate
      })
    ).not.toThrow()
    expect(() =>
      commandResponseSchemas['artifact.apply'].parse({
        requestId: 'req',
        schemaVersion: 1,
        ok: true,
        command: 'artifact.apply',
        data: { ...aggregate, effectiveStatus: 'MAYBE' }
      })
    ).toThrow()
  })

  it('validates the baseline candidate aggregate response', () => {
    const candidate = {
      baseline: {
        id: 'baseline_2',
        projectId: 'proj_1',
        status: 'DRAFT',
        name: 'Baseline 1.1',
        description: null,
        repositoryRevisionId: 'rev_2',
        activatedAt: null,
        supersededAt: null,
        createdAt: '2026-08-08T00:00:00.000Z',
        updatedAt: '2026-08-08T00:00:00.000Z'
      },
      source: {
        baselineId: 'baseline_2',
        parentBaselineId: 'baseline_1',
        taskId: 'task_1',
        artifactApplicationId: 'app_1'
      },
      items: []
    }
    expect(() =>
      commandResponseSchemas['baseline.createCandidateFromTask'].parse({
        requestId: 'req',
        schemaVersion: 1,
        ok: true,
        command: 'baseline.createCandidateFromTask',
        data: candidate
      })
    ).not.toThrow()
  })

  describe('workspace commands (PROPOSAL-027A)', () => {
    const STATUS = {
      state: 'READY',
      activeWorkspace: {
        identity: 'a'.repeat(64),
        repositoryName: 'canvas-agent',
        displayPath: '/Users/me/canvas-agent'
      },
      lastError: null
    }
    const ERRORED = {
      state: 'ERROR',
      activeWorkspace: null,
      lastError: { reasonCode: 'PATH_UNREADABLE', message: 'not readable', recoverable: true }
    }

    it('accepts strict empty payloads for all four workspace commands', () => {
      for (const command of [
        'workspace.status',
        'workspace.chooseRepository',
        'workspace.reopenLast',
        'workspace.close'
      ]) {
        const parsed = commandRequestSchema.parse(request(command, {}))
        expect(parsed.command).toBe(command)
        expect(() => commandRequestSchema.parse(request(command, { path: '/tmp/repo' }))).toThrow()
        expect(() => commandRequestSchema.parse(request(command, { extra: true }))).toThrow()
      }
    })

    it('parses and round-trips every lifecycle and error reason enum', () => {
      const lifecycles = ['CLOSED', 'OPENING', 'READY', 'CLOSING', 'ERROR'] as const
      for (const state of lifecycles) {
        expect(workspaceLifecycleSchema.parse(state)).toBe(state)
      }
      const reasons = [
        'PATH_UNREADABLE',
        'NOT_GIT_WORKTREE',
        'MISSING_HEAD',
        'RUNTIME_NOT_WRITABLE',
        'SETTINGS_INVALID',
        'DATABASE_OPEN_FAILED',
        'WORKER_DISPOSE_FAILED',
        'ACTIVE_RUN_BLOCKS_SWITCH',
        'OPERATION_IN_PROGRESS',
        'PICKER_FAILED',
        'UNKNOWN'
      ] as const
      for (const reason of reasons) {
        expect(workspaceErrorReasonSchema.parse(reason)).toBe(reason)
      }
      expect(() => workspaceLifecycleSchema.parse('BOGUS')).toThrow()
      expect(() => workspaceErrorReasonSchema.parse('BOGUS')).toThrow()
    })

    it('enforces the workspace status shape and impossible combinations', () => {
      expect(() => workspaceRuntimeStatusSchema.parse(STATUS)).not.toThrow()
      expect(() => workspaceRuntimeStatusSchema.parse(ERRORED)).not.toThrow()
      expect(() =>
        workspaceRuntimeStatusSchema.parse({ state: 'READY', activeWorkspace: null, lastError: null })
      ).not.toThrow()
      expect(() =>
        workspaceRuntimeStatusSchema.parse({ state: 'READY', activeWorkspace: null, extra: true })
      ).toThrow()
      expect(() => workspaceRuntimeStatusSchema.parse({ state: 'READY' })).toThrow()
    })

    it('allows READY to retain an active workspace plus a failed-switch lastError', () => {
      const status = {
        state: 'READY',
        activeWorkspace: STATUS.activeWorkspace,
        lastError: { reasonCode: 'NOT_GIT_WORKTREE', message: 'candidate failed', recoverable: true }
      }
      expect(() => workspaceRuntimeStatusSchema.parse(status)).not.toThrow()
      expect(status.state).toBe('READY')
      expect(status.lastError.reasonCode).toBe('NOT_GIT_WORKTREE')
    })

    it('parses the picker cancellation result shape', () => {
      const cancelled = { cancelled: true, status: STATUS }
      expect(() => workspaceChooseResultSchema.parse(cancelled)).not.toThrow()
      expect(cancelled.status).toEqual(STATUS)
      expect(() => workspaceChooseResultSchema.parse({ cancelled: false, status: STATUS })).not.toThrow()
      expect(() =>
        workspaceChooseResultSchema.parse({ cancelled: true, status: { state: 'BOGUS' } })
      ).toThrow()
    })

    it('validates the workspace response envelope for all four commands', () => {
      for (const command of [
        'workspace.status',
        'workspace.reopenLast',
        'workspace.close'
      ] as const) {
        expect(() =>
          commandResponseSchemas[command].parse({
            requestId: 'req',
            schemaVersion: 1,
            ok: true,
            command,
            data: STATUS
          })
        ).not.toThrow()
        expect(() =>
          commandResponseSchemas[command].parse({
            requestId: 'req',
            schemaVersion: 1,
            ok: false,
            command,
            error: { name: 'HostUnavailableError', message: 'not ready' }
          })
        ).not.toThrow()
      }
      expect(() =>
        commandResponseSchemas['workspace.chooseRepository'].parse({
          requestId: 'req',
          schemaVersion: 1,
          ok: true,
          command: 'workspace.chooseRepository',
          data: { cancelled: false, status: STATUS }
        })
      ).not.toThrow()
      expect(() =>
        commandResponseSchemas['workspace.chooseRepository'].parse({
          requestId: 'req',
          schemaVersion: 1,
          ok: true,
          command: 'workspace.chooseRepository',
          data: STATUS
        })
      ).toThrow()
    })

    it('round-trips the workspace summary and operation error inferred types', () => {
      expect(workspaceSummarySchema.parse(STATUS.activeWorkspace)).toEqual(STATUS.activeWorkspace)
      expect(workspaceOperationErrorSchema.parse(ERRORED.lastError)).toEqual(ERRORED.lastError)
    })
  })

  describe('agent readiness commands (PROPOSAL-028C)', () => {
    const READY = {
      provider: 'codex-cli',
      state: 'READY',
      version: 'codex-cli 0.146.0',
      source: 'PATH',
      displayPath: '/opt/homebrew/bin/codex',
      lastError: null
    }
    const NOT_FOUND = {
      provider: 'codex-cli',
      state: 'NOT_FOUND',
      version: null,
      source: null,
      displayPath: null,
      lastError: { reasonCode: 'EXECUTABLE_NOT_FOUND', recoverable: true }
    }

    it('accepts strict empty payloads for all three agent commands', () => {
      for (const command of ['agent.status', 'agent.chooseExecutable', 'agent.clearExecutable']) {
        const parsed = commandRequestSchema.parse(request(command, {}))
        expect(parsed.command).toBe(command)
        expect(() => commandRequestSchema.parse(request(command, { path: '/bin/codex' }))).toThrow()
        expect(() =>
          commandRequestSchema.parse(request(command, { provider: 'claude' }))
        ).toThrow()
      }
    })

    it('enforces the agent status schema shape', () => {
      expect(agentRuntimeStatusSchema.parse(READY)).toEqual(READY)
      expect(agentRuntimeStatusSchema.parse(NOT_FOUND)).toEqual(NOT_FOUND)
      // provider is fixed to codex-cli
      expect(() => agentRuntimeStatusSchema.parse({ ...READY, provider: 'claude' })).toThrow()
      // strict: unknown keys rejected
      expect(() => agentRuntimeStatusSchema.parse({ ...READY, extra: true })).toThrow()
    })

    it('round-trips every agent state and reason enum', () => {
      for (const state of [
        'READY',
        'NOT_FOUND',
        'UNSUPPORTED_VERSION',
        'AUTH_REQUIRED',
        'INTERPRETER_MISSING',
        'ERROR'
      ]) {
        expect(agentRuntimeStateSchema.parse(state)).toBe(state)
      }
      for (const reason of [
        'EXECUTABLE_NOT_FOUND',
        'EXECUTABLE_NOT_READABLE',
        'EXECUTABLE_NOT_SUPPORTED',
        'INTERPRETER_MISSING',
        'AUTH_REQUIRED',
        'PROBE_TIMED_OUT',
        'ACTIVE_RUN_BLOCKS_CHANGE',
        'SETTINGS_INVALID',
        'UNKNOWN'
      ]) {
        expect(agentRuntimeReasonSchema.parse(reason)).toBe(reason)
      }
      expect(() => agentRuntimeStateSchema.parse('BOGUS')).toThrow()
      expect(() => agentRuntimeReasonSchema.parse('BOGUS')).toThrow()
    })

    it('parses the chooseExecutable picker-cancellation shape', () => {
      expect(agentChooseExecutableResultSchema.parse({ cancelled: true, status: READY })).toEqual({
        cancelled: true,
        status: READY
      })
      expect(() =>
        agentChooseExecutableResultSchema.parse({ cancelled: false, status: READY })
      ).not.toThrow()
    })

    it('validates the agent command response envelope', () => {
      for (const command of ['agent.status', 'agent.clearExecutable'] as const) {
        expect(() =>
          commandResponseSchemas[command].parse({
            requestId: 'req',
            schemaVersion: 1,
            ok: true,
            command,
            data: READY
          })
        ).not.toThrow()
      }
      expect(() =>
        commandResponseSchemas['agent.chooseExecutable'].parse({
          requestId: 'req',
          schemaVersion: 1,
          ok: true,
          command: 'agent.chooseExecutable',
          data: { cancelled: false, status: READY }
        })
      ).not.toThrow()
      expect(() =>
        commandResponseSchemas['agent.chooseExecutable'].parse({
          requestId: 'req',
          schemaVersion: 1,
          ok: true,
          command: 'agent.chooseExecutable',
          data: READY
        })
      ).toThrow()
    })
  })
})
