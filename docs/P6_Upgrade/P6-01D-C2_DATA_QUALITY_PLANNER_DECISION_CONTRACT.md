# P6-01D-C2 — Data Quality Planner Decision Contract

**Date:** 2026-08-24
**Status:** ⚠️ **DRAFT — PLANNER AUDIT REQUIRED — NOTHING HERE IS FROZEN**
**Task Type:** DECISION CONTRACT DRAFT ONLY — NO IMPLEMENTATION
**Prepared by:** Execution Agent, under Planner authorization to draft (not to freeze)

> **READ THIS FIRST:** Every resolution in this document is a **PROPOSED DECISION** (`PDx-RES`).
> Each is derived strictly from frozen contract constraints (P6-01D-B) and repository evidence
> (P6-01D-A / P6-01D-C1). None takes effect until the Planner audits and freezes this document.
> Until then, all 18 decisions remain **PLANNER DECISION REQUIRED**.

---

## 1. Purpose

Resolve the 18 open Planner Decisions declared in the frozen P6-01D-B Data Quality Contract into a coherent, implementable decision set — as a DRAFT for Planner audit.

## 2. Scope

In scope: proposed resolutions for PD-01…PD-18; conformance check against frozen invariants; V1 rule-value table; implementation-readiness notes.

Out of scope: any production code, schema, migration, API, test, UI, or P4/P5 change.

## 3. Inputs (authoritative)

| Document | Role |
|---|---|
| P6-01B Observation Contract | FROZEN identity/temporal/provenance authority |
| P6-01C Source Registry + Freshness | FROZEN source/freshness authority |
| P4-P5 Handoff | FROZEN boundary authority |
| P6-01D-A Recon | Current-behavior evidence baseline |
| P6-01D-B Contract (+FIX) | FROZEN vocabulary, evidence model, invariants DQ-01…DQ-22a |
| P6-01D-C1 Inventory | Per-decision evidence, options, dependencies, priorities |

## 4. Decision Principles Applied

These principles come from already-FROZEN material only — they are not new semantics:

1. **Minimal V1 first** (C1 blocking set: PD-01, PD-02, PD-12, PD-13, PD-18).
2. **No invented tolerance values** where evidence provides none → prefer deferral over fabrication.
3. **No correction, ever** (DQ-12) — classification only.
4. **Additive-only downstream** (§21–22) — existing signals untouched.
5. **Configuration-carried rules** (DQ-21) — every value lands in declarative config with `quality_config_version`.
6. **Missing ≠ Invalid ≠ Unknown** per frozen §9 semantics.

---

## 5. Group A — Classification Semantics

### PD-01-RES (PROPOSED): Per-metric INVALID matrix

**Decision:** Adopt a **per-metric validation matrix** (option: per-metric matrix). Each canonical metric carries an explicit ordered check list in declarative configuration:

| Metric | V1 checks |
|---|---|
| OPEN | NUMERIC_PARSE, NUMERIC_SIGN(≥0), NUMERIC_RANGE(zero=INVALID) |
| HIGH | NUMERIC_PARSE, NUMERIC_SIGN(≥0), NUMERIC_RANGE(zero=INVALID) |
| LOW | NUMERIC_PARSE, NUMERIC_SIGN(≥0), NUMERIC_RANGE(zero=INVALID) |
| CLOSE | NUMERIC_PARSE, NUMERIC_SIGN(≥0), NUMERIC_RANGE(zero=INVALID) |
| VOLUME | NUMERIC_PARSE, NUMERIC_SIGN(≥0), zero=VALID |
| QUOTE_VOLUME | NUMERIC_PARSE, NUMERIC_SIGN(≥0), zero=VALID |
| MARKET_CAP | NUMERIC_PARSE, NUMERIC_SIGN(≥0), zero=INVALID |
| FDV | NUMERIC_PARSE, NUMERIC_SIGN(≥0), zero=INVALID |
| OPEN_INTEREST | NUMERIC_PARSE, NUMERIC_SIGN(≥0), zero=VALID |
| FUNDING_RATE | NUMERIC_PARSE (finite) only |

**Rationale from evidence:** aligns with the one existing guard (`marketCapToSave > 0`), respects "negative FR is normal" recon fact, and matches C1 option space without inventing absolute bounds.

