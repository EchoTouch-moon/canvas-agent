# CR-004 L-Series Task Design (2026-08-27)

Stage 1 of the CR-004 matrix ran the C1 localized bug fix (one file, tiny edit
surface) and could not expose context pressure or lifecycle effects. The
L-series adds three larger, offline, Node-only coding tasks where reading
enough of the repository before editing is the dominant cost. All three
tasks are deterministic (no network, no wall-clock reads on tested paths, no
randomness) and use `node:test` only.

Common properties:

- CommonJS, zero dependencies, oracle `node --test` with two files per task
  (primary + regression). The manifest `oracle.args` lists both files
  explicitly because the harness spawns commands without a shell (no glob
  expansion).
- Fixture regression oracles pass on the fixture (matching the corpus
  validation contract: known-bad fixture must fail the primary oracle while
  the regression oracle stays green).
- Reference oracles pass both files with exit code 0; fixture primary oracles
  fail with exit code 1.
- Budgets: `maxSemanticCalls 40`, `maxToolCalls 120`, `wallClockMs 600000`,
  model profile `step-plan` / `step-3.7-flash` / `medium`, strategies
  `NATIVE` + `ACTIVE`.
- The ACTIVE treatment drops superseded read evidence when a file is edited,
  so each task rewards exploring several files before the first edit.

---

## L1 — multi-file signature refactor

**Manifest**: `research/context-benchmarks/matrix-manifests/L1-multi-file-refactor.json`
**Corpus**: `research/context-benchmarks/corpus/L1-multi-file-refactor/`

### Intent

A CommonJS inventory/order system (models / services / utils / reports /
index) where `formatPrice(amount, currency)` in `utils/format.js` must move
to an options-based contract `formatPrice(amount, currency, options)` with a
required options object carrying `locale` (`en-US` / `de-DE` / `fr-FR`) and
an optional `omitDecimals` flag. The formatter also gains locale-aware
grouping, decimal separators, symbol placement, and JPY zero-minor-unit
behavior. The primary test pins the contract directly and exercises eight
migrated call sites, so any unmigrated call site keeps the suite red.

Call sites (all must be migrated):

| File | Call-site method | Options shape passed |
| --- | --- | --- |
| `models/product.js` | `describe(locale)` | `{ locale }` |
| `models/order.js` | `summary(locale)` | `{ locale }` and `{ locale, omitDecimals: true }` |
| `models/shipment.js` | `label(locale)` | `{ locale }` |
| `services/cart.js` | `receipt(locale)` | `{ locale }` |
| `services/pricing.js` | `quote(amount, currency, locale)` | `{ locale }` |
| `services/inventory.js` | `valuation(locale)` | `{ locale, omitDecimals: true }` |
| `services/billing.js` | `invoiceLine(record, locale)` | `{ locale }` |
| `index.js` | `renderQuote(amount, currency, locale)` | `{ locale }` |

`utils/money.js` stays untouched (regression pins its helpers); the
regression file also pins `formatPercent` / `formatDuration` and numeric
cart/inventory behavior so a sloppy rewrite of `utils/format.js` fails.

### Lifecycle shape exercised

Read-many-then-edit cascade. The model must read the contract test, the
formatter, and every importing module before the first edit; after it edits
`utils/format.js`, ACTIVE discards earlier read evidence of the callers, so
the useful order is explore-everything first, then a burst of edits across
nine files. Grepping for `formatPrice` finds both real call sites and
comment references inside distractors, so the exploration is genuinely
multi-file.

### Distractor inventory (4)

| Path | Lure |
| --- | --- |
| `reports/legacy-csv-export.js` | Dead CSV exporter; comment muses about migrating to the new formatPrice options contract. |
| `reports/audit-trail-writer.js` | Plausible compliance writer; imports `utils/money.js` only, never `formatPrice`. Referenced by a comment in `services/inventory.js`. |
| `utils/deprecated-tax-table.js` | Old tax table marked "superseded by services/pricing.js / billing.js". |
| `services/xml-adapter.js` | Alternate ERP adapter, not wired into `index.js`. |

### Sizes

