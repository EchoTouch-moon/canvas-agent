import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  handle: vi.fn(),
  fromWebContents: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents }
}))

import { registerCommandRouter } from './command-router'
import { WorkspaceRuntimeManager } from './workspace-runtime-manager'
import { AgentRuntimeLocator } from './agent-runtime-locator'

function makeManager(): WorkspaceRuntimeManager {
  return new WorkspaceRuntimeManager({
    userData: '/tmp/ca-router-test-userdata',
    picker: { pick: async () => ({ cancelled: true, path: null }) },
    bootstrapPath: null
  })
}

function makeAgent(): AgentRuntimeLocator {
  return new AgentRuntimeLocator({
    userData: '/tmp/ca-router-agent-userdata',
    homePath: '/tmp',
    environment: { PATH: '/usr/bin:/bin', HOME: '/tmp' },
    picker: { pick: async () => ({ cancelled: true, path: null }) },
    isChangeBlocked: () => false,
    configurationGate: async (fn) => ({ ok: true, value: await fn() })
  })
}

function commandFrame(): {
  requestId: string
  schemaVersion: 1
  command: string
  payload: Record<string, never>
} {
  return { requestId: 'req_1', schemaVersion: 1, command: 'workspace.status', payload: {} }
}

function captureHandler(): (event: unknown, payload: unknown) => Promise<unknown> {
  registerCommandRouter({ manager: makeManager(), agent: makeAgent() })
  const calls = electronMocks.handle.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1][1] as (event: unknown, payload: unknown) => Promise<unknown>
}

describe('command router security boundary (real IPC handler)', () => {
  beforeEach(() => {
    electronMocks.handle.mockClear()
    electronMocks.fromWebContents.mockClear()
  })

  it('rejects a trusted file: subframe before opening the picker', async () => {
    const handler = captureHandler()
    const trustedFileUrl = 'file:///Applications/Canvas%20Agent.app/out/renderer/index.html'
    const subframe = { url: trustedFileUrl }
    const mainFrame = { url: trustedFileUrl }
    const event = { senderFrame: subframe, sender: { mainFrame } }

    expect(() => handler(event, commandFrame())).toThrow(/non-main renderer frame/)
    expect(electronMocks.fromWebContents).not.toHaveBeenCalled()
  })

  it('rejects an untrusted origin frame at the router boundary', async () => {
    const handler = captureHandler()
    const subframe = { url: 'https://evil.example/' }
    const mainFrame = { url: 'file:///app/out/renderer/index.html' }
    const event = { senderFrame: subframe, sender: { mainFrame } }

    expect(() => handler(event, commandFrame())).toThrow(/untrusted renderer/)
    expect(electronMocks.fromWebContents).not.toHaveBeenCalled()
  })

  it('serves a trusted main frame through the real IPC command path', async () => {
    const handler = captureHandler()
    const mainFrame = { url: 'file:///Applications/Canvas%20Agent.app/out/renderer/index.html' }
    const event = { senderFrame: mainFrame, sender: { mainFrame } }

    const response = (await handler(event, commandFrame())) as {
      ok: boolean
      data?: { state: string }
    }
    expect(response.ok).toBe(true)
    expect(response.data?.state).toBe('CLOSED')
    expect(electronMocks.fromWebContents).toHaveBeenCalled()
  })
})