**Conformance:** DQ-01 ✅ DQ-05 ✅ DQ-07a (matrix lives in config) ✅ DQ-21 ✅

### PD-02-RES (PROPOSED): Malformed present value → INVALID

**Decision:** A present-but-unparseable value (NUMERIC_PARSE executes, outcome FAIL) classifies **INVALID**.

**Rationale:** the value existed as evidence; treating it as MISSING would erase the distinction between "source gave nothing" and "source gave garbage" — precisely the distinction the frozen §9 clarification demands. Automatic UNKNOWN was already contract-excluded.

**Conformance:** DQ-07a ✅ (mapping recorded here, to live in config) DQ-10/DQ-11 ✅ (UNKNOWN untouched)

---

## 6. Group B — Numeric Domain Rules

### PD-04-RES (PROPOSED): Negative → INVALID for VOLUME, QUOTE_VOLUME, MARKET_CAP, FDV, OPEN_INTEREST

All five metrics: any negative finite value → `NUMERIC_SIGN` FAIL → INVALID. FUNDING_RATE excluded (negative normal). OHLC covered under PD-01 matrix.

### PD-05-RES (PROPOSED): Zero policy matrix

| Zero = VALID | Zero = INVALID |
|---|---|
| VOLUME, QUOTE_VOLUME, OPEN_INTEREST, FUNDING_RATE | OPEN, HIGH, LOW, CLOSE, MARKET_CAP, FDV |

Rationale: paused/delisted pairs and new contracts legitimately report zero volume/OI/neutral FR (recon §8.5); zero prices/market caps are anomalous.

### PD-06-RES (PROPOSED): FUNDING_RATE — finite-only in V1, range bound DEFERRED

**Decision:** V1 enforces finiteness only. An absolute/percentile range bound remains **PLANNER DECISION REQUIRED** and is recorded in Open Items (OI-01). No bound value is invented.

---

## 7. Group C — OHLC Cross-Observation Validation

### PD-03-RES (PROPOSED): Violation scope = OHLC SET; storage prerequisite resolved by documented approximation

**Decision:** On a relational violation (`HIGH<LOW`, `OPEN` out of range, `CLOSE` out of range), ALL FOUR members of the validation group are classified INVALID (scope = OHLC set). Field-level checks still run independently first.

**Storage prerequisite (resolves EG-02 from C1):** V1 group evaluation operates on the single persisted kline row, using group key `(entity_id = coinId, source, observed_at ≈ business date bucket, timeframe = DAILY)`. This is an explicitly documented APPROXIMATION of the frozen conceptual group key, valid because all four members derive from one kline with one openTime by construction. When observation-level persistence (P6 future task) lands, group evaluation migrates to exact keys. The approximation MUST be recorded in each group-level evidence record via a detail flag.

**Conformance:** DQ-11a ✅ (identity untouched; approximation is evaluation context, not identity) DQ-19 ✅

---

## 8. Group D — Temporal Validation

### PD-07-RES / PD-08-RES (PROPOSED): Temporal checks EXCLUDED from V1 rule set

**Decision:** No future-tolerance or historical-tolerance checks are activated in V1. The check categories are defined but remain **unconfigured**, following the freshness precedent (unconfigured policy → unresolved, never defaulted).

**Rationale:** no authoritative document supplies tolerance values; inventing them violates the standing prohibition (C1 EG-01). Deferral was rated IMPORTANT-BUT-DEFERRABLE in C1 §21.

**Residual:** temporal anomalies go undetected in V1 — accepted, documented risk. Remains PLANNER DECISION REQUIRED (OI-02).

**Conformance:** DQ-13/DQ-14 ✅ (nothing evaluated on absent timestamps)

---

## 9. Group E — Entity Resolution

### PD-09-RES (PROPOSED): Entity-resolution failure → MISSING + dedicated evidence record

**Decision:** When registry coverage requirements are unmet (missing symbol/coingeckoId) or the source rejects the entity, affected fields classify **MISSING**, and a dedicated evidence record with check_id `ENTITY_RESOLUTION_FAIL` (outcome FAIL against the coverage expectation, not against a value) explains WHY.

**Rationale:** absence of value cannot violate a value rule (frozen DQ-08); the dedicated check preserves diagnostic granularity without creating a fifth state (DQ-01 cap).

---

## 10. Group F — Identity / Duplicate / Consistency

