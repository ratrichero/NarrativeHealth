# P3-17 Artifact #3 — Execution

```
TASK
P3-17 Artifact #3 — Execute the existing P3-15 execution loop once for the current eligible window

STATUS
PASS — Artifact #3 CREATED AND VALID (id=10)
       → P3-17 DATA GATE NOW PASSES (3 VALID artifacts, same identity)

DOCUMENT
docs/P3_Upgrade/P3_17_ARTIFACT_3_EXECUTION.md

VERDICT
P3-17 DATA GATE → PASS
(No Trend implementation performed — out of scope per task instructions.)
```

==================================================
TARGET
==================================================

| Attribute | Value |
|---|---|
| Narrative | AI (narrativeId=1) |
| Window | 7D |
| Identity | `p3-orchestrator` / version `1` / `observed` |
| Window | Current eligible UTC window |
| Path | Existing `POST /api/admin/p3/execute` → `runP3ExecutionLoop` (P3-15, unchanged) |

Execution time (UTC): **2026-08-15T08:49** — current eligible window per loop
semantics (`windowEnd = utcDayStart(now)`):

```
windowEnd = 2026-08-15T00:00:00.000Z
periodStart = 2026-08-07T00:00:00.000Z
periodEnd   = 2026-08-15T00:00:00.000Z
```

==================================================
STEP 1 — DRY-RUN (read-only)
==================================================

Request: `POST /api/admin/p3/execute` `{ dryRun: true, narratives: [1] }`

```
{
  "success": true,
  "data": {
    "dryRun": true,
    "window": "7D",
    "windowEnd": "2026-08-15T00:00:00.000Z",
    "calculationMode": "observed",
    "now": "2026-08-15T08:48:54.690Z",
    "outcomes": [{
      "narrativeId": 1,
      "narrativeName": "AI",
      "windowEnd": "2026-08-15T00:00:00.000Z",
      "identity": "1|2026-08-15T00:00:00.000Z|p3-orchestrator|1|observed",
      "action": "would_execute",
      "durationMs": 212
    }],
    "executed": 0, "wouldExecute": 1, "skipped": 0, "notEligible": 0, "failed": 0
  }
}
```

**No-mutation confirmation** (pre/post DB check):

```
Before dry-run:  ARTIFACT_COUNT=2  P3_LOGS=3
After dry-run:   ARTIFACT_COUNT=2  P3_LOGS=3   → strictly read-only, no scheduler log, no artifact
```

The dry-run path performs eligibility SELECT only — no lock, no scheduler log,
no orchestrator invocation, no writes.

==================================================
STEP 2 — AUTHORITATIVE EXECUTION
==================================================

Request: `POST /api/admin/p3/execute` `{ dryRun: false, narratives: [1] }`

```
{
  "success": true,
  "data": {
    "dryRun": false,
    "window": "7D",
    "windowEnd": "2026-08-15T00:00:00.000Z",
    "calculationMode": "observed",
    "outcomes": [{
      "narrativeId": 1,
      "narrativeName": "AI",
      "windowEnd": "2026-08-15T00:00:00.000Z",
      "identity": "1|2026-08-15T00:00:00.000Z|p3-orchestrator|1|observed",
      "action": "executed",
      "availabilityState": "VALID",
      "intelligenceId": 10,
      "inserted": true,
      "durationMs": 6635
    }],
    "executed": 1, "wouldExecute": 0, "skipped": 0, "notEligible": 0, "failed": 0
  }
}
```

Scheduler log (provenance of the run):

```
LOG id=180 status=COMPLETED
    startedAt=2026-08-15T08:49:18.822Z completedAt=2026-08-15T08:49:25.850Z duration=8s
    executed=1 skipped=0 failed=0
    outcome: action=executed inserted=true intelligenceId=10 availabilityState=VALID
```

The existing P3-15 loop ran the orchestrator through the normal persistence gate
(`persistP3Calculation`). No manual INSERT. No bypass.

==================================================
STEP 3 — VERIFICATION
==================================================

### 3.1 Artifact #1 unchanged

```
id=1 windowEnd=2026-08-11T00:00:00Z VALID
     regime=NEUTRAL rotation=ACCELERATING rotationScore=75.192711
     breadth=0.142857 momentum7d=14.030000 relStr7d=-0.011188 acceleration=4.980000
     leaderCoinId=10 leaderScore=89.290000
     calculatedAt=2026-08-13T15:36:15.395Z persistedAt=2026-08-10T16:50:43.201Z
```

Identical to the pre-execution record (P3-16) — **untouched**.

### 3.2 Artifact #2 unchanged

```
id=9 windowEnd=2026-08-13T00:00:00Z VALID
     regime=WEAKENING rotation=INFLOW rotationScore=61.190795
     breadth=0.142857 momentum7d=-0.984287 relStr7d=0.047994 acceleration=-2.550000
     leaderCoinId=22 leaderScore=61.349426
     calculatedAt=2026-08-14T06:28:03.938Z persistedAt=2026-08-14T06:28:08.895Z
```

Identical to the pre-execution record (P3-16) — **untouched**.

### 3.3 Exactly one new artifact for the new window — VALID

```
id=10 windowEnd=2026-08-15T00:00:00Z VALID        ← NEW (the only artifact for this window)
     regime=WEAKENING rotation=STABLE rotationScore=49.892445
     breadth=0.000000 momentum7d=-2.402857 relStr7d=0.040372 acceleration=-5.404288
     leaderCoinId=12 leaderScore=55.984621
     calculatedAt=2026-08-15T08:49:20.927Z persistedAt=2026-08-15T08:49:24.842Z
```

