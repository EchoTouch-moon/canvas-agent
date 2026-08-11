const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execFileSync, execSync } = require('node:child_process')
const { _electron: electron } = require('playwright-core')

const DESKTOP = path.resolve(__dirname, '..')
const REPORT_PATH = process.env.CANVAS_AGENT_AGENT_REPORT
  ? path.resolve(process.env.CANVAS_AGENT_AGENT_REPORT)
  : path.join(DESKTOP, 'dist', 'reports', 'agent-smoke.json')

function probeVersion() {
  try {
    return execFileSync('codex', ['--version'], {
      encoding: 'utf8',
      timeout: 5_000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

function emptyChecks() {
  return {
    agentReady: null,
    dispatchSucceeded: null,
    patchProduced: null,
    structuredSummary: null,
    workerDiffCheckPassed: null,
    sourceRepositoryUnchanged: null
  }
}

function writeReport(outcome, executableVersion, redactedReason, checks) {
  const counts = {
    executed: outcome === 'executed' ? 1 : 0,
    skipped: outcome === 'skipped' ? 1 : 0,
    failed: outcome === 'failed' ? 1 : 0
  }
  const report = {
    schemaVersion: 1,
    smoke: 'authenticated-codex',
    outcome,
    counts,
    executableVersion,
    redactedReason,
    checks
  }
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('[e2e:agent] REPORT', JSON.stringify(report))
  console.log('[e2e:agent] report path=', REPORT_PATH)
}

let failures = 0
function step(name, ok) {
  console.log(`[e2e:agent] ${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) failures += 1
}

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-agent-repo-'))
  execSync('git init -b main', { cwd: dir })
  execSync('git config user.name e2e-agent', { cwd: dir })
  execSync('git config user.email agent@local', { cwd: dir })
  fs.writeFileSync(path.join(dir, 'README.md'), '# agent smoke\n')
  execSync('git add -A && git commit -m init', { cwd: dir })
  return dir
}

async function command(page, cmd, payload) {
  return page.evaluate(
    async ({ cmd, payload }) => {
      const response = await window.canvasAgent.command({
        requestId: 'e2e-agent',
        schemaVersion: 1,
        command: cmd,
        payload
      })
      return response
    },
    { cmd, payload }
  )
}

async function main() {
  if (process.env.CANVAS_AGENT_REAL_AGENT_SMOKE !== '1') {
    writeReport('skipped', probeVersion(), 'OPT_IN_DISABLED', emptyChecks())
    console.log(
      '[e2e:agent] SKIPPED: set CANVAS_AGENT_REAL_AGENT_SMOKE=1 to run the opt-in authenticated Codex smoke'
    )
    process.exit(0)
  }
  const repo = tempRepo()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-agent-home-'))
  const electronPath = require(path.join(DESKTOP, 'node_modules', 'electron'))
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--disable-gpu'],
    cwd: DESKTOP,
    env: {
      ...process.env,
      CANVAS_AGENT_REPO: repo,
      CANVAS_AGENT_E2E: '1',
      CANVAS_AGENT_USER_DATA: home,
      HOME: home
    }
  })
  console.log('[e2e:agent] launched pid=', app.process().pid)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (error) => console.log('[e2e:agent] pageerror:', error && error.message))

  let executableVersion = probeVersion()
  let redactedReason = null
  const checks = emptyChecks()
  try {
    const agent = await command(page, 'agent.status', {})
    executableVersion = agent.ok ? agent.data.version : executableVersion
    checks.agentReady = agent.ok && agent.data.state === 'READY'
    step('agent.status reaches READY with the installed Codex', checks.agentReady)
    if (!agent.ok || agent.data.state !== 'READY') {
      console.log('[e2e:agent] agent.status =', JSON.stringify(agent.data))
    }

    const project = await command(page, 'project.create', {
      name: 'Agent Smoke',
      description: 'authenticated Codex smoke'
    })
    if (!project.ok) throw new Error(`project.create failed: ${project.error.message}`)
    const projectId = project.data.id

    const node = await command(page, 'node.create', { projectId, type: 'GOAL' })
    if (!node.ok) throw new Error(`node.create failed: ${node.error.message}`)
    const version = await command(page, 'nodeVersion.publish', {
      nodeId: node.data.id,
      title: 'Goal',
      body: 'Add a small file to the repository.'
    })
    if (!version.ok) throw new Error(`nodeVersion.publish failed: ${version.error.message}`)

    const task = await command(page, 'task.create', {
      projectId,
      type: 'IMPLEMENT_CHANGE',
      title: 'Add hello file'
    })
    if (!task.ok) throw new Error(`task.create failed: ${task.error.message}`)
    const spec = await command(page, 'taskSpec.publish', {
      taskId: task.data.id,
      description:
        'Create a file docs/hello.md in the current repository containing exactly the text hello-world on one line. Do not modify any other file.',
      scope: 'Add docs/hello.md',
      criteria: [{ description: 'docs/hello.md contains hello-world', position: 0 }]
    })
    if (!spec.ok) throw new Error(`taskSpec.publish failed: ${spec.error.message}`)

    const baseline = await command(page, 'baseline.createDraft', {
      projectId,
      name: '0.1',
      nodeVersionIds: [version.data.id]
    })
    if (!baseline.ok) throw new Error(`baseline.createDraft failed: ${baseline.error.message}`)
    const activated = await command(page, 'baseline.activate', { baselineId: baseline.data.id })
    if (!activated.ok) throw new Error(`baseline.activate failed: ${activated.error.message}`)

    const revision = await command(page, 'revision.current', {})
    if (!revision.ok) throw new Error(`revision.current failed: ${revision.error.message}`)

    const frozen = await command(page, 'snapshot.freeze', {
      projectId,
      taskId: task.data.id,
      taskSpecVersionId: spec.data.spec.id,
      baseBaselineId: baseline.data.id,
      expectedRepositoryRevisionId: revision.data.id,
      selections: [
        {
          source: { kind: 'NODE_VERSION', nodeVersionId: version.data.id },
          selectionReason: 'agent smoke'
        }
      ]
    })
    if (!frozen.ok) throw new Error(`snapshot.freeze failed: ${frozen.error.message}`)
    const snapshotId = frozen.data.snapshot.id

    const dispatch = await command(page, 'execution.dispatch', {
      executionRequestId: `agent-smoke-${Date.now()}`,
      contextSnapshotId: snapshotId
    })
    if (!dispatch.ok)
      throw new Error(
        `execution.dispatch failed: ${dispatch.error.name}: ${dispatch.error.message}`
      )
    const result = dispatch.data.result
    console.log(
      '[e2e:agent] run=',
      dispatch.data.runId,
      'outcome=',
      result.outcome,
      'reason=',
      result.rejectionReason
    )
    checks.dispatchSucceeded = result.outcome === 'SUCCEEDED'
    step('real Codex dispatch succeeds', checks.dispatchSucceeded)
    checks.patchProduced = Boolean(result.patch && result.patch.includes('docs/hello.md'))
    step(
      'real Codex produced the requested Git patch in the isolated worktree',
      checks.patchProduced
    )
    const summaryOk =
      result.agentSummary !== undefined &&
      (() => {
        try {
          const parsed = JSON.parse(result.agentSummary)
          return typeof parsed.summary === 'string' && typeof parsed.success === 'boolean'
        } catch {
          return false
        }
      })()
    checks.structuredSummary = summaryOk
    step('real Codex returned a structured summary', checks.structuredSummary)
    const checkOk = (result.verificationResults || []).some(
      (v) =>
        JSON.stringify(v.argv) === JSON.stringify(['git', 'diff', '--cached', '--check']) &&
        v.exitCode === 0
    )
    checks.workerDiffCheckPassed = checkOk
    step('Worker-owned git diff --cached --check recorded', checks.workerDiffCheckPassed)
    // The original repository must remain untouched until an explicit apply.
    checks.sourceRepositoryUnchanged = !fs.existsSync(path.join(repo, 'docs', 'hello.md'))
    step('original repository unchanged after the run', checks.sourceRepositoryUnchanged)
  } catch (error) {
    step('authenticated smoke flow', false)
    redactedReason = 'SMOKE_FLOW_FAILED'
    console.log('[e2e:agent] ERROR:', error && error.message)
  }
  await app.close()
  const checksPassed = Object.values(checks).every((value) => value === true)
  const outcome = failures === 0 && checksPassed ? 'executed' : 'failed'
  writeReport(
    outcome,
    executableVersion,
    outcome === 'executed' ? redactedReason : (redactedReason ?? 'ASSERTION_FAILED'),
    checks
  )
  console.log(failures === 0 ? '[e2e:agent] ALL PASSED' : `[e2e:agent] FAILED (${failures})`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  writeReport('failed', probeVersion(), 'SMOKE_FATAL', emptyChecks())
  console.log('[e2e:agent] FATAL', error && error.stack ? error.stack : error)
  process.exit(1)
})
