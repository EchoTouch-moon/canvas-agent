import test from 'node:test'
import assert from 'node:assert/strict'
import { coreFindings, isCoreAuditPath } from './audit-core.mjs'
import { coreFormatPaths } from './format-core.mjs'

test('classifies only headless workspace paths as core', () => {
  assert.equal(isCoreAuditPath('packages__context-runtime>zod'), true)
  assert.equal(isCoreAuditPath('research__context-benchmarks>foo>bar'), true)
  assert.equal(isCoreAuditPath('apps__desktop>shadcn>cosmiconfig>js-yaml'), false)
})

test('fails core audit when one advisory reaches a core path', () => {
  const findings = coreFindings({
    'core-advisory': {
      id: 1,
      github_advisory_id: 'GHSA-core',
      module_name: 'core-dependency',
      severity: 'high',
      title: 'core issue',
      patched_versions: '>=2.0.0',
      findings: [{ paths: ['packages__context-runtime>core-dependency'] }]
    },
    'electron-advisory': {
      id: 2,
      github_advisory_id: 'GHSA-electron',
      module_name: 'electron-dependency',
      severity: 'high',
      title: 'electron issue',
      findings: [{ paths: ['apps__desktop>electron-dependency'] }]
    }
  })
  assert.deepEqual(
    findings.map((finding) => finding.id),
    ['GHSA-core']
  )
})

test('does not treat an audit endpoint error as a clean core audit', () => {
  assert.deepEqual(coreFindings(undefined), [])
})

test('formats only changed headless source/config files', () => {
  assert.deepEqual(
    coreFormatPaths([
      'apps/desktop/src/main/index.ts',
      'packages/context-runtime/src/index.ts',
      'research/context-benchmarks/corpus/C1/index.js',
      'research/context-benchmarks/src/cli.ts',
      'README.md',
      '.github/workflows/ci.yml'
    ]),
    [
      '.github/workflows/ci.yml',
      'packages/context-runtime/src/index.ts',
      'research/context-benchmarks/src/cli.ts'
    ]
  )
})
