import { describe, expect, it } from 'vitest'
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { PiMessageView } from '../src'
import {
  createActiveRewriteExtension,
  createRunKillSwitch,
  InMemoryActiveRewriteEvidenceCollector,
  type ActiveRewriteEventEvidence
} from '../src/experimental'
import {
  C0_E2_WRONG_PATH_RECOVERY,
  C0_E3_PHASE_SHIFT,
  C0ScenarioExecutor,
  runScenarioOnScriptedMessages
} from '../src/smoke/c0-scenarios'

// CR-004 LC0 runtime lifecycle conformance.
//
// This is a deterministic, credential-free screen over the real Active
// extension -> transactional composer/guard -> policy-v0 planner seam. It is
// deliberately test-only: no provider, manifest, fixture, policy, Pi
// default, or production behavior is changed. The suite distinguishes a safe
// fresh read after removal from an explicit policy-level REHYDRATE relation.

const FIXED_NOW = '2026-08-30T00:00:00.000Z'
const RUN_ID = 'cr004-lc0-20260830-01234567'
const PROMPT = 'Refactor the module per the task manifest.'
const P1 = 'src/alpha.ts'
const ALPHA_OLD = 'alpha content before edit'
const ALPHA_V1 = 'alpha content v1'
const ALPHA_V2 = 'alpha content v2 after removal'

type ContextHandler = (event: ContextEvent) => Promise<{ messages: unknown[] } | undefined>

function register(factory: ExtensionFactory): {
  dispatch: (messages: readonly PiMessageView[]) => Promise<{ messages: unknown[] } | undefined>
} {
  let handler: ContextHandler | undefined
  const pi = {
    on: (event: 'context', registered: ContextHandler) => {
      if (event === 'context') handler = registered
    }
  } as unknown as ExtensionAPI
  factory(pi)
  if (handler === undefined) throw new Error('factory registered no context handler')
  return {
    dispatch: async (messages) =>
      handler!({ type: 'context', messages: messages as unknown as ContextEvent['messages'] })
  }
}

function userMessage(text: string): PiMessageView {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function textMessage(text: string): PiMessageView {
  return { role: 'assistant', content: [{ type: 'text', text }] }
}

function readPair(
  callId: string,
  path: string,
  resultText: string,
  label: string
): readonly PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: label },
        { type: 'toolCall', id: callId, name: 'read', arguments: { path } }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: resultText }],
      toolCallId: callId,
      toolName: 'read',
      isError: false
    }
  ]
}

function editPair(callId: string, path: string, label = `Editing ${path}.`): readonly PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: label },
        { type: 'toolCall', id: callId, name: 'edit', arguments: { path } }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: `edited ${path}` }],
      toolCallId: callId,
      toolName: 'edit',
      isError: false
    }
  ]
}

function bashPair(callId: string, command: string, label: string): readonly PiMessageView[] {
  return [
    {
      role: 'assistant',
      content: [
        { type: 'text', text: label },
        { type: 'toolCall', id: callId, name: 'bash', arguments: { command } }
      ]
    },
    {
      role: 'toolResult',
      content: [{ type: 'text', text: `ran ${command}` }],
      toolCallId: callId,
      toolName: 'bash',
      isError: false
    }
  ]
}

function textsOf(messages: readonly PiMessageView[]): string {
  return messages
    .flatMap((message) =>
      typeof message.content === 'string' ? [message.content] : (message.content ?? [])
    )
    .map((block) =>
      typeof block === 'string'
        ? block
        : (((block as { text?: unknown }).text as string | undefined) ?? '')
    )
    .join('\n')
}

function occurrencesOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

interface Harness {
  readonly dispatch: (messages: readonly PiMessageView[]) => Promise<{ messages: unknown[] } | undefined>
  readonly executor: C0ScenarioExecutor
  readonly collector: InMemoryActiveRewriteEvidenceCollector
}