### PD-10-RES (PROPOSED): Detect-only duplicate handling in V1

Quality layer reports semantic-identity collisions as evidence; remediation (merge/formalized keep-latest) stays with DB upsert behavior unchanged. Matches frozen DQ-18 default. Remediation policy remains OI-03.

### PD-11-RES (PROPOSED): Cross-source consistency OFF in V1

No Spot-vs-Futures comparator in V1. Read-model merge behavior unchanged. Candidate for a future additive task (OI-04).

---

## 11. Group G — Computation Architecture

### PD-12-RES (PROPOSED): Write-time classification at persistence boundary

**Decision:** Quality classification runs **write-time**, immediately before observation persistence inside the refresh pipeline (normalization-time surface), storing results per PD-13.

**Rationale (from C1 evidence):**
- persistence-time sees the complete formatted payload (strongest evidence completeness);
- read-time would require reconstructing the frozen group/identity keys that current storage lacks (C1 EG-02);
- mirrors the freshness evaluator's consumer-side determinism while keeping collectors unmodified;
- collector files stay untouched (isolation norms preserved).

### PD-13-RES (PROPOSED): Side-table persistence

**Decision:** Classifications persist in an additive side table (conceptually `p6_observation_quality`) keyed by observation reference fields mapping onto P6-01B identity components available at write time, plus `quality_config_version`.

**Rationale:** contract §20.3 forbids modifying existing tables; side table satisfies joinability (§20.2), enables latest-only retention (PD-17) without destructive migration later, and keeps `market_price_daily` / `coin_metrics` byte-identical.

Exact physical schema is deferred to P6-01D-D under this decision's constraints.

---

## 12. Group H — Retention / Versioning

### PD-17-RES (PROPOSED): Latest-only retention in V1

One current classification per observation reference (upsert). Historical replay/version-history NOT implemented (mirrors freshness precedent). History remains OI-05.

---

## 13. Group I — Downstream Interaction / Aggregation

### PD-15-RES (PROPOSED): Aggregation = deterministic worst-case precedence

```text
observation_status =
    INVALID   if ANY field status = INVALID
    else UNKNOWN if ANY field status = UNKNOWN
    else MISSING if ALL field statuses = MISSING
    else VALID     (includes mixed VALID/MISSING sets)
```

Field-level statuses are ALWAYS retained in evidence, so no information is lost by the aggregate. Deterministic, threshold-free, testable.

**Conformance:** DQ-05/DQ-07a ✅ DQ-19 ✅ (field independence preserved; aggregation reads, never mutates)

### PD-14-RES (PROPOSED): Feature engine — ADDITIVE ONLY in V1

Quality data is stored/exposed additively; the feature engine does not gate or weight on it. Gating requires a separate future Planner authorization (OI-06), protecting P4 consumers (`confidenceScore`) per DQ-20.

---

## 14. Group J — Coexistence & Rule Values

### PD-16-RES (PROPOSED): COEXIST

All existing signals keep semantics and ownership unchanged:
- `source_status` remains operational-only;
- `dataCompleteness` / `missingSources` / `confidenceScore` remain feature/health-layer availability metrics;
- quality occupies its own namespace (`p6_*` artifacts), never relabeling or replacing them.

Unification/replacement is future-scope (OI-07).

### PD-18-RES (PROPOSED): Concrete V1 rule values

Complete V1 value table (all derivable from frozen constraints + evidence; none invented beyond binary thresholds already implied by the matrices above):

| Check | Value / Rule | Source of authority |
|---|---|---|
| NUMERIC_PARSE | reject NaN, ±Infinity, non-numeric strings → INVALID | PD-02-RES |
| NUMERIC_SIGN | value ≥ 0 required for OPEN/HIGH/LOW/CLOSE/VOLUME/QUOTE_VOLUME/MARKET_CAP/FDV/OPEN_INTEREST | PD-04-RES |
| NUMERIC_RANGE (zero) | zero=INVALID for prices/MC/FDV; zero=VALID for VOLUME/QUOTE_VOLUME/OI/FR | PD-05-RES |
| FUNDING_RATE | finite only; NO range bound | PD-06-RES |
| OHLC relational | HIGH ≥ LOW; LOW ≤ OPEN ≤ HIGH; LOW ≤ CLOSE ≤ HIGH; violation → all four members INVALID | PD-03-RES |
| ENTITY_RESOLUTION | registry coverage requirement unmet → MISSING + evidence | PD-09-RES |
| TEMPORAL future/historical | UNCONFIGURED in V1 | PD-07/08-RES |
| Duplicate remediation | detect-only | PD-10-RES |
| Cross-source comparator | OFF | PD-11-RES |

