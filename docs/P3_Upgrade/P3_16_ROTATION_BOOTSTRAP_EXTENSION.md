# P3-16 — Bounded Rotation Bootstrap Extension

**Status: PASS — second VALID artifact created via SECOND_RUN bootstrap; NORMAL phase enforced from the third execution onward.**

P3-15 implemented the execution loop + scheduler but documented a **rotation first-run bootstrap
deadlock**: artifact #1 was persisted via `firstRun=true` (breadthMomentum omitted), and the second
window (`firstRun=false`) required all 5 rotation inputs — including `breadthMomentum`, which needs
≥2 in-span VALID artifacts that could never be created. P3-16 is the bounded, explicitly-authorized
semantic extension that breaks the deadlock with **exactly one additional bootstrap window**.

---

## 1. Semantics Change (bounded, per task)

### Bootstrap phases (new, rotation.ts)

| Phase | Persisted VALID artifacts | breadthMomentum | Provenance |
|---|---|---|---|
| `FIRST_RUN` | 0 | may be `null` (existing behavior) | `firstRun: true, bootstrapPhase: "FIRST_RUN", missingInputs: ["breadthMomentum"]` |
| `SECOND_RUN` | exactly 1 | may be `null` (**new**) | `firstRun: false, bootstrapPhase: "SECOND_RUN", missingInputs: ["breadthMomentum"]` |
| `NORMAL` | ≥2 | **mandatory** — no bootstrap exceptions | — (normal calculation) |

- Phase derived by `rotationBootstrapPhase(validArtifactCount)` from the narrative's total persisted
  VALID artifact count (0 / 1 / ≥2).
- In `SECOND_RUN`, only `breadthMomentum` may be missing. **All other mandatory inputs
  (`healthMomentum`, `relativeStrength`, `volumeExpansion`, `oiConfirmation`) remain required** —
  any other missing input → `MISSING`, exactly as before.
- `SECOND_RUN` uses the same renormalized 4-input weights as `FIRST_RUN`
  (0.3/0.2/0.15/0.15 → /0.8): healthMomentum 0.375, relativeStrength 0.25, volumeExpansion 0.1875,
  oiConfirmation 0.1875.
- From the **third** execution onward (`NORMAL`), breadthMomentum is mandatory and no further
  bootstrap exception exists — including a defense-in-depth rule that a stale `SECOND_RUN` flag
  with `NORMAL` phase never bootstraps.

### Files changed

| File | Change |
|---|---|
| `src/lib/p3/rotation.ts` | `P3RotationBootstrapPhase` type, `rotationBootstrapPhase(count)` helper, `RotationInputs.bootstrapPhase`, bootstrap branch extended to `(FIRST_RUN ‖ SECOND_RUN) && missing===1 && breadthMomentumMissing`, provenance gains `bootstrapPhase` |
| `src/lib/p3/preparation.ts` | `PreparedRotationInputs.bootstrapPhase`; `prepareRotationInputs` counts the narrative's persisted VALID artifacts and derives the phase |
| `src/lib/p3/orchestrator.ts` | passes `bootstrapPhase` into `rotationCompleteInputs` (no logic change) |
| `src/lib/p3/__tests__/rotation-bootstrap.test.ts` | new — 16 tests |
| `src/lib/p3/__tests__/execution-loop.test.ts` | +1 scheduler-chain test (P3-16 mapping) |

### Hard constraints respected

