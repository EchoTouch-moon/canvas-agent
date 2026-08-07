import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConcurrencyError, NotFoundError, type SystemServices } from '@canvas-agent/persistence'
import { openWorkspaceDatabase, closeWorkspaceDatabase } from './database'
import { GitRevisionReader } from './git-revision-reader'
import { WorkspaceService } from './workspace-service'
import { cleanupTempDirs, createTempGitRepo, trackTempDir } from './testing/git-fixture'

function fixedServices(): SystemServices {
  let counter = 0
  return {
    now: () => '2026-08-07T00:00:00.000Z',
    nextId: (prefix: string) => `${prefix}${++counter}`
  }
}

describe('WorkspaceService', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('maps project/node/task/spec/baseline/snapshot commands to persistence', async () => {
    const repoDir = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-main-runtime-')))
    const p = openWorkspaceDatabase(':memory:', fixedServices())
    const service = new WorkspaceService(
      p,
      new GitRevisionReader({ sourceRepositoryPath: repoDir, runtimeDirectory: runtimeDir })
    )

    const project = service.createProject({ name: 'MUSICDB', description: 'personal library' })
    expect(project.id).toMatch(/^proj_/)
    expect(service.getProject({ projectId: project.id }).name).toBe('MUSICDB')

    const node = service.createNode({ projectId: project.id, type: 'REQUIREMENT' })
    const version = service.publishNodeVersion({
      nodeId: node.id,
      title: 'Requirement',
      body: 'body'
    })
    expect(version.contentHash).toMatch(/^[a-f0-9]{64}$/)

    const task = service.createTask({
      projectId: project.id,
      type: 'IMPLEMENT_CHANGE',
      title: 'Task'
    })
    const spec = service.publishTaskSpec({
      taskId: task.id,
      description: 'd',
      scope: 's',
      criteria: [{ description: 'works', position: 0 }]
    })
    expect(spec.spec.id).toMatch(/^spec_/)

    const draft = service.createBaselineDraft({
      projectId: project.id,
      name: '0.1',
      nodeVersionIds: [version.id]
    })
    const { activated, superseded } = service.activateBaseline({ baselineId: draft.id })
    expect(activated.status).toBe('ACTIVE')
    expect(superseded).toBeNull()

    const revision = await service.revisionCurrent()
    expect(revision.baseCommit).toMatch(/^[a-f0-9]{40}$/)

    const frozen = service.freezeSnapshot({
      projectId: project.id,
      taskId: task.id,
      taskSpecVersionId: spec.spec.id,
      baseBaselineId: draft.id,
      expectedRepositoryRevisionId: revision.id,
      selections: [
        {
          source: { kind: 'NODE_VERSION', nodeVersionId: version.id },
          selectionReason: 'primary requirement'
        }
      ]
    })
    expect(frozen.snapshot.status).toBe('FROZEN')
    expect(frozen.items).toHaveLength(2)
    expect(frozen.items[0]).toMatchObject({
      itemType: 'USER_INPUT',
      sourceRef: `task-spec://${spec.spec.id}`,
      authority: 'TASK_INSTRUCTION',
      priority: 'P0'
    })
    expect(frozen.items[0]?.contentHash).toBe(spec.spec.contentHash)
    expect(frozen.items[1]).toMatchObject({
      itemType: 'NODE_VERSION',
      sourceRef: `node://${version.id}`,
      authority: 'PROJECT_FACT',
      priority: 'P1',
      selectionReason: 'primary requirement'
    })
    expect(frozen.items[1]?.contentHash).toBe(version.contentHash)

    closeWorkspaceDatabase(p)
  })

  it('propagates concurrency and not-found domain errors', async () => {
    const repoDir = await createTempGitRepo()
    const runtimeDir = trackTempDir(await mkdtemp(join(tmpdir(), 'ca-main-runtime-')))
    const p = openWorkspaceDatabase(':memory:', fixedServices())
    const service = new WorkspaceService(
      p,
      new GitRevisionReader({ sourceRepositoryPath: repoDir, runtimeDirectory: runtimeDir })
    )

    const project = service.createProject({ name: 'P' })
    const node = service.createNode({ projectId: project.id, type: 'DESIGN' })
    service.upsertNodeDraft({ nodeId: node.id, title: 'v1' })
    expect(() =>
      service.upsertNodeDraft({ nodeId: node.id, title: 'stale', expectedRevision: 0 })
    ).toThrow(ConcurrencyError)

    expect(() => service.getProject({ projectId: 'missing' })).toThrow(NotFoundError)
    expect(() =>
      service.freezeSnapshot({
        projectId: project.id,
        taskId: 't',
        taskSpecVersionId: 's',
        baseBaselineId: 'b',
        expectedRepositoryRevisionId: 'rev_missing',
        selections: []
      })
    ).toThrow(NotFoundError)

    closeWorkspaceDatabase(p)
  })
})
