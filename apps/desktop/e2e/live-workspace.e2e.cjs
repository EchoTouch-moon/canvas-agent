const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { createHash } = require('node:crypto')
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
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs', 'context file.md'), '# context file\n')
  execSync('git add -A && git commit -m init', { cwd: dir })
  return dir
}

let failures = 0
function step(name, ok) {
  console.log(`[e2e] ${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures += 1
}

async function launch(repo, home, label) {
  const electronPath = require(path.join(DESKTOP, 'node_modules', 'electron'))
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--disable-gpu'],
    cwd: DESKTOP,
    env: {
      ...process.env,
      CANVAS_AGENT_REPO: repo,
      CANVAS_AGENT_DEMO_SEED: '1',
      CANVAS_AGENT_USER_DATA: home,
      HOME: home
    }
  })
  console.log(`[e2e] ${label} launched pid=`, app.process().pid)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (error) => console.log(`[e2e] ${label} pageerror:`, error && error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[e2e] ${label} console.error:`, message.text())
  })
  return { app, page }
}

async function firstLaunch(repo, home) {
  const { app, page } = await launch(repo, home, 'A')
  try {
    // Dismiss the CoreFlow welcome modal if present (it overlays the toggle).
    const getStarted = page.getByRole('button', { name: 'Get started' })
    if ((await getStarted.count()) > 0) {
      await getStarted.first().click()
      await page.waitForTimeout(500)
    }
    await page.getByRole('button', { name: 'Live workspace' }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Live workspace' }).click()
    await page.getByText('MUSICDB Demo').waitFor({ timeout: 15000 })
    step('A project hydration', true)

    await page.getByText('Task instruction · spec_demo_1').waitFor({ timeout: 5000 })
    await page.getByText('Node version · Prove the loop').waitFor({ timeout: 5000 })
    step('A composer real candidates', true)

    await page.locator('input[type="checkbox"]:enabled').first().check()

    // RepositoryContent: resolve a pinned file containing a space (exercises the
    // segment-wise repo:// codec end to end) and add it to the context.
    await page.getByLabel('Repository file path').fill('docs/context file.md')
    await page.getByRole('button', { name: 'Resolve' }).click()
    await page.getByText('repo://docs/context%20file.md').waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Add to context' }).click()
    step('A repository content resolve (encoded path) -> add selection', true)

    await page.getByRole('button', { name: 'Freeze snapshot' }).click()
    await page.getByText('FROZEN', { exact: true }).waitFor({ timeout: 10000 })
    step('A real snapshot freeze (node version + repo content)', true)

    await page.getByRole('button', { name: 'Dispatch execution' }).click()
    await page.getByText('docs/phase2.md').first().waitFor({ timeout: 60000 })
    step('A execution dispatch -> SUCCEEDED evidence', true)

    const claim = await page.getByText('Claim granted').count()
    step('A claim granted evidence', claim > 0)

    // Acceptance: verdict the demo task's single criterion, submit the
    // evaluation (Task -> WAITING_REVIEW), then complete the task.
    await page.getByRole('button', { name: 'PASSED' }).first().click()
    await page.getByRole('button', { name: 'Submit evaluation' }).click()
    await page.getByText(/evaluation #0 · PASSED/).waitFor({ timeout: 10000 })
    step('A acceptance.evaluate -> WAITING_REVIEW', true)
    await page.getByRole('button', { name: 'Complete task' }).click()
    await page.waitForTimeout(1500)
    step('A task.complete submitted', true)
  } catch (error) {
    step('A e2e flow', false)
    console.log('[e2e] A FLOW ERROR:', error && error.message)
    console.log('=== A BODY ===')
    console.log((await page.evaluate(() => document.body.innerText)).slice(0, 800))
  }
  await app.close()
}

async function secondLaunch(repo, home) {
  const { app, page } = await launch(repo, home, 'B')
  try {
    const getStarted = page.getByRole('button', { name: 'Get started' })
    if ((await getStarted.count()) > 0) {
      await getStarted.first().click()
      await page.waitForTimeout(500)
    }
    await page.getByRole('button', { name: 'Live workspace' }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Live workspace' }).click()
    await page.getByText('MUSICDB Demo').waitFor({ timeout: 15000 })

    // Persisted run history must survive the restart: run.list shows the run
    // created by launch A, and run.get returns its events + patch artifact.
    await page.getByText('FINISHED', { exact: true }).first().waitFor({ timeout: 15000 })
    step('B run.list shows the persisted run after restart', true)

    await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')].find((candidate) =>
        candidate.textContent ? /^run__/.test(candidate.textContent) : false
      )
      if (!button) throw new Error('run row button not found')
      button.click()
    })
    await page.waitForTimeout(1500)
    const expanded = await page.evaluate(() =>
      document.body.textContent.includes('Execution requests')
    )
    console.log('[e2e] B run detail expanded?', expanded)
    if (!expanded) {
      throw new Error('run detail did not expand')
    }
    await page.getByText('Execution requests').first().waitFor({ timeout: 5000 })
    const requestText = await page.evaluate(() => document.body.innerText.includes('DISPATCHED'))
    const finishText = await page.evaluate(() => document.body.innerText.includes('FINISHED'))
    step('B run.get events (DISPATCHED + FINISHED) intact', requestText && finishText)

    // Byte-level durable evidence: call the real bridge run.get and verify the
    // PATCH artifact's content, sha256 and size all survived the restart.
    const runId = await page.evaluate(() => {
      const match = document.body.textContent.match(/run__[0-9a-f-]+/)
      return match ? match[0] : null
    })
    if (!runId) throw new Error('could not extract run id')
    const aggregate = await page.evaluate(async (id) => {
      const response = await window.canvasAgent.command({
        requestId: 'e2e-restart',
        schemaVersion: 1,
        command: 'run.get',
        payload: { runId: id }
      })
      return response.ok ? response.data : null
    }, runId)
    const patchArtifact = ((aggregate && aggregate.artifacts) || []).find(
      (artifact) => artifact.kind === 'PATCH'
    )
    step('B run.get patch artifact present', Boolean(patchArtifact))
    if (patchArtifact) {
      const contentOk = String(patchArtifact.content).includes('docs/phase2.md')
      const hashOk =
        createHash('sha256').update(patchArtifact.content, 'utf8').digest('hex') ===
        patchArtifact.contentHash
      const sizeOk = patchArtifact.sizeBytes === Buffer.byteLength(patchArtifact.content, 'utf8')
      step('B PATCH content intact', contentOk)
      step('B PATCH sha256(content) === contentHash', hashOk)
      step('B PATCH sizeBytes === byteLength', sizeOk)
    }

    const evidence = await page.evaluate(() => document.body.innerText.includes('Snapshot'))
    step('B run.get snapshot binding present', evidence)

    // The acceptance history and the completed Task must survive the restart.
    const bridgeState = await page.evaluate(async () => {
      const command = async (payload) => {
        const response = await window.canvasAgent.command({
          requestId: 'e2e-restart-b',
          schemaVersion: 1,
          command: payload.command,
          payload: payload.body
        })
        return response.ok ? response.data : null
      }
      const evaluations = await command({
        command: 'acceptance.list',
        body: { taskId: 'task_demo_1' }
      })
      const state = await command({ command: 'project.state', body: { projectId: 'proj_demo' } })
      const task = state && state.tasks.find((candidate) => candidate.id === 'task_demo_1')
      return { evaluations, taskStatus: task ? task.status : null }
    })
    const evalCount = Array.isArray(bridgeState.evaluations) ? bridgeState.evaluations.length : 0
    const evalPassed =
      evalCount > 0 &&
      bridgeState.evaluations[bridgeState.evaluations.length - 1].evaluation.status === 'PASSED'
    step('B acceptance history survived restart (PASSED evaluation)', evalPassed)
    step('B task is durably COMPLETED after restart', bridgeState.taskStatus === 'COMPLETED')

    fs.mkdirSync(SHOT_DIR, { recursive: true })
    await page.screenshot({ path: path.join(SHOT_DIR, 'restart-persistence.png'), fullPage: true })
  } catch (error) {
    step('B e2e flow', false)
    console.log('[e2e] B FLOW ERROR:', error && error.message)
    console.log('=== B BODY ===')
    console.log((await page.evaluate(() => document.body.innerText)).slice(0, 6000))
    fs.mkdirSync(SHOT_DIR, { recursive: true })
    await page
      .screenshot({ path: path.join(SHOT_DIR, 'restart-persistence-failure.png'), fullPage: true })
      .catch(() => {})
  }
  await app.close()
}

async function main() {
  const repo = tempRepo()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-e2e-home-'))
  console.log('[e2e] repo=', repo)

  await firstLaunch(repo, home)
  console.log('[e2e] first launch closed; relaunching with the SAME HOME/DB')
  await secondLaunch(repo, home)

  console.log(failures === 0 ? '[e2e] ALL PASSED' : `[e2e] FAILED (${failures})`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.log('[e2e] FATAL', error && error.stack ? error.stack : error)
  process.exit(1)
})
