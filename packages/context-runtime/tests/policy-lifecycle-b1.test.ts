import { describe, expect, it } from "vitest";
import {
  compositeTraceFixture,
  distractorEliminationFixture,
  mandatoryBudgetFixture,
  phaseShiftFixture,
  runGateB1Suite,
  runScenarioB1,
  supersededEvidenceFixture,
  unavailableSourceFixture,
  wrongPathRecoveryFixture,
} from "./fixtures/policy-lifecycle";

const SCENARIOS = [
  distractorEliminationFixture,
  wrongPathRecoveryFixture,
  mandatoryBudgetFixture,
  supersededEvidenceFixture,
  unavailableSourceFixture,
  phaseShiftFixture,
  compositeTraceFixture,
] as const;

describe("CSPV-B1 lifecycle semantic input repair", () => {
  it("passes the frozen B0 traces and oracle without provider calls", () => {
    const result = runGateB1Suite(SCENARIOS);

    expect(result.providerCalls).toBe(0);
    expect(result.classification).toBe("PASS");
    expect(result.replayMismatches).toBe(0);
    expect(result.scenarioResults).toHaveLength(7);
    expect(
      result.scenarioResults.every(
        (scenario) =>
          scenario.classification === "PASS" &&
          scenario.policyFailures.length === 0 &&
          scenario.harnessFailures.length === 0,
      ),
    ).toBe(true);
  });

  it("preserves the lifecycle reason semantics instead of guessing from exclusion", () => {
    const s1 = runScenarioB1(distractorEliminationFixture);
    const s2 = runScenarioB1(wrongPathRecoveryFixture);
    const s4 = runScenarioB1(supersededEvidenceFixture);
    const s6 = runScenarioB1(phaseShiftFixture);

    expect(
      s1.records.find(
        (record) =>
          record.decisionKind === "REMOVE" &&
          record.sourceKey === "repo/distractor-a",
      )?.reasonCodes,
    ).toContain("RULED_OUT");
    expect(
      s2.records.find((record) => record.decisionKind === "REHYDRATE")
        ?.reasonCodes,
    ).toContain("DETAIL_REQUIRED");
    expect(
      s4.records.find(
        (record) =>
          record.decisionKind === "REMOVE" &&
          record.sourceKey === "run/failure-old",
      )?.reasonCodes,
    ).toContain("SUPERSEDED");
    expect(
      s4.records.find(
        (record) =>
          record.decisionKind === "ADD" &&
          record.sourceKey === "run/failure-new",
      )?.reasonCodes,
    ).toContain("NEW_FAILURE_EVIDENCE");
    expect(
      s6.records.find((record) => record.decisionKind === "REMOVE")
        ?.reasonCodes,
    ).toContain("PHASE_IRRELEVANT");
  });
});
