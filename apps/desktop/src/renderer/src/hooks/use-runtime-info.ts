import { useEffect, useState } from 'react'
import type { RuntimeInfo } from '@canvas-agent/contracts'

export function useRuntimeInfo(): RuntimeInfo | null {
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)

  useEffect(() => {
    if (!('canvasAgent' in window)) {
      return
    }

    let active = true

    void window.canvasAgent
      .getRuntimeInfo()
      .then((value) => {
        if (active) setRuntimeInfo(value)
      })
      .catch(() => {
        if (active) setRuntimeInfo(null)
      })

    return () => {
      active = false
    }
  }, [])

  return runtimeInfo
}
