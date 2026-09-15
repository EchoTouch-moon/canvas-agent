import { z } from 'zod'
import { C1_E0_DOSE_SCHEMA_ID, canonicalC1E0Json, hashCanonicalC1E0 } from './c1-e0-binding'

export const C1_E0_DOSE_SCHEMA_VERSION = 1 as const

const hash64Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'expected a SHA-256 hash')
const pairIdSchema = z.string().min(1)
const sourceKeySchema = z.string().min(1)
const countSchema = z.number().int().nonnegative()
const measurableCountSchema = z.union([countSchema, z.literal('UNAVAILABLE')])

const uniqueArray = <T extends z.ZodType>(schema: T) =>
  z.array(schema).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'values must be unique' })
    }
  })

export const c1E0DoseObservationSchema = z
  .object({
    schemaId: z.literal(C1_E0_DOSE_SCHEMA_ID),
    schemaVersion: z.literal(C1_E0_DOSE_SCHEMA_VERSION),
    /** Matched experimental pair that owns this composition. */
    experimentPairId: pairIdSchema,
    callOrdinal: z.number().int().positive(),
    prePolicyProviderBoundMessagesHash: hash64Schema,
    postPolicyProviderBoundMessagesHash: hash64Schema,
    uniqueEligiblePairIds: uniqueArray(pairIdSchema),
    uniqueSelectedPairIds: uniqueArray(pairIdSchema),
    uniqueRemovedPairIds: uniqueArray(pairIdSchema),
    uniqueRemovedSourceElementKeys: uniqueArray(sourceKeySchema),
    newRemovalPairIds: uniqueArray(pairIdSchema),
    carriedRemovalPairIds: uniqueArray(pairIdSchema),
    suppressedStalePairIds: uniqueArray(pairIdSchema),
    suppressedStalePairCallExposures: countSchema,
    suppressedSourceElementCallExposures: countSchema,
    tokensBeforeComposition: measurableCountSchema,
    tokensAfterComposition: measurableCountSchema,
    removedBytes: measurableCountSchema,
    removedTokens: measurableCountSchema,
    activeStaleElements: measurableCountSchema,
    rehydrateCount: countSchema,
    lifecycleUnknownCountByReason: z.record(z.string().min(1), countSchema),
    protectedRemovalCount: countSchema,
    contractConflictCount: countSchema,
    runtimeContextChanged: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    const eligible = new Set(value.uniqueEligiblePairIds)
    const selected = new Set(value.uniqueSelectedPairIds)
    const removed = new Set(value.uniqueRemovedPairIds)
    const newRemovals = new Set(value.newRemovalPairIds)
    const carried = new Set(value.carriedRemovalPairIds)
    const suppressed = new Set(value.suppressedStalePairIds)
    for (const [label, values, parent] of [
      ['selected', selected, eligible],
      ['removed', removed, selected],
      ['new removal', newRemovals, removed],
      ['carried removal', carried, removed],
      ['suppressed stale', suppressed, removed]
    ] as const) {
      for (const item of values) {
        if (!parent.has(item)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [label.replaceAll(' ', '')],
            message: `${label} pair ${item} is not contained by its parent set`
          })
        }
      }
    }
    for (const item of newRemovals) {
      if (carried.has(item)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['carriedRemovalPairIds'],
          message: `pair ${item} cannot be both new and carried in one composition`
        })
      }
    }
    if (value.uniqueRemovedSourceElementKeys.length !== value.uniqueRemovedPairIds.length * 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['uniqueRemovedSourceElementKeys'],
        message: 'pure-evict removal must contain exactly two source keys per removed pair'
      })
    }
    if (value.suppressedSourceElementCallExposures !== value.suppressedStalePairCallExposures * 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['suppressedSourceElementCallExposures'],
        message: 'source-element exposure count must be two per suppressed pair exposure'
      })
    }
    if (value.suppressedStalePairIds.length !== value.suppressedStalePairCallExposures) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['suppressedStalePairIds'],
        message: 'each outbound can suppress each stale pair at most once'
      })
    }
    if (
      value.runtimeContextChanged !==
      (value.prePolicyProviderBoundMessagesHash !== value.postPolicyProviderBoundMessagesHash)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['runtimeContextChanged'],
        message: 'runtimeContextChanged must equal the same-composition pre/post hash comparison'
      })
    }
  })

