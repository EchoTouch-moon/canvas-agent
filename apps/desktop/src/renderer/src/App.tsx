import { CoreFlowWorkspace } from '@/components/app/core-flow-workspace'
import { useRuntimeInfo } from '@/hooks/use-runtime-info'
import { useI18n } from '@/lib/i18n'

function App(): React.JSX.Element {
  const runtimeInfo = useRuntimeInfo()
  const { locale } = useI18n()

  return <CoreFlowWorkspace key={locale} runtimeInfo={runtimeInfo} />
}

export default App
