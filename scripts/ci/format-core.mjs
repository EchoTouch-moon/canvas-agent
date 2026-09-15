import { spawnSync } from 'node:child_process'

const CORE_ROOTS = Object.freeze(['packages/', 'research/', 'scripts/ci/'])
const CORE_FILES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  '.prettierrc.yaml',
  '.github/workflows/ci.yml',
  '.github/workflows/electron.yml'
])
const FORMATTABLE = /\.(?:cjs|js|json|mjs|ts|tsx|yaml|yml)$/u

export function coreFormatPaths(paths) {
  return paths
    .filter((path) => CORE_FILES.has(path) || CORE_ROOTS.some((root) => path.startsWith(root)))
    .filter((path) => FORMATTABLE.test(path))
    .filter((path) => !path.startsWith('research/context-benchmarks/corpus/'))
    .sort()
}

function changedPaths() {
  const baseRef = process.env['GITHUB_BASE_REF']
  const range = baseRef ? `origin/${baseRef}...HEAD` : 'HEAD^ HEAD'
  const args = ['diff', '--name-only', '--diff-filter=ACMR', ...range.split(' ')]
  const result = spawnSync('git', args, { encoding: 'utf8' })
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? '')
    return null
  }
  const committed = result.stdout
    .split('\n')
    .map((path) => path.trim())
    .filter(Boolean)
  const workingTree = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8'
  })
  const staged = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    encoding: 'utf8'
  })
  return [
    ...committed,
    ...(workingTree.status === 0 ? workingTree.stdout.split('\n') : []),
    ...(staged.status === 0 ? staged.stdout.split('\n') : [])
  ]
    .map((path) => path.trim())
    .filter(Boolean)
}

export function runCoreFormatCheck() {
  const paths = changedPaths()
  if (paths === null) return 1
  const files = coreFormatPaths(paths)
  if (files.length === 0) {
    process.stdout.write('No changed headless source/config files require formatting.\n')
    return 0
  }
  process.stdout.write(`Checking ${String(files.length)} changed headless source/config files.\n`)
  const result = spawnSync('prettier', ['--check', ...files], {
    encoding: 'utf8',
    stdio: 'inherit'
  })
  return result.status ?? 1
}

if (process.argv[1] === new URL(import.meta.url).pathname) process.exitCode = runCoreFormatCheck()
