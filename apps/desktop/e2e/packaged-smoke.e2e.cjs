const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { createHash } = require('node:crypto')
const { spawn, execFileSync } = require('node:child_process')
const { DatabaseSync } = require('node:sqlite')

const DESKTOP = path.resolve(__dirname, '..')

let failures = 0
function step(name, ok) {
  console.log(`[packaged-smoke] ${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures += 1
}

function findBuiltApp() {
  const dist = path.join(DESKTOP, 'dist')
  if (!fs.existsSync(dist)) {
    throw new Error(
      `no dist directory; run "pnpm --filter @canvas-agent/desktop build:unpack:unsigned" first (${dist})`
    )
  }
  for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const appDir = path.join(dist, entry.name)
    for (const candidate of fs.readdirSync(appDir)) {
      if (candidate.endsWith('.app')) {
        const appPath = path.join(appDir, candidate)
        const binary = path.join(appPath, 'Contents', 'MacOS', candidate.replace(/\.app$/, ''))
        if (fs.existsSync(binary)) {
          return { appPath, binary }
        }
      }
    }
  }
  throw new Error(`no packaged .app binary found under ${dist}`)
}

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-pkg-repo-'))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'smoke'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'smoke@local'], { cwd: dir, stdio: 'ignore' })
  fs.writeFileSync(path.join(dir, 'README.md'), '# packaged smoke\n')
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir, stdio: 'ignore' })
  return dir
}

function appTables(dbPath) {
  if (!fs.existsSync(dbPath)) return []
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
    return rows.map((row) => row.name)
  } finally {
    db.close()
  }
}

function launchAndCapture(binary, env, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(binary, [], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    let settled = false
    const finish = (kind) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ kind, code: child.exitCode, stdout, stderr })
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish('timeout')
    }, timeoutMs)
    child.on('exit', (code, signal) => finish(signal === null ? 'exit' : `signal:${signal}`))
    child.on('error', (error) => {
      stderr += `\nspawn error: ${error.message}`
      finish('spawn-error')
    })
  })
}

async function waitForReady(binary, env, readyMarker, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(binary, [], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      if (stdout.includes(readyMarker) || stderr.includes(readyMarker)) {
        resolve({ ready: true, child, stdout, stderr })
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
      if (stdout.includes(readyMarker) || stderr.includes(readyMarker)) {
        resolve({ ready: true, child, stdout, stderr })
      }
    })
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ ready: false, child, stdout, stderr })
    }, timeoutMs)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ ready: false, child, stdout, stderr, exitCode: code })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      stderr += `\nspawn error: ${error.message}`
      resolve({ ready: false, child, stdout, stderr })
    })
  })
}

async function positiveCase(binary) {
  const repo = tempRepo()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-pkg-home-'))
  const canonicalRepo = fs.realpathSync(repo)
  const identity = createHash('sha256').update(canonicalRepo, 'utf8').digest('hex')
  const dbPath = path.join(home, 'workspaces', identity, 'canvas-agent.db')
  const env = {
    CANVAS_AGENT_REPO: repo,
    CANVAS_AGENT_USER_DATA: home,
    HOME: home
  }
  const result = await waitForReady(binary, env, '[workspace] ready at ', 90_000)
  if (result.ready) {
    result.child.kill('SIGTERM')
    setTimeout(() => result.child.kill('SIGKILL'), 2000).unref()
  } else {
    console.log('[packaged-smoke] positive app did not reach ready.')
    console.log('[packaged-smoke] === STDOUT ===\n' + result.stdout.slice(0, 4000))
    console.log('[packaged-smoke] === STDERR ===\n' + result.stderr.slice(0, 4000))
  }
  step('packaged cold start reaches the ready signal (stderr captured)', result.ready)

  const tables = appTables(dbPath)
  const migrationBookkeeping = tables.includes('__drizzle_migrations')
  const hasProjectTable = tables.includes('project')
  const hasAuditTable = tables.includes('audit_log')
  step(
    'cold start applies migrations (schema created, no ENOENT)',
    migrationBookkeeping && hasProjectTable
  )
  step('schema includes core app tables (project, audit_log)', hasProjectTable && hasAuditTable)
  return { repo, home, dbPath }
}

async function negativeCase(binary, appPath) {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-pkg-stage-'))
  const stagedApp = path.join(staged, path.basename(appPath))
  execFileSync('cp', ['-R', appPath, stagedApp])
  const stagedResourcesDrizzle = path.join(stagedApp, 'Contents', 'Resources', 'drizzle')
  if (fs.existsSync(stagedResourcesDrizzle)) {
    fs.rmSync(stagedResourcesDrizzle, { recursive: true, force: true })
  }
  const stagedBinary = path.join(stagedApp, 'Contents', 'MacOS', path.basename(appPath, '.app'))
  if (!fs.existsSync(stagedBinary)) {
    step('missing-resource fixture preserves the build artifact (temp copy only)', false)
    throw new Error(`staged binary missing: ${stagedBinary}`)
  }
  step('missing-resource fixture uses a temp .app copy (main build untouched)', true)

  const repo = tempRepo()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-pkg-neg-'))
  const canonicalRepo = fs.realpathSync(repo)
  const identity = createHash('sha256').update(canonicalRepo, 'utf8').digest('hex')
  const dbPath = path.join(home, 'workspaces', identity, 'canvas-agent.db')
  const result = await launchAndCapture(
    stagedBinary,
    {
      CANVAS_AGENT_REPO: repo,
      CANVAS_AGENT_USER_DATA: home,
      HOME: home
    },
    30_000
  )
  const log = result.stdout + result.stderr
  step(
    'missing migrations terminate the packaged process with exit code 1',
    result.kind === 'exit' && result.code === 1
  )
  step(
    'stable diagnostic emitted (migration folder not found + FATAL)',
    log.includes('FATAL') && log.includes('migration folder not found')
  )
  const tables = appTables(dbPath)
  step('no application tables created on fatal exit', !tables.includes('project'))
  step('no workspace storage created on fatal exit', !fs.existsSync(path.join(home, 'workspaces')))
  if (result.kind !== 'exit' || result.code !== 1) {
    console.log('[packaged-smoke] negative app did not exit 1 cleanly.')
    console.log('[packaged-smoke] === STDOUT ===\n' + result.stdout.slice(0, 4000))
    console.log('[packaged-smoke] === STDERR ===\n' + result.stderr.slice(0, 4000))
  }
}

function main() {
  const { appPath, binary } = findBuiltApp()
  console.log(`[packaged-smoke] app=${appPath}`)
  console.log(`[packaged-smoke] binary=${binary}`)
  const resourcesDrizzle = path.join(appPath, 'Contents', 'Resources', 'drizzle')
  const resourceTree = fs.existsSync(resourcesDrizzle)
    ? fs.readdirSync(resourcesDrizzle).join(', ')
    : '(missing)'
  console.log(`[packaged-smoke] Contents/Resources/drizzle = [${resourceTree}]`)
  step(
    'packaged app ships migrations outside asar (Contents/Resources/drizzle)',
    fs.existsSync(resourcesDrizzle)
  )
  const migrationSql = path.join(resourcesDrizzle, '20260806140031_init', 'migration.sql')
  step('migration SQL present at the resolver packaged location', fs.existsSync(migrationSql))

  positiveCase(binary)
    .then(() => negativeCase(binary, appPath))
    .then(() => {
      console.log(
        failures === 0 ? '[packaged-smoke] ALL PASSED' : `[packaged-smoke] FAILED (${failures})`
      )
      process.exit(failures === 0 ? 0 : 1)
    })
    .catch((error) => {
      console.log('[packaged-smoke] FATAL', error && error.stack ? error.stack : error)
      process.exit(1)
    })
}

main()
