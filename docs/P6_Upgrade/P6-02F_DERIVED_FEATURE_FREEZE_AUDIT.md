# P6-02F — Derived Feature Freeze Audit

**Date:** 2026-08-26
**Task Type:** AUDIT ONLY — no implementation, no semantic changes, no contract modifications
**Scope:** Cumulative audit of P6-02B → P6-02C → P6-02C1 → P6-02C2 → P6-02D → P6-02E
**Authority:** All frozen P6-01 contracts, P6-02B/C/C1/C2/D/E implementations

---

## 1. Executive Summary

P6-02 establishes the Derived Feature layer — the bridge between P6 canonical observations and the intelligence/scoring pipeline consumed by P4/P5. This audit verifies that the complete P6-02B→E implementation is internally coherent, invariant-safe, regression-safe, and ready for Planner freeze.

**Audit Verdict:** `READY FOR PLANNER FREEZE`

| Finding Class | Count |
|---|---|
| Class A — BLOCKING | 0 |
| Class B — CONTRACT VIOLATION | 0 |
| Class C — NON-BLOCKING | 2 |
| Class D — DEFERRED | 5 |

---

## 2. Scope

| Task | Commit | What It Established |
|---|---|---|
| P6-02B | `17b6beb` | Derived Feature identity, input contract, quality gating, freshness interaction, provenance, versioning, V1 vocabulary, health dimensions, invariants DF-01…DF-16 |
| P6-02C | `2b536b6` | Aggregation contract: 4-layer pipeline, state propagation matrix, mixed-state handling, deterministic aggregation, version/provenance propagation |
| P6-02C1 | `2bb8e44` | Decision inventory: 14 decisions, 3 blocking (PD-4, PD-7, PD-1/PD-C4) |
| P6-02C2 | `4b7f6f3` | Planner Decision Contract: exact resolutions for PD-4, PD-7, PD-1/PD-C4 |
| P6-02D | `7bd69dc` | P6-native feature engine implementation: types, engine, confidence, provenance, 41 tests |
| P6-02E | `8c04cab` | Persistence layer: schema additive columns, persistence service, 21 tests |

---

## 3. Feature Identity Audit (DF-01)

### 3.1 Contract Definition (P6-02B §3.1)

```
FeatureIdentity = (entity_id, feature_name, timeframe, calc_window, algorithm_version, calculated_at)
```

### 3.2 Physical Persistence

The `features` table uses:

```
Primary key: id (serial)
Unique constraint: (coinId, date, versionId)
Additive P6: p6_version_id (FK → p6_feature_versions)
```

### 3.3 Identity Mapping Analysis

| Contract Field | Physical Column | Mapping | Status |
|---|---|---|---|
| `entity_id` | `coinId` | Direct 1:1 | ✅ COMPATIBLE |
| `feature_name` | Implied by row (one row per coin/date/version contains all 6 features) | **NOT a column** | ⚠️ FINDING C-1 |
| `timeframe` | NOT persisted in features table | **Missing from identity** | ⚠️ FINDING C-2 |
| `calc_window` | NOT persisted in features table | Stored only in `p6_provenance` JSONB | ⚠️ FINDING C-2 |
| `algorithm_version` | `p6_version_id` → `p6_feature_versions.algorithm_version` | Indirect via FK | ✅ COMPATIBLE |
| `calculated_at` | `calculatedAt` column | Direct 1:1 | ✅ COMPATIBLE |

### 3.4 FINDING C-1 — Feature Name Not in Physical Key

**Classification:** CLASS-C — NON-BLOCKING

The contract defines feature identity as per-feature, but the physical table stores all 6 features in a single row per `(coinId, date, versionId)`. This means:

- The physical row identity is `(coinId, date, versionId)` — a **composite record** containing all features
- The contract identity `(entity_id, feature_name, ...)` is a **logical projection** within that record
- There is no collision risk because the row contains exactly the 6 V1 features — no per-feature rows exist
- A future change to per-feature storage would require schema migration

**Impact:** None for V1. The 6-feature-per-row design is consistent with existing P4/P5 consumers and the `features` table contract.

### 3.5 FINDING C-2 — Timeframe Not in Physical Key

**Classification:** CLASS-C — NON-BLOCKING

The contract requires `timeframe` as part of feature identity. The physical `features` table does not have a `timeframe` column. Currently:

- P6-02D engine accepts `timeframe` in `P6FeatureInput` and passes it through to provenance
- The timeframe is recorded in `p6_provenance.input_window` (e.g., "50 DAILY observations from BINANCE_SPOT")
- The legacy features table has no timeframe column — features are always computed from the latest available data

