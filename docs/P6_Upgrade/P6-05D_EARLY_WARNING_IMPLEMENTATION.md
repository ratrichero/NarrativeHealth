# P6-05D — Early Warning Engine Implementation

## 1. Executive Summary

P6-05D implements the P6-native Early Warning Engine, consuming P6-03 snapshots and P6-04 regime outputs to generate structured, deduplicated, severity-classified warnings.

**Frozen decisions implemented:**
- PD-05B-01: 7 warning types
- PD-05B-02: 5 severity levels
- PD-05B-03: Multi-factor severity determination
- PD-05B-04: Configurable material thresholds
- PD-05C-01: Occurrence-based warning identity
- PD-05B-10: 4-state lifecycle

**Non-blocking decisions (V1 defaults):**
- PD-05B-05: Quality = metadata only
- PD-05B-06: Freshness = metadata only
- PD-05B-07: Dedup key = (entity_type, entity_id, warning_type, detection_window)
- PD-05B-08: Cooldown = 24h per dedup key
- PD-05B-09: Escalation = new warning + old SUPERSEDED
- PD-05B-11: Full provenance chain
- PD-05B-12: Standalone version tuple
- PD-05B-13: Same model for coins/narratives
- PD-05B-14: Append-only persistence

## 2. Architecture

```
P6-02 Features → P6-03 Snapshots → P6-04 Regimes → P6-05 Warnings
```

P6-05 is a pure information layer. It does NOT:
- Make decisions
- Generate BUY/SELL signals
- Recommend actions
- Invoke P5
- Modify P4

## 3. Module Structure

| Module | Responsibility |
|---|---|
| `types.ts` | Vocabulary, config, identity, version, record types |
| `thresholds.ts` | Per-type threshold evaluation |
| `severity.ts` | Multi-factor severity determination |
| `identity.ts` | Dedup key computation, cooldown, supersession |
| `lifecycle.ts` | State machine (DETECTED/ACTIVE/RESOLVED/SUPERSEDED) |
| `provenance.ts` | Provenance and metadata assembly |
| `engine.ts` | Main warning detection orchestration |
| `persistence.ts` | DB persistence with append-only semantics |
| `index.ts` | Public API re-exports |

## 4. Warning Types (PD-05B-01 — FROZEN)

| Type | Trigger |
|---|---|
| HEALTH_DETERIORATION | health_score delta ≥ 10 points (negative) |
| HEALTH_IMPROVEMENT | health_score delta ≥ 10 points (positive) |
| REGIME_CHANGE | Regime state confirmed transition |
| REGIME_TRANSITION | Entering TRANSITIONING state |
| CONFIDENCE_DETERIORATION | Confidence drop ≥ 20 points |
| DATA_QUALITY_DEGRADATION | Quality metadata degradation (VALID→INVALID/MISSING) |
| FRESHNESS_DEGRADATION | Freshness degradation (FRESH→STALE) |

## 5. Severity Model (PD-05B-02/03 — FROZEN)

```
INFO < LOW < MEDIUM < HIGH < CRITICAL
```

Multi-factor hierarchy:
1. **Health delta** (primary): ≥30=CRITICAL, ≥20+WEAK=HIGH, ≥20=MEDIUM, ≥10+WEAK=MEDIUM, ≥10=LOW, ≥5=INFO
2. **Regime context** (secondary): deterioration to WEAK=HIGH, improvement to STABLE=MEDIUM, etc.
3. **Confidence context** (tertiary): <30=MEDIUM, <50=LOW
4. **Baseline** (context): per-type default

Highest severity wins. Deterministic.

## 6. Thresholds (PD-05B-04 — FROZEN)

| Threshold | Value | Type |
|---|---|---|
| Health delta | ≥ 10 points | Absolute, inclusive |
| Confidence drop | ≥ 20 points | Absolute, inclusive |
| Quality degradation | Any VALID→INVALID/MISSING | Qualitative |
| Freshness degradation | Any FRESH→STALE | Qualitative |

Configurable via `WarningConfig`. Versioned via `parameter_version`.

## 7. Identity & Dedup (PD-05C-01 — FROZEN)

```
identity = (entity_type, entity_id, warning_type, detection_window)
```

- Each detection window = new occurrence
- Same window + same type = deduplicated
- Different window = new occurrence (not deduplicated)

## 8. Lifecycle (PD-05B-10 — FROZEN)

```
DETECTED → ACTIVE → RESOLVED (terminal)
                → SUPERSEDED (terminal)
```

- ESCALATED removed (escalation = new warning + old SUPERSEDED)
- Resolution is terminal (no reopening)
- New occurrence after resolution = new warning record

## 9. Persistence

New `p6_warnings` table with:
- Unique constraint on `dedup_key`
- Append-only (never DELETE, status UPDATE only)
- Full provenance as JSONB
- Version tuple columns
- Lifecycle status for quick queries

## 10. Test Results

| Suite | Tests | Result |
|---|---|---|
| P6 warning (new) | 95 | ✅ PASS |
| P6 full | 627 | ✅ PASS |
| P4 | 129 | ✅ PASS |
| P5 | 273 | ✅ PASS |
| TypeScript | — | ✅ PASS |
| **Total** | **1024** | ✅ PASS |

## 11. Regression

P4/P5 untouched. No P6-01/02/03/04 semantics modified.

## 12. Non-Blocking Findings

None.

## 13. Refresh Integration

P6-05 refresh integration is NOT wired in P6-05D. This is intentional — refresh wiring is a separate task.

## 14. Recommendation

**READY FOR P6-05E (Hardening & Freeze Audit)**

All 6 frozen decisions implemented. 95 tests passing. No regressions.
