import { createSourceVersionId } from "../../../src";
import { mandatoryBudgetFixture } from "./mandatory-budget";
import { unavailableSourceFixture } from "./unavailable-source";
import { wrongPathRecoveryFixture } from "./wrong-path-recovery";
import { SOURCE_KEYS } from "./common";
import { runScenario, validateEvidenceContract } from "./runner";
import type { EvidenceSnapshot, LifecycleTransitionRecord } from "./types";

function snapshotFor(
  result: ReturnType<typeof runScenario>,
  overrides: Partial<EvidenceSnapshot> = {},
): EvidenceSnapshot {
  return {
    records: result.records,
    universeByRevision: result.universeByRevision,
    sourceVersionsByKey: result.sourceVersionsByKey,
    representationsById: result.representationsById,
    protectedSourceKeys: [],
    unavailableSourceKeys: [],
    ...overrides,
  };
}

function replaceRecord(
  records: readonly LifecycleTransitionRecord[],
  predicate: (record: LifecycleTransitionRecord) => boolean,
  replacement: (record: LifecycleTransitionRecord) => LifecycleTransitionRecord,
): readonly LifecycleTransitionRecord[] {
  let replaced = false;
  return records.map((record) => {
    if (!replaced && predicate(record)) {
      replaced = true;
      return replacement(record);
    }
    return record;
  });
}

export function runOracleMutationTests(): readonly string[] {
  const recovery = runScenario(wrongPathRecoveryFixture);
  const rehydrate = recovery.records.find(
    (record) => record.decisionKind === "REHYDRATE",
  );
  const remove = recovery.records.find(
    (record) =>
      record.decisionKind === "REMOVE" &&
      record.sourceKey === SOURCE_KEYS.reopenA,
  );
  if (rehydrate === undefined || remove === undefined) {
    throw new Error(
      "oracle mutation fixture did not produce the required REMOVE/REHYDRATE pair",
    );
  }
  if (validateEvidenceContract(snapshotFor(recovery)).length > 0) {
    throw new Error("oracle mutation baseline is not valid before mutation");
  }

  const unavailable = runScenario(unavailableSourceFixture);
  const unavailableRecord = unavailable.records.find(
    (record) => record.sourceKey === SOURCE_KEYS.unavailable,
  );
  if (unavailableRecord === undefined)
    throw new Error("unavailable mutation fixture has no record");

  const budget = runScenario(mandatoryBudgetFixture);
  const evicted = budget.records.find(
    (record) => record.decisionKind === "REMOVE",
  );
  if (evicted === undefined)
    throw new Error("protected mutation fixture has no eviction record");

  const mutations: readonly {
    readonly name: string;
    readonly snapshot: EvidenceSnapshot;
  }[] = [
    {
      name: "expected-version",
      snapshot: snapshotFor({
        ...recovery,
        records: replaceRecord(
          recovery.records,
          (record) => record === rehydrate,
          (record) => ({
            ...record,
            sourceVersionId: createSourceVersionId(
              SOURCE_KEYS.reopenA,
              "reopen-a:v2",
            ),
          }),
        ),
      }),
    },
    {
      name: "rehydrate-kind",
      snapshot: snapshotFor({
        ...recovery,
        records: replaceRecord(
          recovery.records,
          (record) => record === remove,
          (record) => ({
            ...record,
            decisionKind: "ADD",
          }),
        ),
      }),
    },
    {
      name: "originating-remove",
      snapshot: snapshotFor({
        ...recovery,
        records: replaceRecord(
          recovery.records,
          (record) => record === rehydrate,
          (record) => ({
            ...record,
            originatingRemoveTransitionId: null,
          }),
        ),
      }),
    },
    {
      name: "unavailable-absence",
      snapshot: snapshotFor(unavailable, {
        records: replaceRecord(
          unavailable.records,
          (record) => record === unavailableRecord,
          (record) => ({
            ...record,
            reasonCodes: [...record.reasonCodes, "SOURCE_ABSENT"],
          }),
        ),
        unavailableSourceKeys: [SOURCE_KEYS.unavailable],
      }),
    },
    {
      name: "protected-eviction",
      snapshot: snapshotFor(budget, {
        records: replaceRecord(
          budget.records,
          (record) => record === evicted,
          (record) => ({
            ...record,
            sourceKey: SOURCE_KEYS.task,
          }),
        ),
        protectedSourceKeys: [SOURCE_KEYS.task],
      }),
    },
  ];

  const passed: string[] = [];
  for (const mutation of mutations) {
    const failures = validateEvidenceContract(mutation.snapshot);
    if (failures.length === 0) {
      throw new Error(`oracle mutation did not fail: ${mutation.name}`);
    }
    passed.push(mutation.name);
  }
  return passed;
}
