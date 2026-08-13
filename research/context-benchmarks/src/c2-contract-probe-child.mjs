import { createRequire, Module } from 'node:module'
import { join } from 'node:path'

const fixturePath = process.argv[2]
const CONFIG_SENTINEL = 'C2_CONFIG_SENTINEL'
const INDEX_SENTINEL = 'C2_INDEX_SENTINEL'

function readExport(value, key) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return undefined
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

function createConfigProbeExports() {
  const sentinelValue = new Proxy((..._args) => CONFIG_SENTINEL, {
    apply() {
      return CONFIG_SENTINEL
    },
    get(_target, property) {
      if (property === Symbol.toPrimitive || property === 'toString' || property === 'valueOf') {
        return () => CONFIG_SENTINEL
      }
      return sentinelValue
    }
  })
  return new Proxy({}, {
    get(_target, property) {
      return typeof property === 'string' ? sentinelValue : undefined
    }
  })
}

function clearModules(cache, paths) {
  for (const path of paths) delete cache[path]
}

function callableExports(value) {
  if (typeof value === 'function') return [value]
  if (typeof value !== 'object' || value === null) return []
  return Reflect.ownKeys(value)
    .filter((key) => typeof key === 'string')
    .map((key) => value[key])
    .filter((entry) => typeof entry === 'function')
}

function observeDependency(parentPath, dependencyPath, load) {
  const originalLoad = Module._load
  let observed = false
  Module._load = function (request, parent, isMain) {
    const parentFilename = parent?.filename
    let resolved = null
    if (parentFilename === parentPath) {
      try {
        resolved = Module._resolveFilename(request, parent)
      } catch {
        resolved = null
      }
    }
    const result = Reflect.apply(originalLoad, this, arguments)
    if (resolved === dependencyPath) observed = true
    return result
  }
  try {
    return { value: load(), observed }
  } finally {
    Module._load = originalLoad
  }
}

function outputUsesConfigForFormalResult(value) {
  if (typeof value !== 'string') return false
  const nameIndex = value.indexOf('Ada')
  const configIndex = value.lastIndexOf(CONFIG_SENTINEL)
  return nameIndex >= 0 && configIndex > nameIndex
}

const greetingCallShapes = [
  {
    defaultArgs: [{ name: 'Ada', formal: false }],
    formalArgs: [{ name: 'Ada', formal: true }]
  },
  {
    defaultArgs: ['Ada', { formal: false }],
    formalArgs: ['Ada', { formal: true }]
  },
  {
    defaultArgs: ['Ada', false],
    formalArgs: ['Ada', true]
  }
]

function greetingUsesConfigForFormalBehavior(greeting) {
  for (const candidate of callableExports(greeting)) {
    for (const shape of greetingCallShapes) {
      try {
        const defaultOutput = invoke(candidate, shape.defaultArgs)
        const formalOutput = invoke(candidate, shape.formalArgs)
        if (
          typeof defaultOutput === 'string' &&
          typeof formalOutput === 'string' &&
          defaultOutput !== formalOutput &&
          outputUsesConfigForFormalResult(formalOutput)
        ) {
          return true
        }
      } catch {
        // Try the next callable export/signature. The fixture remains untrusted.
      }
    }
  }
  return false
}

function containsName(value, depth = 0) {
  if (depth > 4) return false
  if (value === 'Ada') return true
  if (typeof value !== 'object' || value === null) return false
  if (value.name === 'Ada') return true
  return Object.values(value).some((entry) => containsName(entry, depth + 1))
}

function containsFormalSignal(value, depth = 0) {
  if (depth > 4) return false
  if (value === true || value === 'formal') return true
  if (typeof value !== 'object' || value === null) return false
  if (
    value.formal === true ||
    value.isFormal === true ||
    value.style === 'formal' ||
    value.mode === 'formal'
  ) {
    return true
  }
  return Object.values(value).some((entry) => containsFormalSignal(entry, depth + 1))
}

function callCarriesProfileSemantics(args) {
  return args.some((value) => containsName(value)) && args.some((value) => containsFormalSignal(value))
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
    // Load the untrusted config once before any dependency injection. This
    // preserves fail-closed behavior for exit/hang/output-limit fixtures.
    clearModules(fixtureRequire.cache, modulePaths)
    fixtureRequire(configPath)

    clearModules(fixtureRequire.cache, modulePaths)
    fixtureRequire.cache[configCachePath] = createProbeModule(configCachePath, createConfigProbeExports())
    const indexWithConfigProbe = fixtureRequire(indexPath)
    const greetProfileWithConfigProbe = readExport(indexWithConfigProbe, 'greetProfile')
    const configDefaultOutput = invoke(greetProfileWithConfigProbe, [{ name: 'Ada', formal: false }])
    const configFormalOutput = invoke(greetProfileWithConfigProbe, [{ name: 'Ada', formal: true }])
    const configRuntime =
      typeof configDefaultOutput === 'string' &&
      typeof configFormalOutput === 'string' &&
      configFormalOutput !== configDefaultOutput &&
      outputUsesConfigForFormalResult(configFormalOutput)

    clearModules(fixtureRequire.cache, modulePaths)
    fixtureRequire.cache[configCachePath] = createProbeModule(configCachePath, createConfigProbeExports())
    const greetingLoad = observeDependency(
      greetingCachePath,
      configCachePath,
      () => fixtureRequire(greetingPath)
    )
    const greetingRuntime =
      greetingLoad.observed && greetingUsesConfigForFormalBehavior(greetingLoad.value)

    clearModules(fixtureRequire.cache, modulePaths)
    const forwardedCalls = []
    fixtureRequire.cache[greetingCachePath] = createProbeModule(
      greetingCachePath,
      new Proxy({}, {
        get(_target, property) {
          if (typeof property !== 'string') return undefined
          return (...args) => {
            forwardedCalls.push(args)
            return INDEX_SENTINEL
          }
        }
      })
    )
    const index = fixtureRequire(indexPath)
    const greetProfile = readExport(index, 'greetProfile')
    const indexOutput = invoke(greetProfile, [{ name: 'Ada', formal: true }])
    const indexForwarding =
      forwardedCalls.length === 1 &&
      indexOutput === INDEX_SENTINEL &&
      callCarriesProfileSemantics(forwardedCalls[0])

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
