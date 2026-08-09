const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execSync } = require('node:child_process')
const { _electron: electron } = require('playwright-core')

const DESKTOP = path.resolve(__dirname, '..')

let failures = 0
function step(name, ok) {
  console.log(`[e2e:workspace] ${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures += 1
}

function tempRepo(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ca-ws-${label}-`))
  execSync('git init -b main', { cwd: dir })
  execSync('git config user.name e2e', { cwd: dir })
  execSync('git config user.email e2e@local', { cwd: dir })
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${label}\n`)
  execSync('git add -A && git commit -m init', { cwd: dir })
  return dir
}

function repoName(repo) {
  return path.basename(repo)
}

async function launch(home, testPicker, label) {
  const electronPath = require(path.join(DESKTOP, 'node_modules', 'electron'))
  const env = {
    ...process.env,
    CANVAS_AGENT_E2E: '1',
    CANVAS_AGENT_USER_DATA: home,
    HOME: home
  }
  if (testPicker !== undefined) {
    env.CANVAS_AGENT_TEST_PICKER = testPicker
  }
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--disable-gpu'],
    cwd: DESKTOP,
    env
  })
  console.log(`[e2e:workspace] ${label} launched pid=`, app.process().pid)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (error) =>
    console.log(`[e2e:workspace] ${label} pageerror:`, error && error.message)
  )
  return { app, page }
}

async function command(page, cmd, payload) {
  return page.evaluate(
    async ({ cmd, payload }) => {
      const response = await window.canvasAgent.command({
        requestId: 'e2e-workspace',
        schemaVersion: 1,
        command: cmd,
        payload
      })
      return response
    },
    { cmd, payload }
  )
}

async function cancelScenario(home) {
  const { app, page } = await launch(home, '__CANCEL__', 'C')
  try {
    const before = await command(page, 'workspace.status', {})
    step(
      'C fresh status is CLOSED without env vars',
      before.ok && before.data.state === 'CLOSED' && before.data.activeWorkspace === null
    )

    const chosen = await command(page, 'workspace.chooseRepository', {})
    step(
      'C picker cancel returns a typed cancelled result',
      chosen.ok && chosen.data.cancelled === true
    )
    step(
      'C cancel keeps the prior status byte-for-byte (CLOSED, no lastError)',
      chosen.ok && JSON.stringify(chosen.data.status) === JSON.stringify(before.data)
    )
  } catch (error) {
    step('C cancel scenario', false)
    console.log('[e2e:workspace] C ERROR:', error && error.message)
  }
  await app.close()
}

async function chooseScenario(home, repo) {
  const canonicalRepo = fs.realpathSync(repo)
  const { app, page } = await launch(home, repo, 'D')
  try {
    const chosen = await command(page, 'workspace.chooseRepository', {})
    step('D chooseRepository reaches READY', chosen.ok && chosen.data.status.state === 'READY')
    step(
      'D READY summary shows the chosen repository',
      chosen.ok &&
        chosen.data.status.activeWorkspace.repositoryName === repoName(repo) &&
        !chosen.data.status.lastError
    )

    const status = await command(page, 'workspace.status', {})
    step(
      'D workspace.status is READY with the active summary',
      status.ok &&
        status.data.state === 'READY' &&
        status.data.activeWorkspace.displayPath === canonicalRepo
    )

    const closed = await command(page, 'workspace.close', {})
    step('D workspace.close returns CLOSED', closed.ok && closed.data.state === 'CLOSED')
    const after = await command(page, 'workspace.status', {})
    step(
      'D status is CLOSED with no active workspace after close',
      after.ok && after.data.state === 'CLOSED' && after.data.activeWorkspace === null
    )
  } catch (error) {
    step('D choose scenario', false)
    console.log('[e2e:workspace] D ERROR:', error && error.message)
  }
  await app.close()
}

async function reopenScenario(home, repo) {
  const canonicalRepo = fs.realpathSync(repo)
  const { app, page } = await launch(home, undefined, 'R')
  try {
    const status = await command(page, 'workspace.status', {})
    step(
      'R startup auto-reopens the last repository',
      status.ok &&
        status.data.state === 'READY' &&
        status.data.activeWorkspace.displayPath === canonicalRepo
    )
  } catch (error) {
    step('R reopen scenario', false)
    console.log('[e2e:workspace] R ERROR:', error && error.message)
  }
  await app.close()
}

async function chooseAnotherScenario(home, repoA, repoB) {
  const canonicalRepoB = fs.realpathSync(repoB)
  const { app, page } = await launch(home, repoB, 'E')
  try {
    const chosen = await command(page, 'workspace.chooseRepository', {})
    step(
      'E chooseRepository switches to the second repository',
      chosen.ok &&
        chosen.data.status.state === 'READY' &&
        chosen.data.status.activeWorkspace.repositoryName === repoName(repoB)
    )
    const status = await command(page, 'workspace.status', {})
    step(
      'E active workspace is now repository B (distinct identity)',
      status.ok &&
        status.data.activeWorkspace.displayPath === canonicalRepoB &&
        /^[a-f0-9]{64}$/.test(status.data.activeWorkspace.identity)
    )
    await command(page, 'workspace.close', {})
  } catch (error) {
    step('E choose another scenario', false)
    console.log('[e2e:workspace] E ERROR:', error && error.message)
  }
  await app.close()
}

function findBuiltApp() {
  const dist = path.join(DESKTOP, 'dist')
  if (!fs.existsSync(dist)) return null
  for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const appDir = path.join(dist, entry.name)
    for (const candidate of fs.readdirSync(appDir)) {
      if (candidate.endsWith('.app')) {
        const appPath = path.join(appDir, candidate)
        const binary = path.join(appPath, 'Contents', 'MacOS', candidate.replace(/\.app$/, ''))
        if (fs.existsSync(binary)) return { appPath, binary }
      }
    }
  }
  return null
}

async function packagedOpenViaTestPicker(repo) {
  const built = findBuiltApp()
  if (!built) {
    step('P packaged .app opens a temp repo via test picker', false)
    console.log('[e2e:workspace] no packaged .app found; run "build:unpack:unsigned" first')
    return
  }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-ws-packaged-home-'))
  const app = await electron.launch({
    executablePath: built.binary,
    args: ['--disable-gpu'],
    env: {
      ...process.env,
      CANVAS_AGENT_E2E: '1',
      CANVAS_AGENT_USER_DATA: home,
      CANVAS_AGENT_TEST_PICKER: repo,
      HOME: home
    }
  })
  console.log('[e2e:workspace] P packaged app launched pid=', app.process().pid)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (error) =>
    console.log('[e2e:workspace] P pageerror:', error && error.message)
  )
  try {
    const chosen = await command(page, 'workspace.chooseRepository', {})
    step(
      'P packaged .app opens a temp repo via test picker',
      chosen.ok &&
        chosen.data.status.state === 'READY' &&
        chosen.data.status.activeWorkspace.repositoryName === repoName(repo)
    )
    if (!chosen.ok) {
      console.log('[e2e:workspace] P chooseRepository failed:', JSON.stringify(chosen))
    }
  } catch (error) {
    step('P packaged .app opens a temp repo via test picker', false)
    console.log('[e2e:workspace] P ERROR:', error && error.message)
  }
  await app.close()
}

async function main() {
  const repoA = tempRepo('a')
  const repoB = tempRepo('b')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-ws-home-'))
  console.log('[e2e:workspace] home=', home)
  console.log('[e2e:workspace] repoA=', repoA)
  console.log('[e2e:workspace] repoB=', repoB)

  await cancelScenario(home)
  await chooseScenario(home, repoA)
  await reopenScenario(home, repoA)
  await chooseAnotherScenario(home, repoA, repoB)
  await packagedOpenViaTestPicker(repoA)

  console.log(
    failures === 0 ? '[e2e:workspace] ALL PASSED' : `[e2e:workspace] FAILED (${failures})`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.log('[e2e:workspace] FATAL', error && error.stack ? error.stack : error)
  process.exit(1)
})