Initial version identifier: `quality_config_version = "v1"` (smallest deterministic identifier consistent with the P6-01C-B config-version pattern).

---

## 15. Dependency Order Compliance

Resolutions follow the C1 recommended order: PD-12 → PD-01 → PD-02 → PD-04/05/06 → PD-03 → PD-13 → PD-18 → PD-15 → PD-09 → PD-16 → PD-14 → PD-10/PD-11/PD-17. ✅ All upstream decisions precede their dependents.

## 16. Frozen-Invariant Conformance Summary

| Invariant cluster | Status after draft |
|---|---|
| Vocabulary (DQ-01/02) | ✅ no new states introduced anywhere |
| Independence (DQ-03/04) | ✅ freshness untouched; temporal checks deferred rather than duplicated |
| Evidence (DQ-05/06/07/07a) | ✅ mappings externalized to config; evidence-only outcomes respected |
| Missing/Unknown (DQ-08/09/10/11) | ✅ absence & source failure → MISSING; UNKNOWN reserved; malformed → INVALID per explicit resolution |
| No correction (DQ-12) | ✅ classification only |
| Temporal (DQ-13/14) | ✅ collected_at never substitutes observed_at |
| Identity/provenance (DQ-15/16/17) | ✅ side-table keyed to identity; own version namespace `"v1"` |
| Duplicates/partials (DQ-18/19) | ✅ detect-only; worst-case aggregation reads only |
| Boundaries (DQ-20/21/22) | ✅ no P4/P5 semantics; config-carried rules; PRICE alias respected |

## 17. Residual Open Items (remain PLANNER DECISION REQUIRED)

| ID | Item | Origin |
|---|---|---|
| OI-01 | FUNDING_RATE absolute/percentile range bound | PD-06 deferral |
| OI-02 | Future/historical timestamp tolerances | PD-07/08 deferral |
| OI-03 | Duplicate remediation beyond detect-only | PD-10 deferral |
| OI-04 | Cross-source consistency comparator activation | PD-11 deferral |
| OI-05 | Classification history/replay retention | PD-17 deferral |
| OI-06 | Feature-engine gating / quality-weighted confidence | PD-14 deferral |
| OI-07 | Unification with dataCompleteness/confidenceScore/source_status | PD-16 coexist choice revisit |

## 18. Implementation Readiness (upon freeze)

If the Planner freezes this draft, P6-01D-D may proceed with:

1. Additive side-table migration (per PD-13-RES);
2. Pure validator module implementing the PD-18-RES check table;
3. Write-time classification hook at the refresh-pipeline persistence boundary (PD-12-RES), collectors untouched;
4. Side-table query service exposing classifications keyed to identity (additive API exposure later);
5. Unit tests covering: parse failures, sign violations, zero policies per metric, OHLC group propagation, aggregation precedence, entity-resolution evidence, UNKNOWN propagation, no-correction guarantees, duplicate detection.

Estimated blast radius: new `src/lib/p6/quality/*` module + one migration + refresh-route hook. No changes to collectors, features, health, P4/P5.

## 19. Acceptance Criteria (for this DRAFT)

- [x] All 18 PDs resolved with exactly one PROPOSED decision each
- [x] No option invented outside C1 candidate spaces
- [x] No numeric value fabricated beyond constraint-implied binaries
- [x] Every resolution checked against frozen invariants
- [x] Residual open items explicit (OI-01…OI-07)
- [x] Nothing marked FROZEN by this document
- [ ] Planner audit pending

## 20. Freeze Checklist (to be executed by PLANNER only)

| Gate | Owner |
|---|---|
| Audit each PDx-RES against P6-01D-B invariants | Planner |
| Confirm V1 scope exclusions (temporal, cross-source, gating) acceptable | Planner |
| Freeze document + version identifier `quality_config_version = "v1"` | Planner |
| Authorize P6-01D-D implementation | Planner |

---

**END OF P6-01D-C2 — DRAFT. NOT FROZEN. AWAITING PLANNER AUDIT.**