export type C1E0DoseObservation = z.infer<typeof c1E0DoseObservationSchema>
export type C1E0MeasurableCount = z.infer<typeof measurableCountSchema>

export function validateC1E0DoseObservation(value: unknown): C1E0DoseObservation {
  return c1E0DoseObservationSchema.parse(value)
}

function union(values: readonly (readonly string[])[]): string[] {
  return [...new Set(values.flat())].sort()
}

function sumMeasurable(values: readonly C1E0MeasurableCount[]): C1E0MeasurableCount {
  if (values.some((value) => value === 'UNAVAILABLE')) return 'UNAVAILABLE'
  return (values as number[]).reduce((total, value) => total + value, 0)
}

function maxMeasurable(values: readonly C1E0MeasurableCount[]): C1E0MeasurableCount {
  if (values.length === 0 || values.some((value) => value === 'UNAVAILABLE')) return 'UNAVAILABLE'
  return Math.max(...(values as number[]))
}

export const c1E0DoseSummarySchema = z
  .object({
    schemaId: z.literal(C1_E0_DOSE_SCHEMA_ID),
    schemaVersion: z.literal(C1_E0_DOSE_SCHEMA_VERSION),
    /** Matched experimental pair that owns this aggregated leg dose. */
    experimentPairId: pairIdSchema,
    runtimeOutboundCalls: countSchema,
    runtimeContextChangedCalls: countSchema,
    uniqueEligiblePairs: uniqueArray(pairIdSchema),
    uniqueSelectedPairs: uniqueArray(pairIdSchema),
    uniqueRemovedPairs: uniqueArray(pairIdSchema),
    uniqueRemovedSourceElements: uniqueArray(sourceKeySchema),
    newRemovalPairCalls: countSchema,
    carriedRemovalPairCalls: countSchema,
    suppressedStalePairCallExposures: countSchema,
    suppressedSourceElementCallExposures: countSchema,
    treatmentExposureRatio: z.union([z.number().min(0).max(1), z.literal('NOT_ESTIMABLE')]),
    tokensBeforeComposition: measurableCountSchema,
    tokensAfterComposition: measurableCountSchema,
    removedBytes: measurableCountSchema,
    removedTokens: measurableCountSchema,
    removedTokenRatio: z.union([z.number().nonnegative(), z.literal('NOT_ESTIMABLE')]),
    activeStaleElementsPeak: measurableCountSchema,
    rehydrateCount: countSchema,
    lifecycleUnknownCountByReason: z.record(z.string().min(1), countSchema),
    protectedRemovalCount: countSchema,
    contractConflictCount: countSchema
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.uniqueRemovedPairs.length > value.uniqueSelectedPairs.length ||
      value.uniqueSelectedPairs.length > value.uniqueEligiblePairs.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['uniqueRemovedPairs'],
        message: 'uniqueRemovedPairs <= uniqueSelectedPairs <= uniqueEligiblePairs is required'
      })
    }
    if (value.uniqueRemovedSourceElements.length !== value.uniqueRemovedPairs.length * 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['uniqueRemovedSourceElements'],
        message: 'pure-evict summary must contain two source elements per removed pair'
      })
    }
    if (value.suppressedSourceElementCallExposures !== value.suppressedStalePairCallExposures * 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['suppressedSourceElementCallExposures'],
        message: 'source-element exposures must be two per suppressed pair exposure'
      })
    }
  })

export type C1E0DoseSummary = z.infer<typeof c1E0DoseSummarySchema>

