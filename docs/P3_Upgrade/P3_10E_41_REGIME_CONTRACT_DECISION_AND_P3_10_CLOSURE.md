# P3-10E.41 — Regime Contract Decision & P3-10 Closure

## Status: STOPPED — Specification Contradiction Remains

**Execution date:** 2026-08-13
**Target window:** 7D ending 2026-08-11T00:00:00Z
**Narrative:** AI (narrativeId = 1)
**Calculation mode:** observed

---

## Executive Summary

P3-10E.41 investigated the regime contract and determined that **DECISION C** applies: the specification is genuinely incomplete/contradictory.

**Per task instructions:** STOP with a definitive blocker report.

---

## Investigation Results

### 1. NOT_APPLICABLE Semantics in Specifications

**From P3_DATA_CONTRACT.md:**

```text
NOT_APPLICABLE: Domain does not apply, such as OI for spot-only coin
Do not penalize as a negative value
```

**Critical finding:** The specification defines NOT_APPLICABLE as a legitimate availability state for scenarios where a domain doesn't apply.

**From P3_DATA_CONTRACT.md (Regime section):**

```text
If zero or multiple configured rules match, the result is not silently guessed;
it is NOT_APPLICABLE or AMBIGUOUS with reasons.
```

**Critical finding:** The specification explicitly requires NOT_APPLICABLE when no regime rule matches.

### 2. Persistence Gate Contract

**From orchestrator.ts (validateMandatoryStages):**

```typescript
/**
 * Validates that all mandatory P3 stages (P3-04 through P3-09) have completed
 * successfully (availabilityState === "VALID") before allowing persistence.
 *
 * This is the authoritative persistence gate: no P3 historical intelligence
 * may be persisted unless ALL mandatory stages are VALID. Any stage reporting
 * MISSING, INSUFFICIENT_HISTORY, INVALID, STALE, AMBIGUOUS, or NOT_APPLICABLE
 * must prevent persistence.
 */
```

**Critical finding:** The persistence gate explicitly lists NOT_APPLICABLE as a blocking state. This is not a bug; it's designed behavior.

### 3. Downstream Consumers of Regime

**From regime.test.ts:**

```typescript
test("returns NOT_APPLICABLE and deterministic reasons when no rule matches", () => {
  const first = classifyRegime(base, thresholds);
  const second = classifyRegime({ ...base }, { ...thresholds });
  expect(first).toEqual(second);
  expect(first.availabilityState).toBe("NOT_APPLICABLE");
});
```

**Critical finding:** The test suite explicitly validates that NOT_APPLICABLE is the correct output when no rule matches. This is designed behavior, not a defect.

### 4. Current Production State Analysis

**Actual production values:**
```text
health            = 46.73  (intermediate: between healthLow=35 and healthHigh=70)
healthChange      = +14.03 (positive, improving)
breadth           = 0.14   (weak: below breadthLow=0.35)
momentum          = 14.03  (positive)
acceleration      = 4.98   (positive)
relativeStrength  = -0.011 (negative)
```

**Why no regime matches:**
- EMERGING: Failed - relativeStrength is negative (below threshold 0.05)
- STRONG: Failed - health too low (46.73 < 70) AND breadth too low (0.14 < 0.6)
- MATURE: Failed - health too low (46.73 < 70) AND breadth too low (0.14 < 0.6)
- WEAKENING: Failed - healthChange is positive (+14.03), not declining
- DEAD: Failed - health too high (46.73 > 35) AND breadth too high (0.14 > 0.35)

**Conclusion:** The production state genuinely doesn't match any of the 5 defined regimes.

---

## DECISION: DECISION C — Specification is Genuinely Incomplete/Contradictory

### Evidence Summary

**Evidence that NOT_APPLICABLE is legitimate:**
1. P3_DATA_CONTRACT.md defines NOT_APPLICABLE as a legitimate availability state
2. Regime specification explicitly requires NOT_APPLICABLE when no rule matches
3. Regime tests validate NOT_APPLICABLE as correct behavior
4. Implementation correctly returns NOT_APPLICABLE for non-matching states

**Evidence that persistence gate requires VALID:**
1. orchestrator.ts explicitly lists NOT_APPLICABLE as a blocking state
2. Gate documentation states NOT_APPLICABLE "must prevent persistence"
3. This is designed behavior, not a bug

**Evidence that specification is incomplete:**
1. Only 5 regimes are defined: EMERGING, STRONG, MATURE, WEAKENING, DEAD
2. No fallback/neutral/transition regime is defined
3. Production narrative state (health=46.73, breadth=0.14, relativeStrength=-0.011) doesn't match any of the 5 regimes
4. Specification doesn't address how to handle narratives that don't match any regime

### The Contradiction

**The specification creates a logical contradiction:**

1. **Regime Classification:** The 5 regimes are intended as exhaustive positive classifications. When no rule matches, NOT_APPLICABLE is the correct, designed behavior.

2. **Persistence Gate:** All mandatory stages must be VALID for persistence. NOT_APPLICABLE is explicitly a blocking state.

3. **Production Reality:** The actual narrative state doesn't match any of the 5 defined regimes, resulting in NOT_APPLICABLE.

4. **Result:** The persistence gate blocks P3 artifact creation for a narrative that is in a real market state, but the specification has no category for it.

**This is not a bug.** Both the regime classification (returning NOT_APPLICABLE) and the persistence gate (blocking NOT_APPLICABLE) are working as designed per the specification.

