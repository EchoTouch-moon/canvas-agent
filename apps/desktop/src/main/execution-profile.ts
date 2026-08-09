import type { ExecutionRequestContract } from '@canvas-agent/contracts'

/**
 * The single Main-owned production execution profile. The Renderer never
 * supplies these fields. Provider selection is frozen to the Codex CLI adapter
 * with the approved 15-minute / 100-tool-call / 1-GiB limits; model is
 * `configured-by-user` and recorded as request evidence.
 */
export const PHASE3_EXECUTION_PROFILE = {
  requiredCapabilities: ['git', 'node'],
  agentConfiguration: { provider: 'codex-cli', model: 'configured-by-user' },
  toolPolicy: {
    allowedTools: ['write_file', 'run_command'],
    deniedPaths: [],
    allowNetwork: false,
    allowShell: true
  },
  workspaceStrategy: 'ISOLATED_WORKTREE',
  resourceBudget: { maxDurationMs: 900_000, maxToolCalls: 100, maxDiskBytes: 1_000_000_000 }
} satisfies Pick<
  ExecutionRequestContract,
  | 'requiredCapabilities'
  | 'agentConfiguration'
  | 'toolPolicy'
  | 'workspaceStrategy'
  | 'resourceBudget'
>