**Impact:** If timeframe-specific features are needed in the future (e.g., DAILY vs 4H features for the same coin on the same date), a schema change would be required. For V1, this is acceptable because the production system computes features from a single canonical timeframe per refresh cycle.

### 3.6 DF-01 Verdict

DF-01 is **functionally satisfied** for V1 scope. The identity gap between contract-level and physical-level is documented and non-blocking. No collision risk exists.

---

## 4. Version Integrity Audit (PD-4)

### 4.1 Implementation

| Component | Status |
|---|---|
| `p6_feature_versions` table | ✅ Exists with 4-tuple unique constraint |
| `p6_version_id` FK on `features` | ✅ Nullable, ON DELETE SET NULL |
| `resolveP6VersionId()` | ✅ Find-or-create on 4-tuple |
| Legacy `versionId` unchanged | ✅ NOT NULL FK to `feature_versions` |
| Legacy `feature_versions` untouched | ✅ No modifications |

### 4.2 4-Tuple Uniqueness

```sql
UNIQUE(algorithm_version, parameter_version, schema_version, config_hash)
```

- Same 4-tuple → same version record → deterministic FK
- Different 4-tuple → different version record → no collision
- `config_hash` provides fine-grained differentiation for parameter changes

### 4.3 Invariant Verification

| ID | Invariant | Status | Evidence |
|---|---|---|---|
| PD4-01 | `p6_feature_versions` is P6-only | ✅ PASS | `feature_versions` untouched in git diff |
| PD4-02 | Version tuple must be unique | ✅ PASS | Unique constraint on 4-tuple in schema |
| PD4-03 | Legacy `versionId` and P6 `p6_version_id` independent | ✅ PASS | Both columns exist, different FK targets |
| PD4-04 | Config hash must be deterministic | ✅ PASS | `V1_VERSION` constant, same input → same hash |

---

## 5. Quality Contract Audit (DF-03, DF-04)

### 5.1 Quality State Vocabulary

Verified frozen set: `VALID | INVALID | MISSING | UNKNOWN`

- No additional states created
- No freshness states mixed into quality
- No auto-correction

### 5.2 Quality Gating Rules

| QualityState | Feature Inclusion | Implementation | Status |
|---|---|---|---|
| VALID | INCLUDED | `isObservationIncluded(qs) === true` | ✅ |
| INVALID | EXCLUDED | `isObservationIncluded(qs) === false` | ✅ |
| MISSING | EXCLUDED | `isObservationIncluded(qs) === false` | ✅ |
| UNKNOWN | INCLUDED | `isObservationIncluded(qs) === true` | ✅ |

**Code evidence:** `src/lib/p6/feature/types.ts` line 56:
```typescript
export function isObservationIncluded(qs: QualityState): boolean {
  return qs === "VALID" || qs === "UNKNOWN";
}
```

### 5.3 Per-Metric Exclusion

INVALID CLOSE does NOT exclude VOLUME — verified by test "INVALID per-metric: INVALID CLOSE does not exclude VOLUME".

### 5.4 Freshness Independence

- Freshness states never converted to quality states ✅
- Confidence formula does not use freshness ✅
- Feature computation does not use freshness ✅
- Quality metadata and freshness metadata assembled independently ✅
- No `collected_at` or `business_date` used as `observed_at` ✅

### 5.5 OI-01…OI-08 Preservation

| OI | State | Implementation | Status |
|---|---|---|---|
| OI-01 | No FR range check | No range validation in `scoreFunding()` | ✅ DEFERRED |
| OI-02 | No temporal tolerance | No tolerance in observation matching | ✅ DEFERRED |
| OI-03 | Detection only | Latest-only semantics preserved | ✅ DEFERRED |
| OI-04 | Cross-source OFF | No cross-source priority | ✅ DEFERRED |
| OI-05 | Latest-only V1 | Persistence uses conflict update | ✅ DEFERRED |
| OI-06 | Untouched | Not in P6-02 scope | ✅ DEFERRED |
| OI-07 | Untouched | Not in P6-02 scope | ✅ DEFERRED |
| OI-08 | Outside D2 | Not in P6-02 scope | ✅ DEFERRED |

---

## 6. Confidence Formula Audit (PD-1/PD-C4)

### 6.1 Formula Verification

Contract (P6-02C2 §5.2):
```
confidence = Σ(weight × available × quality_ratio) / Σ(weight × available)
quality_ratio = VALID_count / total_count
```