function createHarness(options: { readonly systemInstruction?: string; readonly suffix: string }): Harness {
  const executor = new C0ScenarioExecutor({
    runtimeSessionId: `${RUN_ID}:${options.suffix}`,
    now: () => FIXED_NOW
  })
  const collector = new InMemoryActiveRewriteEvidenceCollector()
  const factory = createActiveRewriteExtension({
    runId: RUN_ID,
    systemInstruction: options.systemInstruction ?? 'You are a careful coding agent.',
    executor,
    killSwitch: createRunKillSwitch(RUN_ID, { now: () => FIXED_NOW }),
    evidence: collector,
    removalPolicy: 'v3-verify-window-dedup'
  })
  return { dispatch: register(factory).dispatch, executor, collector }
}

async function prime(harness: Harness, messages: readonly PiMessageView[]): Promise<void> {
  await harness.dispatch(messages.slice(0, 1))
  await harness.dispatch(messages)
}

describe('CR-004 LC0 runtime lifecycle conformance', () => {
  it('keeps REMOVE carried out while a later fresh read becomes active without stale resurrection', async () => {
    const harness = createHarness({ suffix: 'remove-carry-demand' })
    const initial: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r0', P1, ALPHA_OLD, 'Reading alpha before edit.'),
      ...readPair('r1', P1, ALPHA_V1, 'Reading alpha latest before edit.'),
      ...editPair('e1', P1)
    ]
    await prime(harness, initial)

    const firedInput: readonly PiMessageView[] = [...initial, textMessage('Continue after the edit.')]
    const fired = await harness.dispatch(firedInput)
    const firedMessages = fired!.messages as readonly PiMessageView[]
    const sent = harness.collector.interventions.find((event) => event.sentRewrite)!
    expect(sent.attemptOutcome).toBe('SENT')
    expect(sent.trigger).toBe('edit')
    expect(sent.bindingHashes).toBeDefined()
    expect(sent.modelVisibleAfterMessageCount).toBeLessThan(sent.modelVisibleBeforeMessageCount!)
    expect(textsOf(firedMessages)).not.toContain(ALPHA_OLD)
    expect(textsOf(firedMessages)).toContain(ALPHA_V1)
    expect(harness.executor.finalActiveSourceKeys()).not.toContain('run/tool-result://r0')

    const laterInput: readonly PiMessageView[] = [
      ...firedInput,
      ...readPair('r2', P1, ALPHA_V2, 'Reading alpha again after later demand.')
    ]
    const later = await harness.dispatch(laterInput)
    const laterMessages = later!.messages as readonly PiMessageView[]
    const laterEvent = harness.collector.events.at(-1) as ActiveRewriteEventEvidence

    expect(textsOf(laterMessages)).not.toContain(ALPHA_OLD)
    expect(textsOf(laterMessages)).toContain(ALPHA_V2)
    expect(laterEvent.sentRewrite).toBe(false)
    expect(laterEvent.readTargets?.map((target) => target.toolCallId)).toContain('r2')
    expect(harness.executor.finalActiveSourceKeys()).not.toContain('run/tool-result://r0')
    expect(harness.executor.finalActiveSourceKeys()).toContain('run/tool-result://r2')
    expect(harness.executor.finalActiveSourceKeys()).toContain('run/tool-call://r2')

    const r2Decisions = harness.executor.chain.filter(
      (decision) => decision.sourceKey === 'run/tool-result://r2'
    )
    expect(r2Decisions.at(-1)?.kind).toBe('ADD')
    expect(r2Decisions.some((decision) => decision.kind === 'REHYDRATE')).toBe(false)
  })

  it('proves planner-level REMOVE -> REHYDRATE provenance on the frozen C0 traces', () => {
    for (const scenario of [C0_E2_WRONG_PATH_RECOVERY, C0_E3_PHASE_SHIFT]) {
      const result = runScenarioOnScriptedMessages(scenario, {
        runtimeSessionId: `${RUN_ID}:planner:${scenario.id}`,
        now: () => FIXED_NOW
      })
      expect(result.scenarioVerdict, scenario.id).toBe('PASS')
      expect(result.replayMismatchCount, scenario.id).toBe(0)
      const removeSources = new Set(
        result.chain.filter((decision) => decision.kind === 'REMOVE').map((decision) => decision.sourceKey)
      )
      const rehydrates = result.chain.filter((decision) => decision.kind === 'REHYDRATE')
      expect(rehydrates.length, scenario.id).toBeGreaterThan(0)
      for (const decision of rehydrates) {
        expect(removeSources, scenario.id).toContain(decision.sourceKey)
        expect(decision.sourceVersionId, scenario.id).toBeTruthy()
        expect(decision.reasonCodes, scenario.id).toContain('DETAIL_REQUIRED')
      }
    }
  })

  it('defers edit removal during verification while allowing dedup in the same window', async () => {
    const harness = createHarness({ suffix: 'window-dedup' })
    const base: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r1', P1, ALPHA_V1, 'Reading alpha.'),
      ...readPair('r2', P1, ALPHA_V1, 'Verifying alpha with identical content.'),
      ...editPair('e1', P1),
      ...bashPair('b1', 'pnpm test', 'Running the first oracle.'),
      ...bashPair('b2', 'pnpm test -- --runInBand', 'Running the second oracle.')
    ]
    await prime(harness, base)
    const fired = await harness.dispatch([...base, textMessage('Continue after verification.')])
    const output = fired!.messages as readonly PiMessageView[]
    const event = harness.collector.events.at(-1) as ActiveRewriteEventEvidence
    const attempt = harness.collector.interventions[0]!

    expect(event.deferredByVerifyWindow).toBe(true)
    expect(harness.collector.deferredSweeps).toBe(1)
    expect(attempt.trigger).toBe('dedup')
    expect(harness.collector.dedupRemovals).toBe(1)
    expect(textsOf(output)).toContain('ran pnpm test')
    expect(textsOf(output)).toContain('Verifying alpha with identical content.')
    expect(occurrencesOf(textsOf(output), ALPHA_V1)).toBe(1)
    expect(attempt.removedBlocks).toBe(1)
  })

  it('rolls back a failed composition and leaves the removed source eligible', async () => {
    const harness = createHarness({ suffix: 'rollback', systemInstruction: '' })
    const initial: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('r0', P1, ALPHA_OLD, 'Reading alpha before failed attempt.'),
      ...readPair('r1', P1, ALPHA_V1, 'Reading alpha latest before failed attempt.'),
      ...editPair('e1', P1)
    ]
    await prime(harness, initial)
    const digestBefore = harness.executor.planningStateDigest()
    const firedInput: readonly PiMessageView[] = [
      ...initial,
      textMessage('Attempt the rewrite.')
    ]
    const fired = await harness.dispatch(firedInput)

    expect(fired?.messages).toBe(firedInput as unknown as unknown[])
    expect(harness.collector.interventions).toHaveLength(1)
    expect(harness.collector.interventions[0]!.attemptOutcome).toBe('FALLBACK')
    expect(harness.collector.interventions[0]!.fallbackReason).toBe('SYSTEM_INSTRUCTION_ABSENT')
    expect(harness.collector.sendsUsed).toBe(0)
    expect(harness.executor.finalActiveSourceKeys()).toContain('run/tool-result://r0')
    expect(harness.executor.observationCount).toBe(3)
    expect(harness.executor.planningStateDigest()).not.toBe(digestBefore)
  })

  it('does not treat a later same-path new read as explicit REHYDRATE evidence', async () => {
    const harness = createHarness({ suffix: 'identity-gap' })
    const initial: readonly PiMessageView[] = [
      userMessage(PROMPT),
      ...readPair('old-read-0', P1, ALPHA_OLD, 'Initial path read.'),
      ...readPair('old-read-1', P1, ALPHA_V1, 'Latest path read.'),
      ...editPair('edit-1', P1)
    ]
    await prime(harness, initial)
    await harness.dispatch([...initial, textMessage('Commit the edit.')])
    const later = await harness.dispatch([
      ...initial,
      textMessage('Commit the edit.'),
      ...readPair('new-read', P1, ALPHA_V2, 'Later demand for the same path.')
    ])

    const r2Decisions = harness.executor.chain.filter(
      (decision) => decision.sourceKey === 'run/tool-result://new-read'
    )
    expect(r2Decisions.at(-1)?.kind).toBe('ADD')
    expect(r2Decisions.some((decision) => decision.kind === 'REHYDRATE')).toBe(false)
    expect((later!.messages as readonly PiMessageView[]).some((message) =>
      textsOf([message]).includes(ALPHA_V2)
    )).toBe(true)
  })
})
