# P3-15 — Historical Execution Loop & Scheduler

**Status: IMPLEMENTED & VERIFIED — ACCUMULATION BLOCKED BY ROTATION SEMANTIC DEBT (STOP & REPORT)**

P3-10 → P3-14 are CLOSED. P3-14 confirmed the production database holds exactly ONE P3
artifact (AI / 7D / windowEnd 2026-08-11 / VALID / NEUTRAL / ACCELERATING), and the goal of
P3-15 is the infrastructure to let a scheduler accumulate 3–5 artifacts so P3-14's Historical
Intelligence can eventually be implemented.

This task implemented, tested, and production-verified the execution loop and scheduler. It
also surfaced a **P3 rotation semantic deadlock** that blocks the second artifact from ever
being persisted under current (frozen) P3 semantics. Per task constraints ("Không sửa semantics
P3-04 → P3-09", "Không sửa threshold/regime/rotation") the deadlock is **not fixed here** — it
is documented and escalated for a product/semantic decision.

---

## 1. Execution Path Audit (P3-10)

The single authoritative execution path, confirmed by source inspection:

```
backend/execute_p3_authoritative.ts (P3-10E.11 manual script)
  └─ runP3AuthoritativeExecution(config)        src/lib/p3/orchestrator.ts
       ├─ createP3ExecutionContext              src/lib/p3/preparation.ts (membership + sources)
       ├─ loadRegimeScoreConfig / loadRotationScoreConfig
       ├─ P3-04 Breadth          calculateBreadthResult            src/lib/p3/breadth.ts
       ├─ P3-05 Momentum         calculateP3MomentumResult         src/lib/services/momentum.service.ts
       ├─ P3-06 Relative Strength calculateRelativeStrengthResult  src/lib/p3/relative-strength.ts
       ├─ P3-07 Leadership       calculateLeadershipResult         src/lib/p3/leadership.ts
       ├─ P3-08 Regime           calculateRegimeResult             src/lib/p3/regime.ts
       ├─ P3-09 Rotation         calculateRotationResult           src/lib/p3/rotation.ts
       ├─ validateMandatoryStages (persistence gate — ALL stages must be VALID)
       └─ persistP3Calculation   src/lib/p3/persistence.ts (transactional insert)
```

Key audit findings:

| Item | Finding |
|---|---|
| Orchestrator | `runP3AuthoritativeExecution(config)` — the ONLY production execution path. No parallel paths exist. |
| Persistence | `persistP3Calculation` uses `onConflictDoUpdate` on `(narrative_id, window_end, algorithm_key, algorithm_version, calculation_mode)`. On a duplicate it would UPDATE — which the immutability trigger blocks. The loop therefore checks existence **before** execution so the orchestrator is never invoked for a persisted identity. |
| DB identity constraint | `p3_narrative_intelligence_identity_unique` — UNIQUE on the same 5 columns (verified in `pg_constraint`). |
| Immutability | UPDATE/DELETE triggers exist on `p3_narrative_intelligence`, `p3_constituent_snapshots`, `p3_constituent_snapshot_members`, `p3_leadership_members`, `narrative_membership_snapshots` (verified in `information_schema.triggers`). |
| Scheduler infra | `scheduler_logs` table (`job_name`, `status` STARTED/COMPLETED/FAILED, `started_at`, `completed_at`, `duration`, `records_processed`, `error_message`, `details` jsonb). Lock pattern with 15-min stale timeout in `src/app/api/refresh/route.ts`. APScheduler in `backend/scheduler.py` (interval or daily cron, Asia/Ho_Chi_Minh) calls the Next.js API. |
| P3 trigger today | None — P3-10E.11 ran `backend/execute_p3_authoritative.ts` manually for AI only. No scheduler job has ever executed P3 (confirmed in P3-14 audit: `scheduler_logs` contains only `interval_refresh` / `manual_refresh`). |
| Persisted identity | Artifact #1: `algorithm_key=p3-orchestrator`, `algorithm_version=1`, `calculation_mode=observed`, `window_end=2026-08-11T00:00:00.000Z` (verified in DB). |

---

## 2. Implementation — Execution Loop (`src/lib/p3/execution-loop.ts`)

`runP3ExecutionLoop(options)` — a read-only scheduler pass with ZERO calculation logic.
It only decides WHEN the frozen orchestrator runs. P3 calculation modules are never imported
for recalculation; the orchestrator remains the only execution path.

### Identity
Fixed scope per task: `window = "7D"`, `calculation_mode = "observed"`, algorithm identity
`p3-orchestrator / 1`. Full identity = `(narrative_id, window_end, p3-orchestrator, 1, observed)` —
mirrors the DB unique constraint and `calculationIdentity`.

### Eligibility ("chỉ execute khi window mới đủ điều kiện")
- Candidate `windowEnd` = latest completed UTC day boundary at/before `now` (default), or an
  explicit `windowEnd` (bounded, controlled execution).
- A window is eligible only when `windowEnd <= now` (completed). Future windowEnd → `not_eligible`.
- **No backfill**: only the current candidate window is ever evaluated; missed/intermediate
  windows are never created retroactively.
- If the candidate already has an artifact → `skipped_existing`, orchestrator **not** called.

### Idempotency
- Existence check on the full identity **before** execution.
- Defense-in-depth: DB unique constraint + immutability triggers block any concurrent duplicate
  write, and the persistence gate refuses non-VALID results.

### Non-VALID handling ("không retry vô hạn")
- Non-VALID outcomes (INSUFFICIENT_HISTORY, MISSING, NOT_APPLICABLE, …) surface as thrown errors
  from the orchestrator's persistence gate.
- The loop records them as `failed` with the exact availability reason — exactly ONE attempt per
  eligible window per run, no retry loop. If the same window is re-run while still the latest
  (e.g. scheduler restart same day), it is naturally re-attempted once; once a newer boundary
  completes, the old window is never touched again (bounded by construction).

### Failure isolation
Per-narrative try/catch — one narrative's failure never stops the others. All 5 active
narratives are evaluated per pass (or a restricted subset via `narratives`).

### Logging / provenance
Structured per-narrative outcome: `action`, `identity`, `window`, `windowEnd`, `availabilityState`,
`intelligenceId`, `error`, `durationMs`. Persisted to `scheduler_logs` (job `p3_execution_loop`,
STARTED → COMPLETED/FAILED with full `details`) by the trigger route. Dry-runs write nothing.

---

## 3. Implementation — Trigger & Scheduler

### API route (`src/app/api/admin/p3/execute/route.ts`)
- `POST` with optional `{ dryRun, narratives, windowEnd }`.
- **dryRun=true → strictly read-only**: no lock, no scheduler log, no orchestrator call.
- **dryRun=false → authoritative**: acquires the `p3_execution_loop` lock (15-min stale timeout,
  same pattern as `/api/refresh`; concurrent run → 409), writes STARTED → COMPLETED (or FAILED)
  with per-narrative `details`.

### Scheduler (`backend/scheduler.py` + `backend/config.py`)
- New job id `p3_execution_loop` registered on the existing APScheduler instance.
- Cadence: `scheduler_p3_interval_hours` (default **48h** = every 2 days, matching the P3-14 plan
  cadence); `0` → daily right after the main refresh.
- Enabled via `scheduler_p3_enabled` (default True); calls the Next.js endpoint with httpx,
  logs success/failure exactly like the existing refresh job.
- Python syntax verified (`py_compile`).

---

## 4. Tests (`src/lib/p3/__tests__/execution-loop.test.ts` — 9 tests, all PASS)

| Requirement | Test | Result |
|---|---|---|
| first execution | no artifact → orchestrator runs once per narrative, identity correct | ✅ |
| second window | new `window_end` becomes eligible and is executed | ✅ |
| duplicate execution | identity persisted → `skipped_existing`, orchestrator NEVER called | ✅ |
| failed narrative isolation | narrative 1 throws → narrative 2 still executes | ✅ |
| invalid / non-VALID result | `P3InsufficientDataError` → `failed`, exactly ONE attempt, no retry | ✅ |
| scheduler restart / idempotency | loop twice → first persists, second skips, no new orchestrator calls | ✅ |
| no eligible window | future `windowEnd` → `not_eligible`, orchestrator not called | ✅ |
| dry-run | reports `would_execute`, never calls orchestrator | ✅ |
| window default | latest UTC day boundary at/before now | ✅ |

Regression: P3 read service (14) + route resilience (3) + P3 UI panel (14) + loop (9) — all pass.
`npx tsc --noEmit` → 0 errors. `git diff --check` → PASS. Python `py_compile` → OK.

---

## 5. Production Verification (read-only dry-run first)

### 5.1 Dry-run (`dryRun=true`) — strictly read-only
- Verified: current window = **2026-08-14T00:00:00Z** (latest completed UTC boundary).
- AI correctly identified as `would_execute` (existing Aug 11 artifact does not block the new
  window); all 5 active narratives evaluated.
- Post-check: artifact count still **1**, `scheduler_logs` for `p3_execution_loop` still **0**
  → dry-run wrote nothing.

### 5.2 Authoritative execution (dryRun=false, all narratives)
```
AI         → failed — P3-09 Rotation=MISSING (window 2026-08-14)
RWA        → failed — Breadth/Leadership INSUFFICIENT_HISTORY, Regime/Rotation MISSING
TOPMC      → failed — Leadership INSUFFICIENT_HISTORY, Rotation MISSING
FAVORITE   → failed — Leadership INSUFFICIENT_HISTORY, Rotation MISSING
RESTAKING  → failed — Momentum/Regime/Rotation MISSING, Leadership INSUFFICIENT_HISTORY
executed=0  wouldExecute=0  skipped=0  notEligible=0  failed=5
```
- **Correct non-VALID handling**: persistence gate refused every non-VALID result. No artifacts
  created, no mutation, no retry storm. Failure isolation demonstrated (5 independent outcomes).

### 5.3 Idempotency against production
- Re-ran the loop for the **Aug 11 window** (which HAS the VALID artifact), restricted to AI:
  `skipped_existing` — instant, orchestrator never invoked. **No duplicate, no mutation.**
- Post-check: `p3_narrative_intelligence` = exactly 1 row (id 1, VALID, NEUTRAL, ACCELERATING,
  `calculatedAt` 2026-08-13T15:36:15.395Z **unchanged**); 1 constituent snapshot; 3 COMPLETED
  scheduler log entries with full structured details.

### 5.4 Acceptance chain (production evidence)
```
execution → new window (2026-08-14) → orchestrator → non-VALID (Rotation MISSING)
          → gate refused → NO artifact → immutable history untouched
same window re-run (2026-08-11) → skipped_existing → NO duplicate, NO mutation
```

---

## 6. ⚠️ BLOCKER — Rotation first-run bootstrap deadlock (STOP & REPORT)

**The scheduler can never create artifact #2 under current P3 semantics.** Evidence:

1. Artifact #1's persisted rotation provenance:
   ```
   firstRun: true, missingInputs: ["breadthMomentum"],
   weights: { healthMomentum 0.375, relativeStrength 0.25, volumeExpansion 0.1875, oiConfirmation 0.1875 }
   → ACCELERATING (first-run bootstrap path, 4-input renormalized weights)
   ```
2. Rotation contract (`src/lib/p3/rotation.ts`): the first-run bootstrap (allowing
   `breadthMomentum` to be missing) applies **only** when `inputs.firstRun === true`.
3. `prepareRotationInputs` (`src/lib/p3/preparation.ts`): `firstRun = (VALID historical artifacts
   in [windowEnd−8d, windowEnd−1d]).length === 0`, and `breadthMomentum` requires **≥2** VALID
   artifacts in that span.
4. For any second window (e.g. 2026-08-14): artifact #1 (Aug 11) is in span → `firstRun=false`,
   but only 1 artifact exists → `breadthMomentum=null` → `missing=1`, bootstrap **not applicable**
   → **Rotation=MISSING** → persistence gate → **no artifact**.

This is a **deadlock**: creating any artifact requires 2 in-range prior artifacts, but only the
first artifact can ever be created (bootstrap), and no second artifact can bootstrap itself.
The user's plan (Aug 11 → 13 → 15 → 17 → 19) therefore stalls at artifact #1 for AI, and at 0 for
the other narratives (they additionally lack breadth/leadership history — genuine data
insufficiency, consistent with P3-14).

**Decision required (P3 semantics owner):** the frozen rotation contract needs a bounded
extension — e.g. a "second-run bootstrap" allowing `breadthMomentum` to be missing while
`firstRun=false` but historical breadth evidence is thin (1 artifact), or relaxing the
≥2-in-range requirement — before P3-15's scheduler can accumulate the 3–5 artifacts P3-14 needs.
Per task constraints this is **not modified here**.

---

## 7. Production Safety Audit

| Constraint | Result |
|---|---|
| Production mutations | **0** — loop never writes except the orchestrator's own gated persistence; no artifact was created or modified during verification. Only `scheduler_logs` rows were appended by the trigger (intended logging). |
| No fake backfill | ✅ only the current candidate window is ever evaluated |
| No mutation of VALID artifacts | ✅ artifact #1 byte-for-byte unchanged (id, regime, rotation, calculatedAt) |
| No immutability bypass | ✅ immutability triggers + unique constraint intact; duplicate writes impossible |
| No duplicates | ✅ existence check before execution + DB constraint + verified re-run skip |
| P3 kernel (P3-04 → P3-09) | ✅ zero modifications (`git diff` on kernel files empty) |
| Thresholds / regime / rotation contract | ✅ untouched |
| P0–P2 | ✅ untouched |
| Historical Trend UI/API | ✅ not implemented (per scope) |

Files changed (P3-15):
- NEW `src/lib/p3/execution-loop.ts` (loop service)
- NEW `src/app/api/admin/p3/execute/route.ts` (trigger + lock + logging)
- NEW `src/lib/p3/__tests__/execution-loop.test.ts` (9 tests)
- MOD `backend/scheduler.py` (P3 job registered on APScheduler)
- MOD `backend/config.py` (scheduler_p3_* settings)
- NEW `docs/P3_Upgrade/P3_15_HISTORICAL_EXECUTION_LOOP_AND_SCHEDULER.md` (this document)

---

## 8. Acceptance Criteria Assessment

| Criterion | Status |
|---|---|
| P3 execution path audited | ✅ |
| Trigger mechanism identified (no dedicated P3 scheduler existed) | ✅ |
| Scheduler/job implemented, reusing orchestrator (zero copied calculation logic) | ✅ |
| Identity `(narrative, 7D, window_end, p3-orchestrator/1, observed)` enforced | ✅ |
| Only eligible new windows execute | ✅ (verified) |
| Idempotency on unique identity | ✅ (unit + production) |
| No infinite retry on non-VALID | ✅ (single attempt per run, bounded by window advance) |
| Failure isolation across narratives | ✅ (unit + production: 5 independent outcomes) |
| Logging: started / completed / skipped / failed / availability | ✅ (`scheduler_logs` details) |
| Tests: first exec, second window, duplicate, isolation, non-VALID, restart, no eligible window | ✅ 9/9 |
| Dry-run before authoritative execution | ✅ (read-only verified, then 3 controlled runs) |
| P3 semantics / thresholds / regime / rotation unchanged | ✅ |
| Production mutations = 0 (beyond scheduler logging) | ✅ |
| Accumulate 3–5 artifacts via scheduler | ❌ **BLOCKED by rotation first-run bootstrap deadlock (Section 6)** |

---

## 9. Next Steps (decision required — no P3-15E created)

1. **Decision:** extend the rotation bootstrap contract for the second artifact (bounded change,
   would need a P3 semantics owner sign-off) — unlocks the scheduler accumulation path.
2. Once artifacts ≥2 accumulate, re-open P3-14 to implement Historical Intelligence
   (Current vs Previous → Delta → Direction → Trend) with the P3-14 spec contracts.
3. Scheduler config remains live (`scheduler_p3_enabled=True`, 48h cadence); until the deadlock
   is resolved each pass will log non-VALID outcomes safely without mutating history.