Implementation (`src/lib/p6/feature/confidence.ts`):
```typescript
const qualityRatio = totalCount > 0 ? valid / totalCount : 0;
weightedSum += sourceWeight * qualityRatio;
weightSum += sourceWeight;
// ...
confidenceScore = weightSum > 0
  ? Math.max(0, Math.min(100, Math.round((weightedSum / weightSum) * 1000) / 10))
  : NEUTRAL_CONFIDENCE;
```

### 6.2 PD-1/PD-C4 Invariants

| ID | Invariant | Status | Evidence |
|---|---|---|---|
| PD1-01 | Deterministic given same inputs | ✅ PASS | Pure function, no side effects, fixed source order |
| PD1-02 | Incorporates quality_status | ✅ PASS | `valid / totalCount` used in ratio |
| PD1-03 | UNKNOWN not counted as VALID | ✅ PASS | Only `=== "VALID"` counted |
| PD1-04 | Denominator=0 → 0 | ✅ PASS | `NEUTRAL_CONFIDENCE = 0` when weightSum=0 |
| PD1-05 | Confidence in [0, 100] | ✅ PASS | `Math.max(0, Math.min(100, ...))` |
| PD1-06 | Freshness not used | ✅ PASS | No freshness import in confidence.ts |

### 6.3 Rounding

- Confidence: `Math.round(value * 1000) / 10` → 1 decimal place ✅
- Scores: `Math.max(0, Math.min(100, rawScore))` → integer, clamped [0, 100] ✅
- Health: `Math.round((weightedSum / totalWeight) * 100) / 100` → 2 decimal places ✅

### 6.4 Source Processing Order

Fixed array: `["BINANCE_SPOT", "BINANCE_FUTURES", "COINGECKO"]` — deterministic across calls ✅

### 6.5 Test Evidence

- `denominator=0 (no sources available) → confidence=0` ✅
- `all sources available, all VALID → confidence=100` ✅
- `some INVALID → confidence < 100` ✅
- `UNKNOWN quality not counted as VALID` ✅
- `MISSING quality not counted as VALID` ✅
- `rounding to 1 decimal` ✅
- `clamp to [0, 100]` ✅
- `freshness NOT used in confidence formula` ✅

---

## 7. Provenance Audit (DF-05, DF-06)

### 7.1 Minimum Provenance Contract (P6-02B §7.1)

| Required Field | Present in `FeatureProvenance` | Status |
|---|---|---|
| `input_observations[]` | ✅ With entity_id, metric, source, observed_at, timeframe, quality_status, freshness_status | PASS |
| `algorithm_version` | ✅ | PASS |
| `parameter_version` | ✅ | PASS |
| `schema_version` | ✅ | PASS |
| `calculated_at` | ✅ | PASS |
| `input_window` | ✅ | PASS |
| `total_inputs_expected` | ✅ | PASS |
| `total_inputs_used` | ✅ | PASS |
| `excluded_inputs[]` | ✅ With identity + reason | PASS |

### 7.2 Provenance Persistence

- `p6_provenance` JSONB column stores full `FeatureProvenance` ✅
- `p6_quality_metadata` JSONB column stores quality/freshness summary ✅
- Both are additive — legacy `sourceProvenance` untouched ✅

### 7.3 Round-Trip Verification

- Tests verify quality metadata preserves all 4 quality states ✅
- Tests verify freshness independence ✅
- Tests verify version tuple preservation ✅
- Tests verify excluded inputs preserved ✅

---

## 8. Backward Compatibility Audit (DF-11, DF-12)

### 8.1 Legacy Engine

- `src/lib/features/engine.ts` — **NOT modified** (git diff shows zero changes) ✅
- `src/lib/features/calculator.ts` — **NOT modified** ✅
- All legacy feature functions remain importable and callable ✅

### 8.2 P4/P5 Consumers

- `src/lib/p4/` — **NOT modified** ✅
- `src/lib/p5/` — **NOT modified** ✅
- Existing `features` table columns (trendScore, volumeScore, etc.) remain present and populated ✅
- P6 engine output is column-compatible with P4/P5 consumers ✅

### 8.3 Legacy Rows

- Existing feature rows without P6 columns remain valid (P6 columns are nullable) ✅
- `p6VersionId` defaults to null for legacy rows ✅
- `p6Provenance` and `p6QualityMetadata` default to null for legacy rows ✅

### 8.4 Schema Additive-Only