Fixture: 16 JS files (14 source + 2 test), 406 source lines, 179 test
lines. Reference differs in exactly 9 files (the edit surface); distractors
and tests are byte-identical.

---

## L2 — cross-module caching feature

**Manifest**: `research/context-benchmarks/matrix-manifests/L2-cache-feature.json`
**Corpus**: `research/context-benchmarks/corpus/L2-cache-feature/`

### Intent

A small data-access app: injected-transport API client, an instrumented
in-memory store (`readCount` counts every `get`/`list`), repositories for
users / products / orders, wire serializers, an exact-match router, and an
`app.js` composition root. The feature demanded by `test/cache.test.js` is a
TTL read-through cache: repeated `findById`/`list` reads within the TTL hit
the store exactly once, entries expire after the TTL, and
`create`/`update`/`remove` invalidate so writes stay visible through the
repositories and the router. Time comes only from the injected clock
(`{ now() }`), so expiry is tested by advancing a fake clock (within-TTL at
+500ms, expired at +1501ms — no boundary-adjacent assertions).

The reference solution adds one shared module `src/cache.js`
(`createTtlCache({ ttlMs, clock })` with `get`/`invalidate`/
`invalidatePrefix`/`clear`) and wires the three repositories plus `app.js`
through it. The fixture repositories simply ignore the not-yet-existing
`ttlMs`/`clock` options, so the fixture primary test fails with clean
assertion failures (store hit too often, stale values after writes) rather
than crashes.

### Lifecycle shape exercised

Read-then-implement with later verification reads. The model reads the
failing test, the store instrumentation, one repository, and the composition
root; it then writes a new module and edits four files. Unlike L1 the edit
surface is small and one file is created from scratch, but understanding
the store's read accounting and the router's read/write paths first is what
separates a one-shot pass from a cache that breaks write visibility. The
router end-to-end test forces a verification read of `app.js` wiring after
the repositories are done.

### Distractor inventory (4)

| Path | Lure |
| --- | --- |
| `src/loggers/console-logger.js` | Level-threshold logger with off-by-one-looking level comparison that is actually correct. |
| `src/loggers/json-file-logger.js` | Observability-spike JSON logger, unwired. |
| `src/adapters/rest-adapter.js` | First-integration REST adapter with request/response converters, superseded by `src/router.js`. |
| `src/adapters/graphql-adapter.js` | GraphQL-shaped query builder from the API redesign, never imported. |

### Sizes

Fixture: 14 JS files (12 source + 2 test), 468 source lines, 237 test
lines. Reference adds `src/cache.js` and differs in exactly 4 existing
files (three repositories + `app.js`).

---

## L3 — noisy-repo bug hunt

**Manifest**: `research/context-benchmarks/matrix-manifests/L3-noisy-bug-hunt.json`
**Corpus**: `research/context-benchmarks/corpus/L3-noisy-bug-hunt/`

### Intent

A ~14-module job-scheduling system (paginator, scheduler, registry, runner,
job, clock, index) containing exactly one real defect: the paginator's page
window uses `end = start + pageSize - 1`, silently dropping the last item of
every full page. The scheduler's `runPendingPage` consumes paginator pages,
so batches come back one job short and page-slice assertions fail. The
reference fix is the single line `end = start + pageSize`; nothing else
changes (verified by `diff -rq`: only `src/scheduler/paginator.js` differs).

Around the real bug sit seven seductive decoys that are all correct as
written; the regression suite pins each one's behavior, so "fixing" a decoy
fails the regression oracle even after the primary test is green. This
makes the task maximize exploration-then-narrowing: the model must read
suspicious code, decide it is correct, and leave it alone.

### The one real defect

```diff
-  const end = start + pageSize - 1
+  const end = start + pageSize
```

### Decoy inventory (7)

