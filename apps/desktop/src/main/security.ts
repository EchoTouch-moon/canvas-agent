import type { WebFrameMain } from 'electron'

export function isTrustedSender(frame: WebFrameMain | null): boolean {
  if (!frame) return false

  const senderUrl = new URL(frame.url)
  const devRendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (devRendererUrl) {
    return senderUrl.origin === new URL(devRendererUrl).origin
  }

  return senderUrl.protocol === 'file:'
}
