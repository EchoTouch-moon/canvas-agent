const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawn } = require('node:child_process')
const { _electron: electron } = require('playwright-core')

const DESKTOP = path.resolve(__dirname, '..')
const REPOSITORY = path.resolve(DESKTOP, '../..')
const SHOT_DIR = path.join(REPOSITORY, 'docs', 'verification', 'ui-003-live-first-shell')
const HARNESS_URL = 'http://127.0.0.1:4179'
const HARNESS_PAGE = `${HARNESS_URL}/e2e/ui003-harness/`

const captures = [
  ['no-workspace-light-1080x720', 'no-workspace', 'light', 1080, 720, 'Open a repository'],
  ['no-workspace-dark-1080x720', 'no-workspace', 'dark', 1080, 720, 'Open a repository'],
  ['opening-light-1080x720', 'opening', 'light', 1080, 720, 'Preparing your workspace'],
  ['opening-dark-1080x720', 'opening', 'dark', 1080, 720, 'Preparing your workspace'],
  ['error-light-1080x720', 'error', 'light', 1080, 720, 'This repository needs attention'],
  ['error-dark-1080x720', 'error', 'dark', 1080, 720, 'This repository needs attention'],
  ['ready-light-1440x960', 'ready', 'light', 1440, 960, 'Workspace overview'],
  ['ready-dark-1440x960', 'ready', 'dark', 1440, 960, 'Workspace overview'],
  ['switch-blocked-light-1440x960', 'switch-blocked', 'light', 1440, 960, 'Switch paused'],
  ['switch-blocked-dark-1440x960', 'switch-blocked', 'dark', 1440, 960, 'Switch paused'],
  ['booting-light-1080x720', 'booting', 'light', 1080, 720, 'Checking local workspace'],
  ['closing-dark-1440x960', 'closing', 'dark', 1440, 960, 'Closing repository'],
  ['agent-auth-light-1440x960', 'agent-auth', 'light', 1440, 960, 'Sign-in required'],
  ['first-task-light-1440x960', 'first-task', 'light', 1440, 960, 'Create the first task'],
  ['first-project-light-1440x960', 'first-project', 'light', 1440, 960, 'Create project'],
  ['baseline-draft-light-1440x960', 'baseline-draft', 'light', 1440, 960, 'DRAFT'],
  ['task-spec-light-1440x960', 'task-spec', 'light', 1440, 960, 'Publish task specification'],
  ['dirty-dark-1440x960', 'dirty', 'dark', 1440, 960, 'Uncommitted changes detected']
]

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForHarness(server) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`visual harness exited ${server.exitCode}`)
    try {
      const response = await fetch(HARNESS_PAGE)
      if (response.ok) return
    } catch {
      // The Vite process is still starting.
    }
    await wait(100)
  }
  throw new Error('visual harness did not become ready')
}

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  const viteBin = path.join(DESKTOP, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = spawn(
    process.execPath,
    [viteBin, '--config', path.join(__dirname, 'ui003-harness', 'vite.config.ts')],
    { cwd: DESKTOP, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  server.stdout.on('data', (chunk) => process.stdout.write(`[visual-server] ${chunk}`))
  server.stderr.on('data', (chunk) => process.stderr.write(`[visual-server] ${chunk}`))

  let app
  try {
    await waitForHarness(server)
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-ui003-'))
    const electronPath = require(path.join(DESKTOP, 'node_modules', 'electron'))
    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', '--disable-gpu'],
      cwd: DESKTOP,
      env: { ...process.env, CANVAS_AGENT_USER_DATA: userData }
    })
    const page = await app.firstWindow()
    page.on('pageerror', (error) => console.error('[visual] page error:', error.message))

    for (const [name, state, theme, width, height, expectedText] of captures) {
      await page.setViewportSize({ width, height })
      await page.goto(`${HARNESS_PAGE}?state=${state}&theme=${theme}`)
      await page.getByText(expectedText, { exact: false }).first().waitFor({ timeout: 10_000 })
      await page.waitForTimeout(250)

      const metrics = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        liveRegions: document.querySelectorAll('[aria-live], [role="status"]').length,
        clippedControls: [...document.querySelectorAll('button, input, select, textarea')]
          .filter((element) => {
            const rect = element.getBoundingClientRect()
            return rect.width > 0 && (rect.left < 0 || rect.right > window.innerWidth)
          })
          .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim())
      }))
      if (metrics.documentWidth > metrics.viewportWidth) {
        throw new Error(`${name} has horizontal overflow: ${JSON.stringify(metrics)}`)
      }
      if (metrics.liveRegions === 0) throw new Error(`${name} exposes no status announcement`)
      if (metrics.clippedControls.length > 0) {
        throw new Error(`${name} clips interactive controls: ${JSON.stringify(metrics)}`)
      }

      const output = path.join(SHOT_DIR, `${name}.png`)
      await page.screenshot({ path: output, fullPage: false })
      console.log(`[visual] PASS ${name} -> ${output}`)
    }

    await page.setViewportSize({ width: 1080, height: 720 })
    await page.goto(`${HARNESS_PAGE}?state=keyboard-path&theme=light`)
    await page.getByText('Open a repository to begin').waitFor()
    let chooseReached = false
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Tab')
      chooseReached = await page.evaluate(
        () => document.activeElement?.textContent?.trim() === 'Choose repository'
      )
      if (chooseReached) break
    }
    if (!chooseReached) throw new Error('keyboard focus did not reach Choose repository')
    await page.keyboard.press('Enter')
    await page.getByText('Create the first task').waitFor()

    let titleReached = false
    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press('Tab')
      titleReached = await page.evaluate(
        () =>
          document.activeElement?.getAttribute('value') === '' &&
          document.activeElement?.tagName === 'INPUT'
      )
      if (titleReached) break
    }
    if (!titleReached) throw new Error('keyboard focus did not reach the first Task title')
    await page.keyboard.type('Keyboard path task')

    let taskActionReached = false
    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press('Tab')
      taskActionReached = await page.evaluate(
        () => document.activeElement?.textContent?.trim() === 'Create task'
      )
      if (taskActionReached) break
    }
    if (!taskActionReached) throw new Error('keyboard focus did not reach Create task')
    console.log(
      '[visual] PASS keyboard path Choose repository -> READY -> Task title -> Create task'
    )
  } finally {
    if (app) await app.close()
    server.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error('[visual] FAIL', error)
  process.exitCode = 1
})
