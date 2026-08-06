import type { CanvasAgentDesktopApi } from '@canvas-agent/contracts'

declare global {
  interface Window {
    canvasAgent: CanvasAgentDesktopApi
  }
}

export {}
