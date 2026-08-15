# P3-17 — Historical Intelligence & Trend

```
TASK
P3-17 — Historical Intelligence & Trend

STATUS
STOPPED AT PHASE 0 (DATA GATE) — NO PRODUCTION CODE IMPLEMENTED

DOCUMENT
docs/P3_Upgrade/P3_17_HISTORICAL_INTELLIGENCE_AND_TREND.md

VERDICT
B. DATA INSUFFICIENT — NEED MORE P3 EXECUTIONS
```

==================================================
PHASE 0 — DATA GATE (MANDATORY, RUN FIRST)
==================================================

The task requires confirming **>= 3 VALID P3 artifacts** for AI (narrativeId=1)
sharing the same identity before any implementation:

```
narrative_id + window + algorithm_key + algorithm_version + calculation_mode
```

### Gate query (read-only SELECT against production DB)

Queried `p3_narrative_intelligence` ordered by `window_end DESC`:

```
TOTAL artifacts: 2

id=9 narrative=1 windowEnd=2026-08-13T00:00:00Z span=8d alg=p3-orchestrator/1 mode=observed state=VALID
     regime=WEAKENING rotation=INFLOW (61.190795)
id=1 narrative=1 windowEnd=2026-08-11T00:00:00Z span=8d alg=p3-orchestrator/1 mode=observed state=VALID
     regime=NEUTRAL rotation=ACCELERATING (75.192711)

GATE: AI VALID artifacts (p3-orchestrator/1/observed): 2
VERDICT: DATA INSUFFICIENT (need >= 3, have 2)

VALID artifacts per narrative: { '1': 2 }
```

### Gate result

| Criterion | Required | Actual |
|---|---|---|
| VALID artifacts, narrative=1 | >= 3 | **2** |
| Same algorithm_key | p3-orchestrator | p3-orchestrator (both) |
| Same algorithm_version | 1 | 1 (both) |
| Same calculation_mode | observed | observed (both) |
| Same window | 7D | 7D (both) |

**Artifact #3 does not exist.** The Phase 0 gate fails → **STOP, do not implement.**

Per the task:

> "Nếu chưa đủ 3: STOP — DATA INSUFFICIENT, không implement giả lập."

No service, no API extension, no UI, no tests, no synthetic/historical data were
created. Phases A–F are fully deferred and remain frozen against the P3-14 spec.

==================================================
EXECUTION DATA INVESTIGATION (READ-ONLY)
==================================================

The task requires investigating execution data before concluding, since #3 is
missing. Findings from production `scheduler_logs` (job `p3_execution_loop`)
and the execution-loop code:

### 1. Scheduler history (3 runs, all from P3-15 verification on 2026-08-14)

```
id=165 status=COMPLETED started=2026-08-14T05:37:20Z details={ failed:0, skipped:1, executed:0,
  outcomes:[ { action:"skipped_existing", windowEnd:"2026-08-11", narrativeId:1, ... } ] }

id=164 status=COMPLETED started=2026-08-14T05:36:29Z details={ failed:5, executed:0,
  windowEnd:"2026-08-14", outcomes:[ AI -> "P3-09 Rotation=MISSING" (5 narratives all failed) ] }

id=163 status=COMPLETED started=2026-08-14T05:33:10Z details={ failed:5, executed:0,
  windowEnd:"2026-08-14", outcomes:[ AI -> "P3-09 Rotation=MISSING" ... ] }
```

Interpretation:

- The Aug 14 window was **attempted and failed pre-P3-16** (Rotation=MISSING —
  exactly the deadlock P3-15 documented and P3-16 fixed). Nothing was persisted.
- The Aug 11 window was correctly `skipped_existing` (idempotency proof).
- **No scheduler run has occurred since P3-16 was implemented**, so no window
  has been attempted with the SECOND_RUN/NORMAL rotation semantics in place.

### 2. Window targeting behavior (why #3 is not "Aug 15" by construction)

The loop's candidate window is `windowEnd = options.windowEnd ?? utcDayStart(now)`
(execution-loop.ts), i.e. **the latest completed UTC day**, not a fixed 2-day
series. Confirmed by an actual read-only dry-run of the loop today:

```
dryRun=true, now=2026-08-14T07:06:21Z, windowEnd=2026-08-14T00:00:00Z
outcomes: [ { narrativeId:1, action:"would_execute", identity:"1|2026-08-14|p3-orchestrator|1|observed" } ]
```

So the next scheduler tick targets **the current UTC day at run time** (Aug 14
today, Aug 15 after 2026-08-15T00:00:00Z), not a fixed "Aug 15" window. The
artifact sequence is day-driven, not calendar-fixed.

### 3. Backend scheduler availability

The APScheduler job (`p3_execution_loop`, interval = `scheduler_p3_interval_hours`
= 48h, enabled by default) lives in the Python backend (`backend/scheduler.py`),
started via `run.py`/FastAPI. In this sandbox the backend is **not running**
(port 8000 unreachable), so no automatic tick will occur here; artifact #3 will
be produced by the scheduler in production, or by triggering
`POST /api/admin/p3/execute` (P3-15) manually.

