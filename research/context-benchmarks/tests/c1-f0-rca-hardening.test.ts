import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  C1F0ProspectiveToolExecutor,
  type C1F0ToolRequest
} from '../c1/f0/hardening/c1-f0-tool-hardening'

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

function bashRequest(command: string, toolCallId = 'bash-01'): C1F0ToolRequest {
  return {
    toolCallId,
    toolName: 'bash',
    argumentsJson: JSON.stringify({ command })
  }
}

function editRequest(toolCallId = 'edit-01'): C1F0ToolRequest {
  return {
    toolCallId,
    toolName: 'edit',
    argumentsJson: JSON.stringify({ path: 'source.js', oldText: 'missing', newText: 'changed' })
  }
}

describe('F0 prospective provenance and tool recovery hardening', () => {
  it('attributes a bash collateral write without persisting command text', async () => {
    const root = await tempRoot('canvas-c1-f0-provenance-')
    try {
      await writeFile(join(root, 'README.md'), 'fixture\n', 'utf8')
      const executor = new C1F0ProspectiveToolExecutor(root, { provenanceEnabled: true })
      const result = await executor.execute([
        bashRequest("printf 'side effect' > package-lock.json", 'bash-side-effect')
      ])
      const execution = result.executions[0]
      expect(execution?.result).toBe('SUCCESS')
      expect(execution?.provenance).toMatchObject({
        failureClass: 'NONE',
        commandClass: 'SHELL_OTHER',
        changedPaths: ['package-lock.json'],
        sideEffectSource: 'BASH_TOOL',
        snapshotStatus: 'COMPLETE',
        repeatCount: 0,
        recoveryAction: 'NONE'
      })
      expect(execution?.provenance.commandHash).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(execution?.provenance)).not.toContain('side effect')
      expect(await readFile(join(root, 'package-lock.json'), 'utf8')).toBe('side effect')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('classifies edit failures and blocks repeated identical requests', async () => {
    const root = await tempRoot('canvas-c1-f0-recovery-')
    try {
      await writeFile(join(root, 'source.js'), 'stable\n', 'utf8')
      const executor = new C1F0ProspectiveToolExecutor(root, {
        provenanceEnabled: true,
        recoveryPolicy: { enabled: true, maxIdenticalFailureAttempts: 2 }
      })
      const first = await executor.execute([editRequest('edit-01')])
      const second = await executor.execute([editRequest('edit-02')])
      const third = await executor.execute([editRequest('edit-03')])
      expect(first.executions[0]?.provenance).toMatchObject({
        failureClass: 'EDIT_MATCH_COUNT',
        repeatCount: 1,
        recoveryAction: 'REISSUE_CORRECTED_ARGUMENTS'
      })
      expect(second.executions[0]?.provenance).toMatchObject({
        failureClass: 'EDIT_MATCH_COUNT',
        repeatCount: 2,
        recoveryAction: 'REISSUE_CORRECTED_ARGUMENTS'
      })
      expect(third.executions[0]?.provenance).toMatchObject({
        failureClass: 'REPEATED_FAILURE_BLOCKED',
        repeatCount: 3,
        recoveryAction: 'BLOCKED_REPEATED_FAILURE'
      })
      expect(third.resultContents.get('edit-03')).toContain('C1_F0_RECOVERY')
      expect(third.recoverySummary.blockedRepeatedFailures).toBe(1)
      expect(await readFile(join(root, 'source.js'), 'utf8')).toBe('stable\n')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('classifies command failures and keeps side-effect provenance bounded', async () => {
    const root = await tempRoot('canvas-c1-f0-command-')
    try {
      await writeFile(join(root, 'README.md'), 'fixture\n', 'utf8')
      const executor = new C1F0ProspectiveToolExecutor(root, {
        provenanceEnabled: true,
        commandTimeoutMs: 100
      })
      const result = await executor.execute([bashRequest('exit 7', 'bash-failed')])
      expect(result.executions[0]?.result).toBe('ERROR')
      expect(result.executions[0]?.provenance).toMatchObject({
        failureClass: 'COMMAND_FAILED',
        commandClass: 'SHELL_OTHER',
        changedPaths: [],
        sideEffectSource: 'NONE',
        recoveryAction: 'INSPECT_COMMAND_RESULT'
      })
      expect(result.executions[0]?.provenance.errorDigest).toMatch(/^[a-f0-9]{64}$/)
      expect(JSON.stringify(result.executions[0]?.provenance)).not.toContain('exit 7')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
