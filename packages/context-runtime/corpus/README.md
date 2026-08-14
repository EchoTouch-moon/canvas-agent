# Context Runtime golden corpus

This directory defines the first eight zero-provider-call cases for the v0.3
core state machine. The executable assertions live in
`../tests/context-runtime-core.test.ts`; the manifest in `cases.ts` keeps the
case IDs stable for later snapshot/report tooling.

The minimum evidence chain is:

```text
Observation
  -> UniverseRevision
  -> ProposedWorkingSet
  -> AdmissionReceipt
  -> CommittedWorkingSet
  -> WorkingSetTransition
```

No case requires a model, network, or provider credential. A future adapter
benchmark may add request-reconstruction evidence, but it must not alter these
core case identities.
