import { describe, expect, it } from "vitest";
import {
  compositeTraceFixture,
  distractorEliminationFixture,
  mandatoryBudgetFixture,
  phaseShiftFixture,
  runGateB0Suite,
  runOracleMutationTests,
  runScenario,
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

describe("CSPV-B0 deterministic policy lifecycle suite", () => {
  it("executes all frozen scenarios without provider or harness failures", () => {
    const result = runGateB0Suite(SCENARIOS);

    expect(result.providerCalls).toBe(0);
    expect(result.removeCount).toBeGreaterThan(0);
    expect(result.rehydrateCount).toBeGreaterThan(0);
    expect(result.replayMismatches).toBe(0);
    expect(result.classification).toBe("POLICY_CAPABILITY_GAP");
    expect(
      result.scenarioResults.every(
        (scenario) => scenario.harnessFailures.length === 0,
      ),
    ).toBe(true);
  });

  it("keeps conservative availability handling visibly green", () => {
    expect(runScenario(unavailableSourceFixture).classification).toBe("PASS");
    expect(runScenario(mandatoryBudgetFixture).classification).not.toBe(
      "HARNESS_CONTRACT_FAILURE",
    );
  });

  it("records the current policy gaps instead of changing the oracle", () => {
    const result = runGateB0Suite(SCENARIOS);
    const gaps = result.scenarioResults.flatMap(
      (scenario) => scenario.policyFailures,
    );

    expect(gaps).toEqual(
      expect.arrayContaining([
        expect.stringContaining("missing reason RULED_OUT"),
        expect.stringContaining("missing reason SUPERSEDED"),
      ]),
    );
  });

  it("proves the oracle catches deliberate evidence corruption", () => {
    expect(runOracleMutationTests()).toEqual([
      "expected-version",
      "rehydrate-kind",
      "originating-remove",
      "unavailable-absence",
      "protected-eviction",
    ]);
  });
});
