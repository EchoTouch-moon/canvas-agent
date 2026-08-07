import { describe, expect, it } from 'vitest'
import { HostUnavailableError } from './command-errors'
import { UnavailableWorkerHost } from './worker-host'

describe('WorkerHost', () => {
  it('UnavailableWorkerHost rejects dispatch and cancel', async () => {
    const host = new UnavailableWorkerHost()

    await expect(host.dispatch({} as never)).rejects.toThrow(HostUnavailableError)
    await expect(host.cancel('req_1')).rejects.toThrow(HostUnavailableError)
    await expect(host.dispose()).resolves.toBeUndefined()
  })
})
