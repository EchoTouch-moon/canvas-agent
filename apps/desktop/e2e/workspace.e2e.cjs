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

function tempNonGitDirectory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-ws-invalid-'))
  fs.writeFileSync(path.join(dir, 'README.md'), '# not a git repository\n')
  return dir
}

function tempFakeCodex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-ws-fake-codex-'))
  const executable = path.join(dir, 'codex')
  fs.writeFileSync(
    executable,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf 'codex-cli 0.146.0\\n'
  exit 0
fi
if [ "$1" = "login" ] && [ "$2" = "status" ]; then
  exit 0
fi
exit 2
`,
    'utf8'
  )
  fs.chmodSync(executable, 0o755)
  return executable
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

async function invalidRepositoryScenario(home, invalidDirectory) {
  const { app, page } = await launch(home, invalidDirectory, 'I')
  try {
    const chosen = await command(page, 'workspace.chooseRepository', {})
    step(
      'I non-Git repository is rejected with NOT_GIT_WORKTREE',
      chosen.ok &&
        chosen.data.cancelled === false &&
        chosen.data.status.state === 'ERROR' &&
        chosen.data.status.activeWorkspace === null &&
        chosen.data.status.lastError?.reasonCode === 'NOT_GIT_WORKTREE'
    )
    const status = await command(page, 'workspace.status', {})
    step(
      'I invalid repository remains recoverable and creates no active workspace',
      status.ok &&
        status.data.state === 'ERROR' &&
        status.data.activeWorkspace === null &&
        status.data.lastError?.recoverable === true
    )
  } catch (error) {
    step('I invalid repository scenario', false)
    console.log('[e2e:workspace] I ERROR:', error && error.message)
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

async function packagedOpenViaTestPicker(repo, fakeCodex) {
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
      CANVAS_AGENT_TEST_EXECUTABLE: fakeCodex,
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

    const selectedAgent = await command(page, 'agent.chooseExecutable', {})
    step(
      'P packaged .app natively selects and validates the fake Codex launcher',
      selectedAgent.ok &&
        selectedAgent.data.cancelled === false &&
        selectedAgent.data.status.state === 'READY' &&
        selectedAgent.data.status.source === 'USER_SELECTED' &&
        selectedAgent.data.status.version === 'codex-cli 0.146.0'
    )
    const committedAgent = await command(page, 'agent.status', {})
    step(
      'P packaged agent.status preserves the committed READY launcher',
      committedAgent.ok &&
        committedAgent.data.state === 'READY' &&
        committedAgent.data.source === 'USER_SELECTED' &&
        committedAgent.data.version === 'codex-cli 0.146.0'
    )
  } catch (error) {
    step('P packaged .app opens a temp repo via test picker', false)
    console.log('[e2e:workspace] P ERROR:', error && error.message)
  }
  await app.close()
}

async function main() {
  const repoA = tempRepo('a')
  const repoB = tempRepo('b')
  const invalidDirectory = tempNonGitDirectory()
  const fakeCodex = tempFakeCodex()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-ws-home-'))
  const invalidHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-ws-invalid-home-'))
  console.log('[e2e:workspace] home=', home)
  console.log('[e2e:workspace] repoA=', repoA)
  console.log('[e2e:workspace] repoB=', repoB)

  await cancelScenario(home)
  await invalidRepositoryScenario(invalidHome, invalidDirectory)
  await chooseScenario(home, repoA)
  await reopenScenario(home, repoA)
  await chooseAnotherScenario(home, repoA, repoB)
  await packagedOpenViaTestPicker(repoA, fakeCodex)

  console.log(
    failures === 0 ? '[e2e:workspace] ALL PASSED' : `[e2e:workspace] FAILED (${failures})`
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.log('[e2e:workspace] FATAL', error && error.stack ? error.stack : error)
  process.exit(1)
})