### 4. Expected outcome of the next execution (not yet verified)

With P3-16 in place and 2 prior VALID artifacts (Aug 11 + Aug 13), the next
window executes in **NORMAL** rotation phase: `breadthMomentum` becomes mandatory
and is now derivable from the 2 in-range artifacts — the exact purpose of P3-16.
The next artifact is **expected** to persist as VALID, but this is an
expectation, not evidence. The gate must be re-run when it exists.

If the next execution instead returns MISSING / INSUFFICIENT_HISTORY, per the
task we would investigate execution data (inputs, availability states,
provenance) before any Trend work — not modify Trend.

==================================================
STOP CONDITIONS — TRIGGERED
==================================================

| Stop condition | Status |
|---|---|
| Artifact #3 chưa tồn tại | **TRIGGERED** — only 2 artifacts persisted |
| Không đủ 3 VALID artifacts cùng identity | **TRIGGERED** — 2/3 |
| Cần sửa P3 kernel | Not triggered (no kernel change made or needed) |
| Cần thay đổi regime/rotation semantics | Not triggered |
| Cần thay đổi persistence contract | Not triggered |
| Trend threshold chưa thể xác định từ P3-14 | Not evaluated (gate blocked earlier) |

==================================================
PRODUCTION SAFETY AUDIT
==================================================

- **Mutations = 0** — the only database operations performed were read-only
  `SELECT` queries (data gate + scheduler-log audit + loop dry-run).
- **No artifact created, no backfill, no synthetic data.**
- **P3 kernel (P3-04 → P3-09, P3-10 orchestrator) = 0 changes.**
- **P0–P2 = 0 changes.**
- **P3-10 → P3-16 artifacts untouched** (ids 1 and 9 intact).
- Temp gate scripts removed; working tree contains only the pre-existing
  P3-12…P3-16 changes plus this document.

==================================================
WHAT P3-17 WILL IMPLEMENT ONCE THE GATE PASSES (DEFERRED, FROZEN)
==================================================

The Phase A–F plan from the task remains valid and is frozen against the P3-14
spec. No code was written because the gate failed:

- **Phase A** — `src/lib/services/p3-intelligence-history.service.ts`: DB
  artifacts → identity filter → chronological series → current/previous/deltas →
  trend view model. No `src/lib/p3/*` import, no recalculation.
- **Phase B** — identity contract `(narrativeId, window, algorithmKey,
  algorithmVersion, calculationMode)`; deltas for regime/rotation transition,
  rotation score, breadth, momentum, relative strength, leadership change, leader
  score delta, constituent change.
- **Phase C** — Trend semantics IMPROVING / DETERIORATING / STABLE / TRANSITION /
  UNKNOWN, with the PROPOSED epsilons from P3-14 surfaced as documented
  constants. NEUTRAL→NEUTRAL = STABLE; NEUTRAL→WEAKENING = TRANSITION;
  NOT_APPLICABLE = UNKNOWN (never coerced to STABLE).
- **Phase D** — extend `GET /api/narratives/[id]` with `data.p3IntelligenceHistory`
  (safe degrade: no history → null; insufficient → metadata + insufficient-history
  state; service error → null). No new `/api/p3/...` namespace.
- **Phase E** — extend `P3IntelligencePanel` with progressive disclosure
  (Current → Historical Trend → Previous vs Current → transitions). 1 artifact →
  "insufficient history"; 2 artifacts → deltas without "confirmed trend";
  >= 3 artifacts → Trend.
- **Phase F** — required tests (insufficient/delta/trend, mixed identity
  exclusion, ordering, NEUTRAL→NEUTRAL, NOT_APPLICABLE, transitions, deltas,
  leadership, missing stage, service-failure resilience, UI degraded states).

==================================================
FINAL VERDICT
==================================================

**B. DATA INSUFFICIENT — NEED MORE P3 EXECUTIONS**

- Current: 2 VALID artifacts (Aug 11 NEUTRAL/ACCELERATING, Aug 13
  WEAKENING/INFLOW).
- Need: 1 more VALID artifact for the same identity (3 total) to pass the gate.
- Path: the next `p3_execution_loop` tick (backend scheduler, 48h cadence; or a
  manual `POST /api/admin/p3/execute`) targets the then-current UTC day. With
  P3-16 NORMAL rotation, `breadthMomentum` is now derivable from the 2 existing
  artifacts, so the next artifact is expected to be VALID — **verify, don't
  assume**.
- After #3 exists and is VALID, re-run the Phase 0 gate; when it shows >= 3,
  P3-17 Phases A–F can be implemented as specified.

No P3-18 / E-series remediation chain was created. No kernel change. No
production mutation. Task stopped at the mandatory gate, per instructions.
