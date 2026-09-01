# CSPV-C0 live-guard audit — 2026-09-01

Status: **PRE-LIVE SAFETY CORRECTION / NO PROVIDER EXECUTION**

This evidence packet covers the follow-up changes stacked on the single-use
identity correction in PR #83. It is not a live-run authorization and it does
not create, resume, or consume a C0 provider run identity.

## Scope

The correction is limited to the C0 live runner's safety boundary:

- no changes to `policy-v0` semantics;
- no changes to the frozen C0 scenarios, fixtures, manifest, or contract;
- no Pi model-facing context rewrite;
- no Live Shadow or CR-004 execution;
- no provider, network, or API-key use during verification.

## Findings closed by this correction

1. **Provider-call accounting now uses the outbound transport seam.** A guard
   wraps `globalThis.fetch` only after strict Step Plan binding and counts a
   matching provider request immediately before invoking the original fetch.
   A rejected transport attempt is therefore still charged. Requests after a
   terminal stop, and the request beyond the hard call ceiling, are rejected
   before the original fetch is reached.

2. **Boundary safety is fail-closed within a prompt burst.** The Pi extension
   runner catches and reports context-handler exceptions, so throwing from the
   handler is not sufficient to stop an Agent loop. The C0 boundary handler now
   records S-2/S-3/S-4/S-6 and calls `ExtensionContext.abort()` explicitly.
   The transport guard independently blocks any provider request after that
   terminal state.

3. **Replay ledgers are not double-counted.** The live runner reports only the
   newly observed replay mismatches for each scenario rather than adding the
   executor's cumulative count after every turn.

4. **The run-wide wall-clock deadline is enforced in-flight.** Each prompt is
   bounded by the remaining 60-minute C0 budget. The terminal callback fires
   before `AgentSession.abort()`, and the abort wait itself has a one-second
   bound so a hung abort channel cannot keep the runner alive indefinitely.

5. **Session cleanup is explicit.** A live scenario disposes its AgentSession
   before its temporary fixture directory is removed.

## Credential-free verification

| Check                                      | Result                                                            |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Pi integration typecheck                   | PASS                                                              |
| Pi integration test suite                  | PASS — 38 files, 402 tests                                        |
| C0 transport, boundary, and deadline tests | PASS                                                              |
| C0 dry run, all four scenarios             | PASS — `DRY_RUN_COMPLETE`, provider calls `0`                     |
| C0 dry-run manifest                        | PASS — 4/4 scenarios requested and completed, provider ledger `0` |
| `git diff --check`                         | PASS                                                              |

The dry run used a fresh generated identity and was retained outside the
repository as disposable audit evidence. It instantiated no `ModelRuntime`,
provider binding, session, or network transport.

The repository-level check was also run with the configured Node 24 runtime:
format, lint, all workspace typechecks, and the non-desktop workspace tests
passed (including the 69-test persistence suite). The local run stopped at
five desktop Electron suites because the local Electron binary is not
installed; 31 desktop suites still passed (186 tests). No source or dependency
change in this correction causes that environment failure, and GitHub CI is
the authoritative full-check environment. A system Node 23 run remains
incompatible with the repository's Drizzle/SQLite test path
(`stmt.setReturnArrays is not a function`); it is not used as the release gate.
This correction introduces no production dependency change.

## Remaining pre-live review items

This correction intentionally does not silently amend the frozen C0 contract.
Before any separate live authorization, Lead review must still resolve the
contract-level evidence gaps already identified:

- the §9 storage table names `transitions.jsonl`, `decisions.jsonl`, and
  `binding.json`, while the current runner writes `transitions.json` and
  `verdicts.json` with binding embedded in `manifest.json`;
- the contract requires corpus and contract identity hashes in the run
  manifest, while the current runner records the contract path and policy
  version but not those hashes;
- Appendix A still contains `TBD` adapter mappings, and §6 says unresolved
  mappings block execution.

Until those items are separately resolved or explicitly amended, the C0 live
state remains:

```text
Provider execution: NO_GO
Live canary:        NO_GO
CR-004:             NO_GO
```