export function aggregateC1E0Dose(observations: readonly C1E0DoseObservation[]): C1E0DoseSummary {
  if (observations.length === 0) {
    throw new Error('E0 dose aggregation requires at least one observation')
  }
  const rows = observations
    .map(validateC1E0DoseObservation)
    .sort((left, right) => left.callOrdinal - right.callOrdinal)
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index]!.callOrdinal === rows[index - 1]!.callOrdinal) {
      throw new Error('E0 dose observations must have unique call ordinals')
    }
  }
  const experimentPairIds = new Set(rows.map((row) => row.experimentPairId))
  if (experimentPairIds.size !== 1) {
    throw new Error('E0 dose observations must belong to one experiment pair')
  }
  const experimentPairId = rows[0]!.experimentPairId
  const firstRemovalPairs = new Set<string>()
  for (const row of rows) {
    for (const pairId of row.newRemovalPairIds) {
      if (firstRemovalPairs.has(pairId)) {
        throw new Error(`E0 pair ${pairId} has more than one new removal call`)
      }
      firstRemovalPairs.add(pairId)
    }
    for (const pairId of row.carriedRemovalPairIds) {
      if (!firstRemovalPairs.has(pairId)) {
        throw new Error(`E0 carried removal ${pairId} has no prior new removal call`)
      }
    }
  }
  const uniqueEligiblePairs = union(rows.map((row) => row.uniqueEligiblePairIds))
  const uniqueSelectedPairs = union(rows.map((row) => row.uniqueSelectedPairIds))
  const uniqueRemovedPairs = union(rows.map((row) => row.uniqueRemovedPairIds))
  const uniqueRemovedSourceElements = union(rows.map((row) => row.uniqueRemovedSourceElementKeys))
  const newRemovalPairCalls = rows.reduce((total, row) => total + row.newRemovalPairIds.length, 0)
  const carriedRemovalPairCalls = rows.reduce(
    (total, row) => total + row.carriedRemovalPairIds.length,
    0
  )
  const suppressedStalePairCallExposures = rows.reduce(
    (total, row) => total + row.suppressedStalePairCallExposures,
    0
  )
  const suppressedSourceElementCallExposures = rows.reduce(
    (total, row) => total + row.suppressedSourceElementCallExposures,
    0
  )
  const runtimeOutboundCalls = rows.length
  const runtimeContextChangedCalls = rows.filter((row) => row.runtimeContextChanged).length
  const tokensBeforeComposition = sumMeasurable(rows.map((row) => row.tokensBeforeComposition))
  const tokensAfterComposition = sumMeasurable(rows.map((row) => row.tokensAfterComposition))
  const removedBytes = sumMeasurable(rows.map((row) => row.removedBytes))
  const removedTokens = sumMeasurable(rows.map((row) => row.removedTokens))
  const treatmentExposureRatio =
    runtimeOutboundCalls === 0 ? 'NOT_ESTIMABLE' : runtimeContextChangedCalls / runtimeOutboundCalls
  const removedTokenRatio =
    typeof removedTokens === 'number' &&
    typeof tokensBeforeComposition === 'number' &&
    tokensBeforeComposition > 0
      ? removedTokens / tokensBeforeComposition
      : 'NOT_ESTIMABLE'
  const lifecycleUnknownCountByReason: Record<string, number> = {}
  for (const row of rows) {
    for (const [reason, count] of Object.entries(row.lifecycleUnknownCountByReason)) {
      lifecycleUnknownCountByReason[reason] = (lifecycleUnknownCountByReason[reason] ?? 0) + count
    }
  }
  const summary: C1E0DoseSummary = {
    schemaId: C1_E0_DOSE_SCHEMA_ID,
    schemaVersion: C1_E0_DOSE_SCHEMA_VERSION,
    experimentPairId,
    runtimeOutboundCalls,
    runtimeContextChangedCalls,
    uniqueEligiblePairs,
    uniqueSelectedPairs,
    uniqueRemovedPairs,
    uniqueRemovedSourceElements,
    newRemovalPairCalls,
    carriedRemovalPairCalls,
    suppressedStalePairCallExposures,
    suppressedSourceElementCallExposures,
    treatmentExposureRatio,
    tokensBeforeComposition,
    tokensAfterComposition,
    removedBytes,
    removedTokens,
    removedTokenRatio,
    activeStaleElementsPeak: maxMeasurable(rows.map((row) => row.activeStaleElements)),
    rehydrateCount: rows.reduce((total, row) => total + row.rehydrateCount, 0),
    lifecycleUnknownCountByReason,
    protectedRemovalCount: rows.reduce((total, row) => total + row.protectedRemovalCount, 0),
    contractConflictCount: rows.reduce((total, row) => total + row.contractConflictCount, 0)
  }
  return c1E0DoseSummarySchema.parse(summary)
}

export function doseSummaryFingerprint(summary: C1E0DoseSummary): string {
  return hashCanonicalC1E0(JSON.parse(canonicalC1E0Json(summary)) as unknown)
}
