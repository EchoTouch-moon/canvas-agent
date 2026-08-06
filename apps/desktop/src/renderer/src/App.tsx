import { CoreFlowWorkspace } from '@/components/app/core-flow-workspace'
import { useRuntimeInfo } from '@/hooks/use-runtime-info'

function App(): React.JSX.Element {
  const runtimeInfo = useRuntimeInfo()
  return <CoreFlowWorkspace runtimeInfo={runtimeInfo} />
}

export default App