| Change | Type | Backward-Compatible |
|---|---|---|
| `p6_version_id` INTEGER FK | Additive, nullable | ✅ YES |
| `p6_provenance` JSONB | Additive, nullable | ✅ YES |
| `p6_quality_metadata` JSONB | Additive, nullable | ✅ YES |
| `p6_feature_versions` table | New table | ✅ YES (no existing code depends on it) |

No columns removed, renamed, or had semantics changed.

---

## 9. Determinism / Idempotency Audit (DF-13)

### 9.1 Engine Determinism

| Property | Status | Evidence |
|---|---|---|
| Same inputs → same output | ✅ PASS | Test: "same inputs produce same output" |
| Different inputs → different output | ✅ PASS | Test: "different inputs produce different output" |
| Version is deterministic | ✅ PASS | `V1_VERSION` constant, test: "version is deterministic" |
| Provenance `calculated_at` differs between runs | Expected | Wall-clock time; not part of output determinism |

### 9.2 Persistence Idempotency

- Upsert uses `(coinId, date, versionId)` conflict key — repeated writes update same row ✅
- Latest-only semantics preserved per P6-02B §3.4 ✅
- Different `(coinId, date, versionId)` → separate rows, no collision ✅

### 9.3 Version Differentiation

| Scenario | Result | Status |
|---|---|---|
| Same version, same inputs | Same output, same DB row | ✅ IDEMPOTENT |
| Different `algorithm_version` | Different `p6_feature_versions` row, different `p6_version_id` | ✅ SEPARATED |
| Different `config_hash` | Different `p6_feature_versions` row, different `p6_version_id` | ✅ SEPARATED |
| Different `legacyVersionId` | Different DB row (unique constraint) | ✅ SEPARATED |

---

## 10. Schema / Migration Audit

### 10.1 Schema Consistency

| Table | Columns | FK | Unique | Index | Status |
|---|---|---|---|---|---|
| `features` | +3 additive | `p6_version_id` → `p6_feature_versions` | Existing `(coinId, date, versionId)` unchanged | Existing `coinDateIdx` unchanged | ✅ |
| `p6_feature_versions` | 4-tuple + metadata | None | `(algorithmVersion, parameterVersion, schemaVersion, configHash)` | None (sufficient for V1) | ✅ |

### 10.2 FK Behavior

- `p6_version_id`: ON DELETE SET NULL — safe, no cascade risk ✅
- `versionId`: NOT NULL FK to `featureVersions` — unchanged ✅

### 10.3 Migration Reproducibility

- `p6_feature_versions` created in P6-02D (appended to schema.ts) ✅
- Additive columns added in P6-02E (appended to features table definition) ✅
- `drizzle-kit push` or equivalent will produce the schema correctly ✅

---

## 11. Regression Evidence

| Suite | Result | Baseline | Delta |
|---|---|---|---|
| P6 | 9 suites / **338 tests PASS** | 317 (P6-02D) | +21 (P6-02E persistence) |
| P4 | 7 suites / **129 tests PASS** | 129 | 0 |
| P5 | 13 suites / **273 tests PASS** | 273 | 0 |
| TypeScript | **PASS** | PASS | 0 |

Total: **29 suites / 740 tests PASS**

---

## 12. Invariant Summary

### P6-02B Invariants

| ID | Invariant | Status |
|---|---|---|
| DF-01 | Feature identity ≠ observation identity | ✅ PASS (with documented gap C-1, C-2) |
| DF-02 | Every feature input traces to canonical observation | ✅ PASS |
| DF-03 | Quality gating uses frozen QualityState vocabulary | ✅ PASS |
| DF-04 | Freshness not converted to quality | ✅ PASS |
| DF-05 | Legacy sourceProvenance readable by P4/P5 | ✅ PASS |
| DF-06 | Feature traceable to version tuple | ✅ PASS |
| DF-07 | Health decomposable into dimensions | ✅ PASS |
| DF-08 | Health dimensions ≠ observations | ✅ PASS |
| DF-09 | V1 vocabulary frozen (6 features) | ✅ PASS |
| DF-10 | No feature in observation tables | ✅ PASS |
| DF-11 | Schema extendable but not destructive | ✅ PASS |
| DF-12 | No BUY/SELL semantics | ✅ PASS |
| DF-13 | Deterministic output | ✅ PASS |
| DF-14 | No legacy table as semantic source-of-truth | ✅ PASS |
| DF-15 | INVALID ≠ automatic exclusion from all features | ✅ PASS |
| DF-16 | No auto-correction | ✅ PASS |

### P6-02C Aggregation Invariants