### Why DECISION A and DECISION B Don't Apply

**DECISION A (Existing regime is clearly applicable):**
- ❌ The production state doesn't match any of the 5 defined regimes
- ❌ No specification evidence suggests this state should map to an existing regime
- ❌ Mapping this state to an existing regime would be arbitrary and violate the specification

**DECISION B (NOT_APPLICABLE is a legitimate supported state):**
- ❌ NOT_APPLICABLE is legitimate for regime classification
- ❌ BUT the persistence gate explicitly blocks NOT_APPLICABLE
- ❌ Modifying the persistence gate to accept NOT_APPLICABLE would be a contract change
- ❌ No specification evidence suggests NOT_APPLICABLE should be allowed at the persistence gate

---

## P3-09 Rotation Secondary Finding

### Rotation Status

**From P3-10E.39:**
```text
Rotation inputs: {"healthMomentum":85.07,"breadthMomentum":null,"relativeStrength":null,"volumeExpansion":7.90,"oiConfirmation":64.29,"firstRun":true}
Rotation availability: MISSING
```

**Issue:** `relativeStrength` is null despite P3-06 being VALID with relativeStrength7d=-0.011.

**Classification:** This is a data wiring defect. The preparation layer is not loading relativeStrength from the current P3-06 result.

**Status:** BLOCKED by the primary regime specification contradiction. Even if fixed, execution would still fail at the persistence gate due to P3-08 Regime=NOT_APPLICABLE.

---

## Required Business Decisions

### Option 1: Add a 6th Regime State

**Action:** Add a new regime (e.g., NEUTRAL, TRANSITION, MIXED) to cover states that don't match the existing 5 regimes.

**Required:**
- Business decision on regime name and semantics
- Update to `docs/P3_Upgrade/p3.md` to define the new regime
- Update `P3_REGIMES` constant in `src/lib/p3/regime.ts`
- Add classification rule for the new regime
- Add regression tests for the new regime
- Fix P3-09 Rotation data wiring
- Execute controlled production execution

**Risk:** Changes the regime semantic model; may break downstream consumers expecting only 5 regimes.

### Option 2: Allow NOT_APPLICABLE at Persistence Gate

**Action:** Modify the persistence gate to accept NOT_APPLICABLE as a valid P3-08 result.

**Required:**
- Business decision on whether NOT_APPLICABLE regime is acceptable for intelligence artifacts
- Update persistence gate contract
- Add regression tests
- Fix P3-09 Rotation data wiring
- Execute controlled production execution

**Risk:** Weakens persistence validation; may create artifacts with incomplete regime classification.

### Option 3: Adjust Thresholds

**Action:** Adjust regime thresholds so that the current production state matches an existing regime.

**Required:**
- Business decision on threshold values
- Update threshold configuration in database
- Verify new thresholds cover production state
- Fix P3-09 Rotation data wiring
- Execute controlled production execution

**Risk:** Changes regime classification semantics for all narratives; may cause unexpected regime changes.

### Option 4: Accept Current Behavior

**Action:** Accept that narratives in this state cannot produce P3 intelligence artifacts until they match one of the 5 defined regimes.

**Required:**
- Document this as expected behavior
- No code changes

**Risk:** Some narratives may never produce P3 intelligence artifacts if they remain in this state.

---

## Current P3-10 Status

### Completed

- P3-03 through P3-09 implementation: COMPLETE
- P3-10A through P3-10E.37 remediation: COMPLETE
- P3-10E.38 infrastructure resolution: COMPLETE
- P3-10E.39 PostgreSQL restoration: COMPLETE
- P3-10E.40 specification investigation: COMPLETE
- P3-10E.41 contract decision: COMPLETE
- Code verification: COMPLETE
- All regression tests: PASS

### Blocked

- **P3-08 Regime:** Specification contradiction - 5 defined regimes don't cover actual production state, and persistence gate blocks NOT_APPLICABLE
- **P3-09 Rotation:** Data wiring defect (secondary, blocked by regime issue)

### P3-10 Status

**BLOCKED by specification contradiction**

---

## Recommendations

### Immediate Action Required

**DO NOT proceed with P3-10 technical implementation.**

The specification contradiction must be resolved through business decision on one of the 4 options above.

### Recommended Path

**Option 1 (Add 6th regime) is recommended** because:
1. It addresses the root cause (incomplete regime classification)
2. It preserves the persistence gate's strict validation
3. It provides explicit semantics for the production state
4. It doesn't weaken existing contracts

However, this requires explicit business approval on:
- Regime name (NEUTRAL, TRANSITION, MIXED, or other)
- Regime definition and classification rules
- Impact on downstream consumers

---

## Conclusion

P3-10E.41 investigated the regime contract and determined that **DECISION C** applies: the specification is genuinely incomplete/contradictory.

**Root cause:** The P3 specification defines exactly 5 regimes (EMERGING, STRONG, MATURE, WEAKENING, DEAD) as exhaustive positive classifications, and requires NOT_APPLICABLE when no rule matches. However, the persistence gate requires all mandatory stages to be VALID and explicitly blocks NOT_APPLICABLE. The actual production narrative state doesn't match any of the 5 defined regimes, creating a logical contradiction that prevents P3 artifact creation.

**Per task instructions:** STOP with a definitive blocker report.

**P3-10 Status:** BLOCKED by specification contradiction

**Required action:** Business decision on regime specification update before proceeding with technical implementation.

---

**P3-10E.41 STOPPED** (specification contradiction confirmed and documented)
