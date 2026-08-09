// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  AgentRuntimeStatus,
  WorkspaceRuntimeStatus,
  WorkspaceSummary
} from '@canvas-agent/contracts'
import type { WorkspaceLifecycleClient } from '@/lib/workspace-client'
import { createFakeWorkspaceClient } from '@/data/fake-workspace'
import { ProductOnboarding } from './product-onboarding'

const summary: WorkspaceSummary = {
  identity: 'a'.repeat(64),
  repositoryName: 'MUSICDB',
  displayPath: '/repo/musicdb'
}
const closed: WorkspaceRuntimeStatus = {
  state: 'CLOSED',
  activeWorkspace: null,
  lastError: null
}
const ready: WorkspaceRuntimeStatus = {
  state: 'READY',
  activeWorkspace: summary,
  lastError: null
}
const readyAgent: AgentRuntimeStatus = {
  provider: 'codex-cli',
  state: 'READY',
  version: 'codex-cli 0.146.0',
  source: 'KNOWN_LOCATION',
  displayPath: '/opt/homebrew/bin/codex',
  lastError: null
}

function lifecycle(
  workspaceStatus: WorkspaceRuntimeStatus,
  agentStatus: AgentRuntimeStatus = readyAgent
): WorkspaceLifecycleClient {
  return {
    getWorkspaceStatus: vi.fn(async () => workspaceStatus),
    chooseRepository: vi.fn(async () => ({ cancelled: true, status: workspaceStatus })),
    reopenLast: vi.fn(async () => workspaceStatus),
    closeWorkspace: vi.fn(async () => closed),
    getAgentStatus: vi.fn(async () => agentStatus),
    chooseAgentExecutable: vi.fn(async () => ({ cancelled: true, status: agentStatus })),
    clearAgentExecutable: vi.fn(async () => agentStatus)
  }
}

afterEach(() => {
  cleanup()
  document.documentElement.classList.remove('dark')
  window.localStorage.clear()
})

describe('ProductOnboarding API-fake interaction', () => {
  it('offers path-free choose and reopen actions from no-workspace', async () => {
    const client = lifecycle(closed)
    render(
      <ProductOnboarding
        workspaceClient={createFakeWorkspaceClient({ projects: [], states: [] })}
        lifecycleClient={client}
      />
    )

    expect(await screen.findByText('Open a repository to begin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Choose repository' }))
    await waitFor(() => expect(client.chooseRepository).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('Fixture flow')).toBeNull()
  })

  it('persists the explicit light and dark theme choice', async () => {
    render(
      <ProductOnboarding
        workspaceClient={createFakeWorkspaceClient({ projects: [], states: [] })}
        lifecycleClient={lifecycle(closed)}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Switch to dark theme' }))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(window.localStorage.getItem('canvas-agent-theme')).toBe('dark')

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }))
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(window.localStorage.getItem('canvas-agent-theme')).toBe('light')
  })

  it('hydrates the READY Project and keeps Run disabled until a snapshot is frozen', async () => {
    render(
      <ProductOnboarding
        workspaceClient={createFakeWorkspaceClient()}
        lifecycleClient={lifecycle(ready)}
      />
    )

    expect(await screen.findByText('Workspace overview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dispatch execution' })).toHaveProperty(
      'disabled',
      true
    )
    expect(screen.getByText('Agent ready')).toBeTruthy()
  })

  it('keeps Project inspection visible but blocks execution when Agent authentication is required', async () => {
    const authRequired: AgentRuntimeStatus = {
      provider: 'codex-cli',
      state: 'AUTH_REQUIRED',
      version: 'codex-cli 0.146.0',
      source: 'KNOWN_LOCATION',
      displayPath: '/opt/homebrew/bin/codex',
      lastError: { reasonCode: 'AUTH_REQUIRED', recoverable: true }
    }
    render(
      <ProductOnboarding
        workspaceClient={createFakeWorkspaceClient()}
        lifecycleClient={lifecycle(ready, authRequired)}
      />
    )

    expect(await screen.findByRole('button', { name: 'Configure Agent' })).toBeTruthy()
    expect(await screen.findByText('Workspace overview')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Dispatch execution' })).toHaveProperty(
      'disabled',
      true
    )
  })
})
