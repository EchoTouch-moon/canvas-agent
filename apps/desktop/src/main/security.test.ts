import { afterEach, describe, expect, it } from 'vitest'
import { isTrustedSender } from './security'

function frame(url: string): unknown {
  return { url } as never
}

const env = process.env as Record<string, string | undefined>

describe('isTrustedSender (workspace command gate)', () => {
  afterEach(() => {
    delete env['ELECTRON_RENDERER_URL']
  })

  it('trusts a null-protocol file renderer (packaged)', () => {
    expect(
      isTrustedSender(
        frame('file:///Applications/Canvas%20Agent.app/out/renderer/index.html') as never
      )
    ).toBe(true)
  })

  it('trusts the dev server origin when ELECTRON_RENDERER_URL is set', () => {
    env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    expect(isTrustedSender(frame('http://localhost:5173/') as never)).toBe(true)
  })

  it('rejects a foreign origin and a null frame', () => {
    env['ELECTRON_RENDERER_URL'] = 'http://localhost:5173'
    expect(isTrustedSender(frame('https://evil.example/') as never)).toBe(false)
    expect(isTrustedSender(null)).toBe(false)
  })

  it('rejects a non-file origin in packaged mode', () => {
    expect(isTrustedSender(frame('https://evil.example/') as never)).toBe(false)
  })
})
