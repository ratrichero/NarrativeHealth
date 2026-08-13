# P3-10E.22 — Regime First-Run Bootstrap Remediation

## 1. Original Bootstrap Deadlock

P3-08 Regime requires two historical inputs:

- `breadthChange`
- `relativeStrengthChange`

These are calculated from prior `p3_narrative_intelligence` records. On the first authoritative P3 execution, no prior VALID P3 record exists. The original `classifyRegime()` required all 8 inputs to be valid numbers:

```typescript
const values = [health, healthChange, breadth, breadthChange, momentum, acceleration, relativeStrength, relativeStrengthChange];
if (values.some((value) => !valid(value))) return unavailable(inputs);
```

This created a bootstrap deadlock:

```
No prior VALID P3
    ↓
breadthChange = null, relativeStrengthChange = null
    ↓
classifyRegime returns MISSING
    ↓
Persistence gate blocks record creation
    ↓
No VALID P3 for next run
    ↓
[repeat forever]
```

## 2. Existing P3-08 Historical Dependency

`prepareRegimeInputs()` loads historical P3 data from `p3_narrative_intelligence` within the 7D window ending at `windowEnd`. It calculates:

- `breadthChange = currentBreadth - historicalBreadth7dAgo`
- `relativeStrengthChange = currentRS - historicalRS7dAgo`

If no historical records exist, both remain `null`.

## 3. New First-Run Contract

### Case A — Historical P3 baseline exists

Normal path. `breadthChange` and `relativeStrengthChange` are calculated from prior VALID P3 records. Classification continues unchanged.

### Case B — No historical P3 baseline exists (first-run)

- `breadthChange = null`
- `relativeStrengthChange = null`
- These values remain `null` throughout the pipeline. No normalization converts them to zero.
- `classifyRegime` classifies using only the 6 required current inputs:
  - `health`, `healthChange`, `breadth`, `momentum`, `acceleration`, `relativeStrength`
- The existing regime rules already handle `null` change fields correctly because JavaScript comparisons with `null` evaluate to `false`.
- Provenance explicitly records:
  - `firstRun: true`
  - `historicalP3BaselineAvailable: false`
  - `breadthChange: null`
  - `relativeStrengthChange: null`

### Case C — Historical baseline exists but is unusable

If prior P3 records exist but none are VALID (e.g., `INSUFFICIENT_HISTORY`), `firstRun` is `false`. The full 8-input validation applies, and the result returns the appropriate existing insufficient-data state (`MISSING`). This case is NOT silently treated as first-run.

## 4. Why Null Is Preserved

Fabricating historical values (e.g., `null → 0` or `missing → neutral`) would:

- Inject artificial signals into regime classification
- Create non-reproducible results across runs
- Violate the append-only / immutable artifact contract
- Make the first-run result indistinguishable from a genuine zero-change baseline

Null preserves the semantic distinction between "no historical data" and "zero change from historical data."

## 5. Which Current Inputs Remain Mandatory

On first-run, these 6 inputs must still be valid numbers:

- `health`
- `healthChange`
- `breadth`
- `momentum`
- `acceleration`
- `relativeStrength`

If any of these is `null`, `classifyRegime` returns `MISSING` even on first-run. Only `breadthChange` and `relativeStrengthChange` are permitted to be `null`.

## 6. How Subsequent Runs Behave

When a prior VALID P3 record exists:

- `firstRun` is `false`
- `historicalP3BaselineAvailable` is `true`
- `breadthChange` and `relativeStrengthChange` are calculated normally
- All 8 inputs are validated
- Classification behavior is **identical** to pre-E.22 behavior

## 7. Provenance Semantics

The regime result provenance now includes:

```json
{
  "module": "regime",
  "thresholds": { ... },
  "matched": ["STRONG"],
  "firstRun": true,
  "historicalP3BaselineAvailable": false,
  "breadthChange": null,
  "relativeStrengthChange": null
}
```

This makes first-run semantics observable in persisted results without introducing a new context mechanism.

## 8. Implementation Files

| File | Change |
|---|---|
| `src/lib/p3/regime.ts` | Added `firstRun?: boolean` to `RegimeInputs`; modified `classifyRegime` to conditionally validate inputs; added first-run provenance |
| `src/lib/p3/preparation.ts` | Added `firstRun` detection in `prepareRegimeInputs` (based on `historicalP3Data.length === 0`); added `firstRun` to `PreparedRegimeInputs` |
| `src/lib/p3/__tests__/regime.test.ts` | Added 9 first-run bootstrap tests |

## 9. Tests

### Focused Tests

All 14 regime tests pass:

- 5 original classification tests (unchanged)
- 9 new first-run bootstrap tests:
  1. First-run detection when no prior VALID P3
  2. First-run null semantics preserved
  3. No null-to-zero conversion
  4. First-run classification with valid current inputs produces VALID regime
  5. First-run with missing mandatory current input returns non-VALID
  6. Historical baseline path produces calculated changes
  7. First-run does not read `coin_narratives` for historical comparison
  8. Determinism — identical first-run inputs produce identical output
  9. Subsequent-run behavior unchanged with valid historical baseline

### Full Suite Results

- **Total tests**: 269
- **Passed**: 260
- **Failed**: 9 (all pre-existing, not regressions)

Pre-existing failures:

| File | Failure | Pre-existing |
|---|---|---|
| `membership.test.ts` | `db.select is not a function` mock issue | Yes |
| `rotation.test.ts` | 6 RS-normalization assertion mismatches | Yes (documented in E.21) |
| `preparation.test.ts` | `snapshotId` type mismatch in provenance | Yes |
| `breadth.test.ts` | Missing denominator assertion | Yes (documented in E.21) |

## 10. Regression Verification

```bash
npx tsc --noEmit   # PASS
git diff --check   # PASS (no whitespace errors)
```

## 11. Production Safety Verification

- No production DB writes
- No production orchestrator execution
- No production snapshots created
- No P3 historical artifacts modified
- No P0-P2 rows modified
- No thresholds modified
- No `/api/refresh` modification
- No scheduler execution
- No P3-11 execution

## 12. Acceptance Criteria Checklist

- [x] First-run P3-08 no longer has a historical-P3 bootstrap deadlock
- [x] No fabricated historical values
- [x] `breadthChange = null` on first-run
- [x] `relativeStrengthChange = null` on first-run
- [x] No null → zero conversion
- [x] First-run provenance explicitly identifies missing historical P3 baseline
- [x] Valid current inputs can produce a VALID first-run regime
- [x] Missing mandatory current inputs still produce non-VALID state
- [x] Subsequent-run behavior remains unchanged
- [x] Historical P3 remains authoritative when available
- [x] No `coin_narratives` historical fallback
- [x] Persistence safety gate remains intact
- [x] Determinism verified
- [x] Typecheck PASS
- [x] `git diff --check` PASS
- [x] Focused tests PASS
- [x] Full-suite results documented
- [x] No production mutation
- [x] Documentation created