| ID | Invariant | Status |
|---|---|---|
| DF-A-01 | Distinct identity per aggregation layer | ✅ PASS |
| DF-A-02 | Strict layer ordering, no feedback loops | ✅ PASS |
| DF-A-03 | Quality and freshness orthogonal | ✅ PASS |
| DF-A-04 | MISSING not replaced with interpolated values | ✅ PASS |
| DF-A-05 | UNKNOWN ≠ INVALID | ✅ PASS |
| DF-A-06 | INVALID exclusion per-metric | ✅ PASS |

### P6-02C2 Invariants

| ID | Invariant | Status |
|---|---|---|
| PD4-01…04 | Version integrity | ✅ ALL PASS |
| PD7-01…04 | Pipeline boundary | ✅ ALL PASS |
| PD1-01…06 | Confidence formula | ✅ ALL PASS |

---

## 13. Findings

### Class C — NON-BLOCKING

| ID | Finding | Impact | Recommendation |
|---|---|---|---|
| C-1 | Feature name not a physical column — all 6 features stored in single row per `(coinId, date, versionId)` | No collision risk in V1; per-feature granularity would require schema change | Document for P6-03 awareness |
| C-2 | Timeframe not in physical key — stored only in `p6_provenance.input_window` | If multi-timeframe features needed per coin/date, schema change required | Document for P6-03 awareness |

### Class D — DEFERRED

| ID | Item | Status | Next Action |
|---|---|---|---|
| D-1 | OI-01: Funding Rate range | Deferred per P6-02B | P6-04+ when needed |
| D-2 | OI-02: Temporal tolerance | Deferred per P6-02B | P6-04+ when needed |
| D-3 | STALE weight multiplier (PD-3/PD-6) | Default 1.0 (no weighting) | P6-02E+ |
| D-4 | Source priority (PD-6b) | Default none | P6-02E+ |
| D-5 | Narrative health method (PD-C3) | Default market-cap weighted | P6-03 |

---

## 14. Blocking Issues

**NONE.**

---

## 15. P4/P5 Boundary Verification

| Check | Status |
|---|---|
| No P3 modifications | ✅ CONFIRMED |
| No P4 modifications | ✅ CONFIRMED |
| No P5 modifications | ✅ CONFIRMED |
| No BUY/SELL semantics introduced | ✅ CONFIRMED |
| No execution/position sizing | ✅ CONFIRMED |
| No risk management policy | ✅ CONFIRMED |
| P4/P5 regression green | ✅ 129 + 273 = 402 tests PASS |

---

## 16. Git Boundary Verification

| Check | Status |
|---|---|
| P6-02 docs only (B/C/C1/C2) | ✅ |
| P6-02D implementation (engine/types/confidence/provenance/tests) | ✅ |
| P6-02E implementation (persistence/schema/tests) | ✅ |
| No frozen P6-01 contract changes | ✅ |
| No P3/P4/P5 changes | ✅ |
| No generated artifacts | ✅ |
| Working tree clean | ✅ |

---

## 17. Recommendation

```
READY FOR PLANNER FREEZE
```

All P6-02B→E invariants are satisfied. No Class-A or Class-B findings. Two Class-C non-blocking findings documented. Five Class-D deferred items properly preserved. Regression green across all suites. The P6-02 derived feature layer is internally coherent and ready for Planner freeze decision.

---

## 18. Acceptance Checklist

- [x] DF-01: Feature identity defined and distinguished from observation identity
- [x] DF-02: Every feature input traces to canonical observation
- [x] DF-03: Quality gating uses frozen QualityState vocabulary
- [x] DF-04: Freshness independent from quality
- [x] DF-05: Legacy sourceProvenance readable by P4/P5
- [x] DF-06: Version tuple traceability
- [x] DF-07: Health decomposable into dimensions
- [x] DF-08: Health dimensions ≠ observations
- [x] DF-09: V1 vocabulary frozen (6 features)
- [x] DF-10: No feature in observation tables
- [x] DF-11: Schema additive-only
- [x] DF-12: No BUY/SELL semantics
- [x] DF-13: Deterministic output
- [x] DF-14: No legacy table as semantic source-of-truth
- [x] DF-15: INVALID ≠ automatic exclusion
- [x] DF-16: No auto-correction
- [x] PD-4: Version tuple storage implemented and verified
- [x] PD-7: Pipeline boundary preserved (legacy untouched)
- [x] PD-1/PD-C4: Confidence formula implemented and verified
- [x] OI-01…OI-08: All deferred items preserved
- [x] Regression: 740 tests PASS across P6/P4/P5
- [x] TypeScript: PASS
- [x] Git boundary: clean
