const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execSync } = require('node:child_process')
const { _electron: electron } = require('playwright-core')

const DESKTOP = path.resolve(__dirname, '..')
const SHOT_DIR = path.join(os.tmpdir(), 'canvas-agent-e2e')

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-e2e-repo-'))
  execSync('git init -b main', { cwd: dir })
  execSync('git config user.name e2e', { cwd: dir })
  execSync('git config user.email e2e@local', { cwd: dir })
  fs.writeFileSync(path.join(dir, 'README.md'), '# e2e\n')
  execSync('git add -A && git commit -m init', { cwd: dir })
  return dir
}

let failures = 0
function step(name, ok) {
  console.log(`[e2e] ${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures += 1
}

async function main() {
  const repo = tempRepo()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-e2e-home-'))
  console.log('[e2e] repo=', repo)

  const electronPath = require(path.join(DESKTOP, 'node_modules', 'electron'))
  let app
  try {
    app = await electron.launch({
      executablePath: electronPath,
      args: ['.', '--disable-gpu'],
      cwd: DESKTOP,
      env: {
        ...process.env,
        CANVAS_AGENT_REPO: repo,
        CANVAS_AGENT_DEMO_SEED: '1',
        HOME: home
      }
    })
    console.log('[e2e] launched pid=', app.process().pid)
  } catch (error) {
    step('electron launch', false)
    console.log('[e2e] FATAL', error && error.message)
    process.exit(1)
  }

  const mainLog = []
  app.process().stderr?.on('data', (d) => {
    const line = String(d).trim()
    if (line) mainLog.push(line)
  })

  let page
  try {
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
  } catch (error) {
    step('renderer window', false)
    console.log('[e2e] FATAL', error && error.message)
    await app.close().catch(() => {})
    process.exit(1)
  }

  try {
    await page.getByText('Live workspace').click()
    await page.getByText('MUSICDB Demo').waitFor({ timeout: 15000 })
    step('project hydration', true)

    await page.getByText('Task instruction · spec_demo_1').waitFor({ timeout: 5000 })
    await page.getByText('Node version · Prove the loop').waitFor({ timeout: 5000 })
    step('composer real candidates', true)

    await page.locator('input[type="checkbox"]:enabled').first().check()

    // RepositoryContent: resolve a pinned file and add it to the context.
    await page.getByLabel('Repository file path').fill('README.md')
    await page.getByRole('button', { name: 'Resolve' }).click()
    await page.getByText('repo://README.md').waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Add to context' }).click()
    step('repository content resolve -> add selection', true)

    await page.getByRole('button', { name: 'Freeze snapshot' }).click()
    await page.getByText('FROZEN', { exact: true }).waitFor({ timeout: 10000 })
    step('real snapshot freeze (node version + repo content)', true)

    await page.getByRole('button', { name: 'Dispatch execution' }).click()

    await page.getByText('docs/phase2.md').first().waitFor({ timeout: 60000 })
    step('execution dispatch -> SUCCEEDED evidence', true)

    const claim = await page.getByText('Claim granted').count()
    step('claim granted evidence', claim > 0)

    const verification = await page.getByText('exit 0', { exact: false }).count()
    step('verification exit 0 evidence', verification > 0)

    const outcomeText = await page.evaluate(() => document.body.innerText.includes('成功'))
    step('outcome badge (SUCCEEDED)', outcomeText)

    fs.mkdirSync(SHOT_DIR, { recursive: true })
    await page.screenshot({ path: path.join(SHOT_DIR, 'live-workspace.png'), fullPage: true })
    console.log('[e2e] screenshot saved to', SHOT_DIR)
  } catch (error) {
    step('e2e flow', false)
    console.log('[e2e] FLOW ERROR:', error && error.message)
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    await page
      .screenshot({ path: path.join(SHOT_DIR, 'live-workspace-failure.png'), fullPage: true })
      .catch(() => {})
  }

  mainLog
    .filter((l) => /workspace|error|Error|worker/.test(l))
    .slice(-20)
    .forEach((l) => console.log('[main]', l))
  await app.close().catch(() => {})

  console.log(failures === 0 ? '[e2e] ALL PASSED' : `[e2e] FAILED (${failures})`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.log('[e2e] FATAL', error && error.stack ? error.stack : error)
  process.exit(1)
})