- ✅ No new regime; P3-04 → P3-08 untouched (`git diff` on those files empty)
- ✅ No threshold changes (regime/rotation thresholds untouched — same `score_configs`)
- ✅ `breadthMomentum` calculation semantics unchanged (same query, same ≥2-in-span rule)
- ✅ VALID artifact immutability untouched (artifact #1 byte-for-byte unchanged)
- ✅ No fake backfill, no manufactured historical data
- ✅ P3-14 Trend semantics untouched; no Historical Trend UI/API
- ✅ **P3-15 execution loop reused unchanged** (`src/lib/p3/execution-loop.ts` and the API trigger/scheduler were NOT modified in P3-16 — only tests were added)
- ✅ No new scheduler

---

## 2. Tests

`src/lib/p3/__tests__/rotation-bootstrap.test.ts` (16 tests, all PASS):

| Requirement | Coverage |
|---|---|
| Artifact #1 → first-run bootstrap works | FIRST_RUN allows only missing breadthMomentum, provenance `FIRST_RUN` + renormalized weights; FIRST_RUN still fails on other missing inputs |
| Artifact #2 → second-run bootstrap allows only missing breadthMomentum | SECOND_RUN → VALID, provenance `SECOND_RUN`, `firstRun:false`; same 4-input weights (score 68.75 check) |
| Artifact #2 fails if any other of the 4 mandatory inputs missing | per-input loop over healthMomentum/relativeStrength/volumeExpansion/oiConfirmation → MISSING; also 2-missing case |
| Artifact #3 → breadthMomentum mandatory | NORMAL + breadthMomentum null → MISSING |
| Artifact #3 cannot use second-run exception | NORMAL phase with missing breadth → MISSING (defense-in-depth) |
| Existing normal Rotation behavior unchanged | no flags + missing → MISSING; all present → standard weighted score; multi-missing → MISSING |
| Scheduler can produce artifact #2 | chain test: `rotationBootstrapPhase(0→1→2)` drives real `calculateRotation` — #1 FIRST_RUN VALID, #2 SECOND_RUN VALID, #3 NORMAL rejected |
| Re-running artifact #2 is idempotent / no mutation of artifact #1 | loop test: window Aug 11 → #1; window Aug 13 → #2; re-run Aug 13 → `skipped_existing`, orchestrator called exactly twice |

Regression: `rotation.test.ts` — same 6 pre-existing P3-10A normalization failures as baseline
(`normalizeRelativeStrength` contract mismatch, untouched), 67 pass; `orchestrator.test.ts` PASS.
`npx tsc --noEmit` → 0 errors. `git diff --check` → PASS.

---

## 3. Production Verification

Per task: dry-run first, then execute ONLY the next eligible window.

### 3.1 Dry-run (read-only) — window 2026-08-13, AI
```
windowEnd=2026-08-13T00:00:00.000Z  identity=1|2026-08-13T00:00:00.000Z|p3-orchestrator|1|observed
action=would_execute  executed=0
```
Post-check: artifact count still **1** → dry-run wrote nothing.

### 3.2 Authoritative execution (P3-15 loop, unchanged) — window 2026-08-13, AI only
```
action=executed  availabilityState=VALID  intelligenceId=9  inserted=true  durationMs=8477
```
Persisted artifact #2 (verified in DB):
```
id=9  windowEnd=2026-08-13T00:00:00.000Z  state=VALID  regime=WEAKENING  rotation=INFLOW  breadth=0.142857
rotation provenance: firstRun=false  bootstrapPhase="SECOND_RUN"  missingInputs=["breadthMomentum"]
```
Regime changed NEUTRAL → WEAKENING and rotation ACCELERATING → INFLOW — genuine deltas for the
future P3-14 Historical Intelligence work.

### 3.3 Idempotency + immutability
- Re-run of the same window → `skipped_existing`, `executed=0` — no duplicate, orchestrator not re-invoked.
- Artifact #1 (id=1, Aug 11): NEUTRAL / ACCELERATING, `calculatedAt=2026-08-13T15:36:15.395Z`
  **unchanged** — VALID artifact not mutated.

### Acceptance chain (production evidence)
```
Artifact #1  2026-08-11  VALID (NEUTRAL/ACCELERATING)     ← pre-existing, immutable
Artifact #2  2026-08-13  VALID (WEAKENING/INFLOW)          ← SECOND_RUN bootstrap, new
breadthMomentum history now available (2 VALID artifacts)
Artifact #3  (future window) → NORMAL, breadthMomentum mandatory (unit-tested)
```

---

## 4. STOP conditions — not triggered

- ✅ No threshold changes required
- ✅ No regime semantic changes required
- ✅ No modification of VALID historical artifacts
- ✅ breadthMomentum calculated from existing artifacts — no invented data
- ✅ No third-run bootstrap exception required (NORMAL from #3, unit-tested)
- ✅ Problem was exactly the identified second-run deadlock

No P3-17 / E-series remediation created.

---

## 5. Production Safety Audit

| Constraint | Result |
|---|---|
| Production mutations | Exactly ONE new immutable artifact (id=9) + one constituent snapshot/members (via the orchestrator's own gated persistence). No edits, no deletions, no backfill. |
| Immutability | DB triggers + unique constraint intact; artifact #1 untouched |
| Duplicates | none — existence check + verified re-run skip |
| Kernel changes | only rotation bootstrap branch (authorized) + input plumbing; P3-04..08, thresholds, regime, breadthMomentum semantics untouched |

## 6. Next Step

With ≥2 VALID artifacts now persisted, P3-14's Historical Intelligence (Current vs Previous →
Delta → Direction → Trend) becomes implementable. Recommend re-opening P3-14 once the scheduler
accumulates the third artifact.
