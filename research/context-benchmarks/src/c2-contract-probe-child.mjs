import { createRequire, Module } from 'node:module'
import { join } from 'node:path'

const fixturePath = process.argv[2]

function readExport(value, key) {
  if (typeof value !== 'object' || value === null) return undefined
  return value[key]
}

function invoke(value, args) {
  return typeof value === 'function' ? Reflect.apply(value, undefined, args) : undefined
}

function createProbeModule(path, exports) {
  const probe = new Module(path)
  probe.filename = path
  probe.loaded = true
  probe.exports = exports
  return probe
}

function sendResult(result, exitCode) {
  const message = JSON.stringify({
    version: 1,
    type: 'cr005-c2-contract-result',
    ...result
  })
  if (typeof process.send !== 'function') {
    process.exitCode = 2
    return
  }
  try {
    process.send(message, () => process.exit(exitCode))
  } catch {
    process.exitCode = exitCode
  }
}

function main() {
  if (typeof fixturePath !== 'string' || fixturePath.length === 0) {
    sendResult({ configRuntime: false, greetingRuntime: false, indexForwarding: false }, 2)
    return
  }

  const indexPath = join(fixturePath, 'src/index.js')
  const greetingPath = join(fixturePath, 'src/greeting.js')
  const configPath = join(fixturePath, 'src/config.js')
  const fixtureRequire = createRequire(indexPath)
  const configCachePath = fixtureRequire.resolve(configPath)
  const greetingCachePath = fixtureRequire.resolve(greetingPath)
  const indexCachePath = fixtureRequire.resolve(indexPath)
  const modulePaths = [configCachePath, greetingCachePath, indexCachePath]
  const originalCache = new Map(modulePaths.map((path) => [path, fixtureRequire.cache[path]]))

  try {
    for (const path of modulePaths) delete fixtureRequire.cache[path]
    const config = fixtureRequire(configPath)
    const configRuntime =
      readExport(config, 'DEFAULT_GREETING') === 'Hello' &&
      readExport(config, 'DEFAULT_PUNCTUATION') === '!'

    const probePunctuation = '<probe-punctuation>'
    fixtureRequire.cache[configCachePath] = createProbeModule(configCachePath, {
      DEFAULT_GREETING: 'ProbeGreeting',
      DEFAULT_PUNCTUATION: probePunctuation
    })
    delete fixtureRequire.cache[greetingCachePath]
    const greeting = fixtureRequire(greetingPath)
    const makeGreeting = readExport(greeting, 'makeGreeting')
    const greetingDefault = invoke(makeGreeting, ['Ada', { formal: false }])
    const greetingFormal = invoke(makeGreeting, ['Ada', { formal: true }])
    const greetingRuntime =
      greetingDefault === 'ProbeGreeting, Ada' &&
      greetingFormal === `ProbeGreeting, Ada${probePunctuation}`

    const forwardedCalls = []
    const forwardedResult = 'INDEX_FORWARDED_SENTINEL'
    fixtureRequire.cache[greetingCachePath] = createProbeModule(greetingCachePath, {
      makeGreeting: (name, options) => {
        forwardedCalls.push({ name, options })
        return forwardedResult
      }
    })
    delete fixtureRequire.cache[indexCachePath]
    const index = fixtureRequire(indexPath)
    const greetProfile = readExport(index, 'greetProfile')
    const indexOutput = invoke(greetProfile, [{ name: 'Ada', formal: true }])
    const firstForwardedCall = forwardedCalls[0]
    const indexForwarding =
      forwardedCalls.length === 1 &&
      indexOutput === forwardedResult &&
      firstForwardedCall?.name === 'Ada' &&
      readExport(firstForwardedCall.options, 'formal') === true

    sendResult({ configRuntime, greetingRuntime, indexForwarding }, 0)
  } catch {
    sendResult({ configRuntime: false, greetingRuntime: false, indexForwarding: false }, 1)
  } finally {
    for (const [path, entry] of originalCache) {
      if (entry === undefined) delete fixtureRequire.cache[path]
      else fixtureRequire.cache[path] = entry
    }
  }
}

main()
