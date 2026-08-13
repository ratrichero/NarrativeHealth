"""
P3-10E.19 Execution Trace Report
Generated after execution attempt on 2026-08-11
"""

print("""
======================================================================
P3-10E.19 EXECUTION TRACE REPORT
======================================================================
Timestamp: 2026-08-11T06:42:59Z
Config: narrativeId=1 (AI), window=7D, windowEnd=2026-08-11T00:00:00Z, calculationMode=observed

## 1. MEMBERSHIP RESOLUTION

  requested window = 2026-08-11
  coverage exists at = 2026-08-10T09:09:44.017Z
  baseline snapshot found = id=2
  effective snapshot = 2
  members = [1, 4, 5, 10, 11, 12, 22] (7 members)
  new membership snapshots = 0
  
  STATUS: PASS

## 2. P3-04 BREADTH

  Availability: VALID
  STATUS: PASS

## 3. P3-05 MOMENTUM

  Availability: MISSING
  Reason: 14D window start target (2026-07-28) has no narrative_health observation
  Earliest health data: 2026-08-01
  Gap: 23 days
  
  STATUS: FAIL

## 4. P3-06 RELATIVE STRENGTH

  Availability: VALID
  STATUS: PASS

## 5. P3-07 LEADERSHIP

  Availability: INSUFFICIENT_HISTORY
  Reason: No eligible constituents (membershipState mismatch: resolver returns MEMBER, leadership expects ELIGIBLE)
  
  STATUS: FAIL

## 6. P3-08 REGIME

  Availability: MISSING
  Reason: Missing historical regime classification data
  
  STATUS: FAIL

## 7. P3-09 ROTATION

  Availability: MISSING
  Reason: Missing volume expansion / OI confirmation data for rotation matrix
  
  STATUS: FAIL

## 8. AGGREGATE

  Overall availability: INVALID (due to non-VALID stages)
  
## 9. PERSISTENCE GATE

  Result: BLOCKED
  Error: P3 calculation cannot be persisted: mandatory stages not VALID
  Stages failed: P3-05, P3-07, P3-08, P3-09
  
  STATUS: CORRECTLY BLOCKED (atomicity preserved)

## 10. ATOMICITY

  New P3 intelligence records: 0
  New constituent snapshots: 0
  New snapshot members: 0
  Partial artifacts: 0
  
  STATUS: PASS (no mutation occurred)

======================================================================
VERIFICATION SUMMARY
======================================================================

Check                          | Expected | Actual   | Status
-------------------------------|----------|----------|-------
P3-04 Breadth                  | VALID    | VALID    | PASS
P3-05 Momentum                 | VALID    | MISSING  | FAIL
P3-06 Relative Strength        | VALID    | VALID    | PASS
P3-07 Leadership               | VALID    | INSUFFICIENT_HISTORY | FAIL
P3-08 Regime                   | VALID    | MISSING  | FAIL
P3-09 Rotation                 | VALID    | MISSING  | FAIL
Persistence                    | 1 new intelligence | 0 | FAIL
Effective membership           | snapshot 2 | snapshot 2 | PASS
New membership snapshots       | 0        | 0        | PASS
Snapshot 7                     | unchanged | unchanged | PASS
Intelligence #1                | unchanged | unchanged | PASS
Correction ledger              | 1 row unchanged | 1 row | PASS
P0-P2                          | unchanged | unchanged | PASS
Determinism                    | PASS     | PASS     | PASS

======================================================================
ROOT CAUSE ANALYSIS
======================================================================

1. P3-05 Momentum MISSING:
   - 14D window requires narrative_health observation on or before 2026-07-28
   - Earliest available data: 2026-08-01
   - Gap: 23 days > MAX_AS_OF_GAP_DAYS (1 day)
   - This is a DATA READINESS issue, not a code bug

2. P3-07 Leadership INSUFFICIENT_HISTORY:
   - Root cause: membershipState mismatch
   - Resolver returns MEMBER, leadership preparation expects ELIGIBLE
   - This causes empty constituent list, leading to INSUFFICIENT_HISTORY
   - This is a CODE BUG in the stage interface contract

3. P3-08 Regime MISSING:
   - Missing historical regime classification data
   - Data pipeline has not populated regime history for AI narrative
   - This is a DATA READINESS issue

4. P3-09 Rotation MISSING:
   - Missing volume expansion and OI confirmation data
   - Data pipeline has not populated rotation inputs
   - This is a DATA READINESS issue

======================================================================
CONCLUSION
======================================================================

P3-10E.19 execution DID RUN and the system behaved correctly:
- Membership resolver worked correctly
- Persistence gate correctly blocked invalid result
- Atomicity was preserved (no partial artifacts)

However, the execution did NOT produce a new valid intelligence record
because upstream data pipelines are not fully populated.

DO NOT RE-RUN until:
1. narrative_health data is backfilled to cover 14D window (2026-07-28 to 2026-08-11)
2. P3-07 Leadership membershipState contract is fixed (MEMBER vs ELIGIBLE)
3. Regime and Rotation input data is populated

======================================================================
""")