### 3.4 No duplicate identity

- Unique constraint `p3_narrative_intelligence_identity_unique`
  (`narrative_id, window_end, algorithm_key, algorithm_version, calculation_mode`)
  — a second insert for the same identity is impossible.
- **Idempotency re-run** (same window, same loop): returned `skipped_existing`,
  `executed=0` — the loop checks for an existing artifact *before* invoking the
  orchestrator, so no re-execution, no duplicate, no mutation.

```
re-run: action=skipped_existing  executed=0  skipped=1  failed=0
```

### 3.5 All P3 stages status — 6/6 VALID

| Module | Artifact #1 | Artifact #2 | Artifact #3 (id=10) |
|---|---|---|---|
| regime | VALID | VALID | VALID |
| breadth | VALID | VALID | VALID |
| momentum | VALID | VALID | VALID |
| relativeStrength | VALID | VALID | VALID |
| leadership | VALID | VALID | VALID |
| rotation | VALID (missing=[breadthMomentum], FIRST_RUN) | VALID (missing=[breadthMomentum], SECOND_RUN) | **VALID — no missing inputs, NORMAL** |

### 3.6 Rotation running under NORMAL bootstrap phase

Artifact #10 rotation provenance:

```
module: "rotation"
matches: ["STABLE"]
weights: { healthMomentum: 0.3, oiConfirmation: 0.15, breadthMomentum: 0.2,
           volumeExpansion: 0.15, relativeStrength: 0.2 }
(no firstRun, no bootstrapPhase, no missingInputs)
```

The full 5-weight set (including `breadthMomentum: 0.2`) is the **normal
calculation path** — the P3-16 bootstrap paths renormalize weights to the 4
available inputs and record `bootstrapPhase`/`missingInputs`. Their absence
here proves **NORMAL** phase: no bootstrap exception was used on execution #3.

### 3.7 breadthMomentum actually calculated, not fabricated

- `breadth(#3) = 0.000000` vs `breadth(#2) = 0.142857`
  → `breadthChange = -0.142857`
  → `normalizeBreadthMomentum = 50 + (-0.142857 × 50) = 42.857`
- The rotation score `49.892445` was computed with **all 5 components** using the
  full weight set (Section 3.6). If breadthMomentum had been missing, the module
  would have returned the bootstrap path (renormalized 4-input weights +
  `bootstrapPhase=SECOND_RUN` + `missingInputs`), which it did not.
- The value is derived from persisted artifact history (breadth of #2 → #3),
  never fabricated or backfilled.

### 3.8 Constituent snapshot (artifact #3)

```
SNAP id=6 intelligenceId=10 memberCount=7 eligibleCount=3
     membershipSource=authoritative_membership_snapshot
     capturedAt=2026-08-15T08:49:20.927Z
     memberStates: EXCLUDED ×4, ELIGIBLE ×3
```

==================================================
STEP 4 — OUTCOME
==================================================

**Artifact #3 = VALID** (id=10, `2026-08-15`, `p3-orchestrator/1/observed`).

The P3-17 Phase 0 data gate now passes:

```
id=10  2026-08-15  VALID   WEAKENING / STABLE     (49.892445)
id=9   2026-08-13  VALID   WEAKENING / INFLOW     (61.190795)
id=1   2026-08-11  VALID   NEUTRAL   / ACCELERATING (75.192711)

AI VALID artifacts, same identity (narrative_id + 7D + p3-orchestrator/1 + observed): 3  →  GATE PASS
```

Per the task: **STOP after gate pass. No Trend implementation in this task.**
P3-17 Historical Intelligence & Trend remains for a subsequent task, now
unblocked on the data-sufficiency front (2 deltas available: #1→#2, #2→#3).

==================================================
HARD CONSTRAINTS — CONFIRMED
==================================================

| Constraint | Status |
|---|---|
| No P3 kernel modification | ✅ 0 source changes this task (verification only) |
| No threshold changes | ✅ none |
| No semantic changes | ✅ none |
| No modification of artifacts #1/#2 | ✅ byte-identical pre/post (`calculatedAt`/`persistedAt`/values) |
| No manual INSERT | ✅ execution went through the existing loop + persistence gate |
| No fake/backfilled historical artifact | ✅ artifact derived from real market data + persisted history |
| No duplicate identity | ✅ unique constraint + idempotent re-run (`skipped_existing`) |
| No P3-18 | ✅ not created |
| SELECT-only audit scripts | ✅ all verification scripts read-only; removed after use |

==================================================
INFRASTRUCTURE NOTE
==================================================

The preview dev server flapped a few times during verification (known sandbox
issue, also seen in P3-15/P3-16). The authoritative execution itself completed
through the real `POST /api/admin/p3/execute` route. The idempotency re-run used
the identical `runP3ExecutionLoop` function invoked directly against production
(the same code path the route calls) because the dev server was mid-restart.
No infrastructure blocker affected the outcome.

==================================================
DELIVERABLE SUMMARY
==================================================

- Artifact #3 created and VALID: `id=10`, windowEnd `2026-08-15T00:00:00Z`,
  regime `WEAKENING`, rotation `STABLE` (49.89), all 6 stages VALID,
  rotation in **NORMAL** phase, `breadthMomentum` genuinely calculated.
- P3-17 **DATA GATE → PASS** (3 VALID artifacts, same identity).
- Idempotency proven: re-running the same window returns `skipped_existing`
  with zero mutations.
- Next step (separate task): implement P3-17 Historical Intelligence & Trend
  per the frozen P3-14 spec.
