import { WorkerService } from './worker-service'
import { workerHostResponseSchema, type WorkerHostResponse } from './protocol'

const parentPort = process.parentPort

function main(): void {
  if (!parentPort) {
    console.error('[worker] missing parentPort — must run inside an Electron Utility Process')
    process.exit(1)
  }

  const service = new WorkerService({
    send(response: WorkerHostResponse): void {
      const parsed = workerHostResponseSchema.parse(response)
      parentPort.postMessage(parsed)
    }
  })

  parentPort.on('message', (event: { data: unknown }) => {
    void service.onRequest(event.data)
  })
}

main()
