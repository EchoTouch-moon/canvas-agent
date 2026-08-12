import { readdir, readFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { z } from 'zod'
import { BENCHMARK_CATEGORIES, CONTEXT_STRATEGIES, type BenchmarkManifest } from './types'

const gitHashSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i, 'expected a Git object hash')
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/i, 'expected a SHA-256 content hash')

export const benchmarkManifestSchema = z
  .object({
    taskId: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/),
    category: z.enum(BENCHMARK_CATEGORIES),
    title: z.string().min(1),
    fixtureVersion: z.string().min(1),
    fixturePath: z.string().min(1),
    referencePath: z.string().min(1),
    repositoryRevision: z
      .object({
        baseCommit: gitHashSchema,
        treeHash: gitHashSchema,
        workingTreePatchHash: contentHashSchema.nullable()
      })
      .strict(),
    initialStateHash: contentHashSchema,
    prompt: z.string().min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    oracle: z
      .object({
        command: z.literal('node'),
        args: z.array(z.string().min(1)).min(1),
        expectedExitCode: z.number().int(),
        timeoutMs: z.number().int().positive()
      })
      .strict(),
    regressionOracle: z
      .object({
        command: z.literal('node'),
        args: z.array(z.string().min(1)).min(1),
        expectedExitCode: z.number().int(),
        timeoutMs: z.number().int().positive()
      })
      .strict(),
    allowedTools: z.array(z.string().min(1)).min(1),
    expectedTools: z.array(z.string().min(1)).min(1),
    modelProfile: z
      .object({
        provider: z.string().min(1),
        model: z.string().min(1),
        thinkingLevel: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh'])
      })
      .strict(),
    contextStrategies: z
      .array(z.enum(CONTEXT_STRATEGIES))
      .length(2)
      .refine((values) => values.includes('NATIVE') && values.includes('SHADOW'), {
        message: 'contextStrategies must contain exactly NATIVE and SHADOW'
      }),
    budget: z
      .object({
        maxSemanticCalls: z.number().int().positive(),
        maxToolCalls: z.number().int().positive(),
        wallClockMs: z.number().int().positive()
      })
      .strict(),
    expectedWritablePaths: z.array(z.string().min(1)).min(1),
    retentionPolicy: z.string().min(1),
    knownCandidatePaths: z.array(z.string().min(1)).min(1),
    knownRelevantPaths: z.array(z.string().min(1)).min(1),
    knownIrrelevantPaths: z.array(z.string().min(1)),
    expectedArchitecturalRules: z.array(z.string().min(1))
  })
  .strict()

function assertSafeRelativePath(root: string, value: string, field: string): string {
  const absoluteRoot = resolve(root)
  const absolutePath = resolve(absoluteRoot, value)
  if (absolutePath !== absoluteRoot && !absolutePath.startsWith(`${absoluteRoot}${sep}`)) {
    throw new Error(`${field} escapes manifest root: ${value}`)
  }
  return absolutePath
}

export async function parseManifestFile(path: string): Promise<BenchmarkManifest> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
  return benchmarkManifestSchema.parse(raw)
}

export function validateManifestReferences(researchRoot: string, manifest: BenchmarkManifest): void {
  const fixtureRoot = assertSafeRelativePath(researchRoot, manifest.fixturePath, 'fixturePath')
  const referenceRoot = assertSafeRelativePath(researchRoot, manifest.referencePath, 'referencePath')
  const validateOracle = (
    oracle: BenchmarkManifest['oracle'],
    label: string
  ): void => {
    if (oracle.args[0] !== '--test') {
      throw new Error(`${manifest.taskId} ${label} must use node --test`)
    }
    const oraclePath = oracle.args.at(-1)
    if (oraclePath === undefined || !oraclePath.startsWith('test/')) {
      throw new Error(`${manifest.taskId} ${label} must target a test/ path`)
    }
    assertSafeRelativePath(fixtureRoot, oraclePath, `${manifest.taskId}.${label}.args`)
    assertSafeRelativePath(referenceRoot, oraclePath, `${manifest.taskId}.reference ${label}`)
  }
  validateOracle(manifest.oracle, 'oracle')
  validateOracle(manifest.regressionOracle, 'regressionOracle')
  if (JSON.stringify(manifest.oracle) === JSON.stringify(manifest.regressionOracle)) {
    throw new Error(`${manifest.taskId} objective and regression oracles must be distinct`)
  }
}

export async function loadManifests(researchRoot: string): Promise<readonly BenchmarkManifest[]> {
  const manifestRoot = resolve(researchRoot, 'manifests')
  const names = (await readdir(manifestRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
  const manifests = await Promise.all(names.map((name) => parseManifestFile(resolve(manifestRoot, name))))
  const taskIds = new Set<string>()
  const categories = new Set<string>()
  for (const manifest of manifests) {
    if (taskIds.has(manifest.taskId)) throw new Error(`duplicate benchmark taskId: ${manifest.taskId}`)
    if (categories.has(manifest.category)) throw new Error(`duplicate benchmark category: ${manifest.category}`)
    taskIds.add(manifest.taskId)
    categories.add(manifest.category)
    validateManifestReferences(researchRoot, manifest)
  }
  const expectedCategories = new Set<string>(BENCHMARK_CATEGORIES)
  if (manifests.length !== BENCHMARK_CATEGORIES.length || categories.size !== expectedCategories.size) {
    throw new Error(`CR-005 requires exactly six category manifests; found ${manifests.length}`)
  }
  for (const category of BENCHMARK_CATEGORIES) {
    if (!categories.has(category)) throw new Error(`missing CR-005 category manifest: ${category}`)
  }
  return manifests
}

export function manifestRootFromModule(modulePath: string): string {
  return resolve(dirname(modulePath), '..')
}
