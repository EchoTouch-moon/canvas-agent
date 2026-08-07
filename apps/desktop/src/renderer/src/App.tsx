import { useState } from 'react'
import { CoreFlowWorkspace } from '@/components/app/core-flow-workspace'
import { LiveWorkspaceView } from '@/components/app/live-workspace-view'
import { useRuntimeInfo } from '@/hooks/use-runtime-info'
import { useI18n } from '@/lib/i18n'

type AppMode = 'live' | 'fixture'

function App(): React.JSX.Element {
  const runtimeInfo = useRuntimeInfo()
  const { locale } = useI18n()
  const [mode, setMode] = useState<AppMode>('fixture')

  return (
    <div className="relative">
      <div className="fixed right-3 top-3 z-50 flex items-center gap-1 rounded-[var(--radius-control)] border border-border bg-background p-1 shadow-sm">
        <button
          type="button"
          onClick={() => setMode('live')}
          className={`rounded-[var(--radius-control)] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            mode === 'live'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          Live workspace
        </button>
        <button
          type="button"
          onClick={() => setMode('fixture')}
          className={`rounded-[var(--radius-control)] px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            mode === 'fixture'
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          }`}
        >
          Fixture flow
        </button>
      </div>
      {mode === 'live' ? (
        <LiveWorkspaceView />
      ) : (
        <CoreFlowWorkspace key={locale} runtimeInfo={runtimeInfo} />
      )}
    </div>
  )
}

export default App
