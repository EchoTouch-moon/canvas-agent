import { describe, expect, it } from 'vitest'
import { isSupportedCodexVersion, parseCodexVersion } from '../src'

describe('isSupportedCodexVersion (frozen 0.146.x for v1)', () => {
  it('accepts stable 0.146.x releases', () => {
    expect(isSupportedCodexVersion('codex-cli 0.146.0')).toBe(true)
    expect(isSupportedCodexVersion('codex-cli 0.146.3')).toBe(true)
    expect(isSupportedCodexVersion('codex-cli v0.146.1')).toBe(true)
    expect(isSupportedCodexVersion('codex-cli 0.146.0+build.5')).toBe(true)
    expect(parseCodexVersion('codex-cli 0.146.7')).toEqual({ major: 0, minor: 146, patch: 7 })
  })

  it('rejects other minors, majors and prereleases', () => {
    expect(isSupportedCodexVersion('codex-cli 0.145.0')).toBe(false)
    expect(isSupportedCodexVersion('codex-cli 0.147.0')).toBe(false)
    expect(isSupportedCodexVersion('codex-cli 1.0.0')).toBe(false)
    expect(isSupportedCodexVersion('codex-cli 0.146.0-rc.1')).toBe(false)
    expect(isSupportedCodexVersion('codex-cli 0.146')).toBe(false)
    expect(isSupportedCodexVersion('codex-cli')).toBe(false)
  })

  it('rejects non-semver garbage', () => {
    expect(isSupportedCodexVersion('codex-cli garbage')).toBe(false)
    expect(isSupportedCodexVersion('codex-cli not-a-version')).toBe(false)
    expect(isSupportedCodexVersion('')).toBe(false)
    expect(parseCodexVersion('codex-cli garbage')).toBeNull()
  })
})
