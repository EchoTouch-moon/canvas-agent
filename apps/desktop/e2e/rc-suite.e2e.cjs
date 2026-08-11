const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const DESKTOP = path.resolve(__dirname, '..')
const REPORT_DIR = process.env.CANVAS_AGENT_RC_REPORT_DIR
  ? path.resolve(process.env.CANVAS_AGENT_RC_REPORT_DIR)
  : path.join(DESKTOP, 'dist', 'reports')
const LOG_DIR = process.env.CANVAS_AGENT_RC_LOG_DIR
  ? path.resolve(process.env.CANVAS_AGENT_RC_LOG_DIR)
  : path.join(DESKTOP, 'dist', 'logs')
const SCREENSHOT_DIR = process.env.CANVAS_AGENT_E2E_SCREENSHOT_DIR
  ? path.resolve(process.env.CANVAS_AGENT_E2E_SCREENSHOT_DIR)
  : path.join(DESKTOP, 'dist', 'screenshots', 'live')
const REPORT_PATH = path.join(REPORT_DIR, 'product-mvp-v0.2-rc.json')

const scenarios = [
  {
    id: 'unsigned-package',
    command: 'pnpm',
    args: ['build:unpack:unsigned']
  },
  {
    id: 'workspace-lifecycle',
    command: process.execPath,
    args: [path.join('e2e', 'workspace.e2e.cjs')]
  },
  {
    id: 'full-loop-restart-adoption',
    command: process.execPath,
    args: [path.join('e2e', 'live-workspace.e2e.cjs')]
  },
  {
    id: 'packaged-cold-start',
    command: process.execPath,
    args: [path.join('e2e', 'packaged-smoke.e2e.cjs')]
  }
]

function runScenario(scenario) {
  const startedAt = new Date().toISOString()
  const result = spawnSync(scenario.command, scenario.args, {
    cwd: DESKTOP,
    env: {
      ...process.env,
      CANVAS_AGENT_E2E_SCREENSHOT_DIR: SCREENSHOT_DIR
    },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  const logPath = path.join(LOG_DIR, `${scenario.id}.log`)
  fs.mkdirSync(LOG_DIR, { recursive: true })
  fs.writeFileSync(logPath, output, 'utf8')
  process.stdout.write(output)
  const exitCode = result.status ?? 1
  return {
    id: scenario.id,
    command: [scenario.command, ...scenario.args].join(' '),
    startedAt,
    finishedAt: new Date().toISOString(),
    status: exitCode === 0 ? 'passed' : 'failed',
    exitCode,
    logPath: path.relative(DESKTOP, logPath)
  }
}

function main() {
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.mkdirSync(LOG_DIR, { recursive: true })
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

  const results = []
  for (const scenario of scenarios) {
    console.log(`[e2e:rc] START ${scenario.id}`)
    const result = runScenario(scenario)
    results.push(result)
    console.log(`[e2e:rc] ${result.status.toUpperCase()} ${scenario.id}`)
    if (result.status === 'failed') break
  }

  const passed =
    results.length === scenarios.length && results.every((item) => item.status === 'passed')
  const report = {
    schemaVersion: 1,
    suite: 'product-mvp-v0.2-credential-free-rc',
    credentialFree: true,
    status: passed ? 'passed' : 'failed',
    scenarios: results,
    screenshotDirectory: path.relative(DESKTOP, SCREENSHOT_DIR)
  }
  fs.mkdirSync(REPORT_DIR, { recursive: true })
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log('[e2e:rc] REPORT', REPORT_PATH)
  process.exit(passed ? 0 : 1)
}

main()
