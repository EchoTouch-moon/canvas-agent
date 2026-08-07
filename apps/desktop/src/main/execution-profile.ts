import type { ExecutionRequestContract } from '@canvas-agent/contracts'

/**
 * The single Main-owned execution profile. The Renderer never supplies these
 * fields; swapping the adapter (fixture -> real Agent) only changes this object.
 */
export const PHASE3_EXECUTION_PROFILE = {
  requiredCapabilities: ['git', 'node'],
  agentConfiguration: { provider: 'fixture', model: 'deterministic' },
  toolPolicy: {
    allowedTools: ['write_file', 'run_command'],
    deniedPaths: [],
    allowNetwork: false,
    allowShell: true
  },
  workspaceStrategy: 'ISOLATED_WORKTREE',
  resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 20, maxDiskBytes: 1_000_000_000 }
} satisfies Pick<
  ExecutionRequestContract,
  | 'requiredCapabilities'
  | 'agentConfiguration'
  | 'toolPolicy'
  | 'workspaceStrategy'
  | 'resourceBudget'
>
