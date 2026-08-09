/**
 * Shared Codex CLI version support decision, used by the Main AgentRuntimeLocator
 * (readiness) and the Worker Codex adapter (DS-005B) so agent.status READY and
 * execution-time selection can never disagree.
 *
 * The v1 adapter freezes support to the stable `0.146.x` line. Other minors,
 * majors and prereleases fail closed to AGENT_EXECUTABLE_NOT_SUPPORTED. Semver
 * build metadata does not make a release a prerelease, so `0.146.0+build` is
 * accepted.
 */
const SUPPORTED_CODEX_VERSION_RE = /^codex-cli\s+v?0\.146\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/

export interface ParsedCodexVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
}

export function parseCodexVersion(text: string): ParsedCodexVersion | null {
  const match = SUPPORTED_CODEX_VERSION_RE.exec(text.trim())
  if (match === null) {
    return null
  }
  return { major: 0, minor: 146, patch: Number(match[1]) }
}

export function isSupportedCodexVersion(text: string): boolean {
  return parseCodexVersion(text) !== null
}