| Path | Smell | Why it is correct (pinned by regression) |
| --- | --- | --- |
| `src/scheduler/backoff.js` | Loop-based exponent with cap; "attempt is 0-based" comment looks like an off-by-one. | attempt 0 → baseMs, 5 → 3200, 10 → cap 60000. |
| `src/scheduler/priority-queue.js` | Hand-rolled heap index math `Math.floor((i-1)/2)`. | Drain order priority desc, insertion asc. |
| `src/scheduler/sliding-window.js` | `>=` expiry boundary looks one millisecond early. | Hits expire at `now - hit >= windowMs`; limiter refills after the window. |
| `src/utils/recurrence.js` | `candidate <= fromTimestamp` with day-floor math. | Next occurrence is strictly after the timestamp. |
| `src/utils/hash-bucket.js` | Defensive `normalized < 0` branch plus magic modulus 2147483647. | Stable radix-31 hash; `bucketFor('user:1', 8) === 3`. |
| `src/queue/dead-letter.js` | `attempts >= maxAttempts` status flip. | Flips to `dead` exactly on the third record with maxAttempts 3. |
| `src/legacy/old-scheduler.js` | Duplicated sort logic plus a commented-out drain loop. | Audit-replay ordering pinned; dead code by design. |

### Lifecycle shape exercised

Heavy distractor exploration then narrowing. Most reads land on files that
must NOT be edited; the winning behavior is a broad skim of the scheduler
package, a targeted comparison of paginator semantics against the primary
test's page-slice expectations, then one minimal edit. Under ACTIVE,
decoy-read evidence gets discarded when the paginator edit lands, which is
fine because the fix requires no further decoy context.

### Sizes

Fixture: 16 JS files (14 source + 2 test), 440 source lines, 208 test
lines. Reference is byte-identical except the one paginator line.

---

## Oracle verification transcript

Node binary: `/opt/homebrew/opt/node@24/bin/node` (v24.15.0). Working
directories are the fixture/reference roots; primary and regression oracle
commands match the manifest `oracle` / `regressionOracle` entries.

```
$ cd research/context-benchmarks/corpus/L1-multi-file-refactor/fixture
$ node --test test/format-price.test.js        # exit 1 (pass 0/16)
$ node --test test/regression.test.js          # exit 0 (pass 5/5)

$ cd ../reference
$ node --test test/format-price.test.js        # exit 0 (pass 16/16)
$ node --test test/regression.test.js          # exit 0 (pass 5/5)

$ cd research/context-benchmarks/corpus/L2-cache-feature/fixture
$ node --test test/cache.test.js               # exit 1 (pass 2/7)
$ node --test test/regression.test.js          # exit 0 (pass 4/4)

$ cd ../reference
$ node --test test/cache.test.js               # exit 0 (pass 7/7)
$ node --test test/regression.test.js          # exit 0 (pass 4/4)

$ cd research/context-benchmarks/corpus/L3-noisy-bug-hunt/fixture
$ node --test test/pagination.test.js          # exit 1 (pass 2/6)
$ node --test test/regression.test.js          # exit 0 (pass 10/10)

$ cd ../reference
$ node --test test/pagination.test.js          # exit 0 (pass 6/6)
$ node --test test/regression.test.js          # exit 0 (pass 10/10)
```

Matrix summary:

| Task | Fixture primary | Fixture regression | Reference primary | Reference regression |
| --- | --- | --- | --- | --- |
| L1 | FAIL exit 1 (0/16) | PASS exit 0 (5/5) | PASS exit 0 (16/16) | PASS exit 0 (5/5) |
| L2 | FAIL exit 1 (2/7) | PASS exit 0 (4/4) | PASS exit 0 (7/7) | PASS exit 0 (4/4) |
| L3 | FAIL exit 1 (2/6) | PASS exit 0 (10/10) | PASS exit 0 (6/6) | PASS exit 0 (10/10) |

## Determinism notes

- No test reads the wall clock, environment, or network. L2 repositories
  accept an injected `{ now() }` clock; tests advance a local fake clock and
  deliberately avoid TTL-boundary values (checked at +500 and +1501 for a
  1000ms TTL). L3 supplies `createFakeClock`; production defaults using
  `Date.now()` are never exercised by the suites.
- L3's `job.js` keeps a module-level sequence counter; every primary test
  that asserts exact job ids calls `resetSeq()` first, and each test file
  runs in its own `node --test` process.
- All expected numeric values were chosen to avoid floating-point
  representation edge cases; totals are either exact doubles or normalized
  through rounding before assertion.
