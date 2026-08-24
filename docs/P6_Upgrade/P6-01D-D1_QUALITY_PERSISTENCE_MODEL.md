# P6-01D-D1 Quality Persistence Model

**Date:** 2026-08-25
**Task Type:** PERSISTENCE DESIGN ONLY — NO IMPLEMENTATION
**Frozen Authorities:** P6-01D-B (Contract), P6-01D-C2 (Decisions, frozen at `0fc185a`), P6-01B (Observation Contract), P6-01C (Source Registry + Freshness)

---

## 1. Purpose

Design the implementation-level persistence model for P6 Data Quality V1 — how the frozen P6-01D-B semantic contract and frozen P6-01D-C2 decisions are represented persistently.

This document defines HOW; it does NOT implement the persistence layer.

---

## 2. Authority

| Document | Role | Commit |
|---|---|---|
| P6-01B Observation Contract | FROZEN identity `(entity_id, metric, source, observed_at, timeframe)` | `ad5d7df` |
| P6-01C Source Registry + Freshness | FROZEN sources, freshness FRESH/STALE/UNKNOWN, config versioning | `03b092b` |
| P6-01D-B Contract (+FIX) | FROZEN vocabulary VALID/INVALID/MISSING/UNKNOWN, evidence model, invariants DQ-01…DQ-22a | `a722f02` |
| P6-01D-C2 Decisions | FROZEN for V1 implementation: PD-01…PD-18 resolutions, OI-01…OI-08 deferred | `0fc185a` |
| P6-01D-A Recon | Current-behavior evidence baseline | `5a77e9e` |
| P6-01D-C1 Inventory | Per-decision evidence, dependencies, priorities | `6c2860b` |

---

## 3. Frozen Semantic Inputs

From P6-01D-C2 (frozen):

- **PD-13-RES:** Side-table model (`p6_observation_quality` conceptually).
- **PD-17-RES:** Latest-only retention — one current classification per observation identity (upsert).
- **PD-12-RES:** Write-time classification at persistence boundary in refresh pipeline.
- **PD-01-RES:** Per-metric validation matrix in declarative configuration.
- **PD-02-RES:** Malformed present value → INVALID.
- **PD-03-RES:** OHLC scope = OHLC SET; exact P6-01B group identity; observed_at = UNKNOWN → NOT_EVALUABLE.
- **PD-15-RES:** Aggregation worst-case precedence (with OI-08 mixed-set question exposed).
- **PD-18-RES Part A:** Frozen semantic rule table (12 rows). Part B: Unresolved numerical config (OI-01/OI-02).
- **Quality states:** VALID / INVALID / MISSING / UNKNOWN only.
- **Evidence outcomes:** PASS / FAIL / NOT_APPLICABLE / NOT_EVALUABLE only.
- **Config version:** `quality_config_version = "v1"`.

---

## 4. Persistence Principles

1. **Additive-only:** The side table is created alongside existing tables. No existing table is modified.
2. **Self-contained identity:** The side table stores the full P6-01B semantic identity columns, not merely FK references to observation tables. This is required because existing tables do not persist all identity components (see §5 BLOCKING GAP).
3. **Deterministic upsert:** One current row per semantic identity (PD-17 latest-only). Conflict target = semantic unique constraint.
4. **Configuration-driven:** Every threshold, rule value, and check activation lives in declarative configuration rows, not in code. Follows the P6-01C config-version pattern.
5. **Separate namespace:** `quality_config_version` is independent of P6-01C `config_version`. They never share values or semantics.

---

## 5. Canonical Observation Identity — Current Table Audit

### 5.1 P6-01B Required Identity

```text
(entity_id, metric, source, observed_at, timeframe)
```

### 5.2 What Existing Tables Persist

| Component | `market_price_daily` | `coin_metrics` |
|---|---|---|
| `entity_id` (≈ coinId) | `coin_id` FK ✅ | `coin_id` FK ✅ |
| `metric` | NOT STORED (OHLCV packed into columns: open/high/low/close/volume/quoteVolume) | NOT STORED (openInterest/fundingRate/marketCap/FDV packed) |
| `source` | `source` ✅ | `source` ✅ |
| `observed_at` | NOT STORED (only `date` = business_date) | NOT STORED (only `date` = business_date) |
| `timeframe` | NOT STORED (implicitly daily) | NOT STORED (implicitly snapshot) |

### 5.3 BLOCKING GAP

Two P6-01B identity components are absent from all existing observation tables:

| Missing component | Impact |
|---|---|
| `observed_at` | Side table cannot FK-join to existing rows on observed_at. It must store its own observed_at and join approximately on (coinId, date). |
| `metric` | Side table cannot FK-join to specific metric columns. It must store its own metric name and join approximately on (coinId, date, source). |

**Consequence:** The side table is self-contained with its own identity columns. Cross-table joins to `market_price_daily` / `coin_metrics` use an **approximate join key** `(coinId, date[, source])` — NOT the semantic identity. This approximate join is the best achievable without modifying existing tables.

This is NOT a design flaw — it is the direct consequence of the frozen constraint (§4.4 of P6-01D-B: existing tables unchanged). When observation persistence is upgraded in a future P6 task to include `observed_at` and per-metric storage, the side table's joins can migrate to exact keys.

**No workaround is invented.** The semantic identity is self-declared in the side table; the approximate join is documented as such.

---

## 6. Quality Record Model

Conceptual model (semantic, not physical):

```text
QualityRecord
├── identity
│   ├── entity_id             # integer, references coins.id
│   ├── metric                # varchar, canonical metric name (P6-01B vocabulary)
│   ├── source                # varchar, canonical source_id (P6-01C)
│   ├── observed_at           # timestamptz | NULL (NULL = UNKNOWN, see §9)
│   └── timeframe             # varchar, DAILY / 4H / SOURCE_SNAPSHOT
│
├── classification
│   ├── quality_status        # VALID | INVALID | MISSING | UNKNOWN
│   └── quality_config_version # varchar, e.g. "v1"
│
├── aggregation
│   ├── observation_status    # INVALID | UNKNOWN | MISSING | VALID
│   │                         # (PD-15 worst-case; OI-08 mixed-set branch pending)
│   └── field_count           # integer, total fields evaluated
│
├── provenance
│   ├── quality_evaluated_at  # timestamptz, when classification ran
│   └── collected_at          # timestamptz, source ingestion time (informational only)
│
└── evidence                  # jsonb array of field-level evidence records
```

**Identity semantics:** The identity columns are the canonical P6-01B semantic identity. They are stored as regular columns, not derived from any other table.

**No surrogate PK replaces identity:** A database auto-generated `id` may be used as a convenience primary key, but it is NOT the semantic identity. The semantic identity is the composite of the five identity columns.

---

## 7. Evidence Model

Each quality evaluation produces an ordered list of evidence records, stored as a `jsonb` array within the quality record.

Conceptual evidence record:

```text
FieldEvidence
├── check_id          # varchar, stable rule identifier (e.g. "NUMERIC_PARSE_OPEN")
├── field             # varchar, canonical metric name
├── outcome           # PASS | FAIL | NOT_APPLICABLE | NOT_EVALUABLE
├── detail            # jsonb, optional structured context (value, bound, reason)
```

**Frozen outcome semantics (P6-01D-B §7):**

| Outcome | Meaning |
|---|---|
| PASS | Check ran; value conforms. |
| FAIL | Check ran; check has evidence of a rule violation. |
| NOT_APPLICABLE | Rule does not apply to this metric/context. |
| NOT_EVALUABLE | Check could not run because prerequisite evidence or capability was unavailable. |

**Evidence-as-jsonb rationale:**
- Evidence is always written and read atomically with its parent quality record.
- Evidence is not queried independently at the SQL level in V1.
- A separate evidence table is possible in the future but would introduce join cost without V1 benefit.
- jsonb preserves ordering (JSON array), structure (check_id/outcome), and detail richness.

**Evidence count constraint:** A non-VALID quality status MUST carry at least one evidence entry with outcome FAIL (DQ-05). A MISSING status carries evidence explaining absence (e.g., `ENTITY_RESOLUTION_FAIL`). A UNKNOWN status carries evidence explaining why assessment failed.

---

## 8. State Representation

### VALID

All applicable checks passed. The value conforms to every executed rule.

**Storage:** `quality_status = 'VALID'`, `observation_status = 'VALID'`.

### INVALID

At least one check executed and produced FAIL evidence, AND the applicable PD-01-RES mapping assigns INVALID for that evidence pattern. Requires at least one evidence record with `outcome = 'FAIL'`.

**Storage:** `quality_status = 'INVALID'` (per-field observation) or `observation_status = 'INVALID'` (aggregated).

### MISSING

The expected field has no value because it was never obtained (source omission, API error, entity unmapped). Absence cannot violate a value rule (DQ-08); therefore a field is NEVER INVALID due to absence alone.

**Storage:** `quality_status = 'MISSING'`. Evidence references the cause (e.g., `ENTITY_RESOLUTION_FAIL`, source failure).

### UNKNOWN

Quality cannot be determined because the required assessment evidence or capability is unavailable (validator crashed, prerequisite unresolvable, input structure defeats evaluation). A mere missing value does not produce UNKNOWN (DQ-10). A present-but-malformed value does NOT produce UNKNOWN (PD-02-RES: it produces INVALID).

**Storage:** `quality_status = 'UNKNOWN'`. Evidence explains why assessment failed (e.g., `observed_at = UNKNOWN → OHLC group key unresolvable`).

---

## 9. Timestamp Model

Three distinct timestamps, never confused:

| Timestamp | Meaning | Stored where | Relationship |
|---|---|---|---|
| `observed_at` | Source observation time (when the real-world event occurred) | Side table identity column; NOT in existing tables | The canonical temporal identity of the observation |
| `collected_at` | Source ingestion/collection time (when the system fetched the data) | Approximate: `market_price_daily.created_at` / `coin_metrics.created_at`; side table stores explicit value | Informational provenance; never substitutes observed_at |
| `quality_evaluated_at` | Time the Data Quality evaluation occurred (system time at classification) | Side table `quality_evaluated_at` column | Provenance of the classification; never substitutes observed_at |

**observed_at representation — two states:**

| State | Storage | Meaning |
|---|---|---|
| KNOWN | `observed_at = <timestamptz>` (real timestamp) | Source provided an observation timestamp |
| UNKNOWN | `observed_at = NULL` | Source did not provide an observation timestamp |

**Design decision: NULL for UNKNOWN (no sentinel).**

PostgreSQL NULL is used as the canonical representation of "observation time unknown." This replaces the originally proposed sentinel (`'1970-01-01T00:00:00Z'`), which was rejected on the grounds that a fake timestamp in an identity column creates ambiguity: downstream consumers cannot distinguish "the observation genuinely occurred at 1970-01-01" from "the system doesn't know when it occurred."

NULL correctly represents the P6-01B semantics: `observed_at = UNKNOWN` means the source did not provide an observation timestamp. This is not "absence of a value" in the quality sense (DQ-08 MISSING); it is a specific identity component that is indeterminate.

**Why NULL does NOT create the PostgreSQL-unique-constraint problem:**

PostgreSQL does not consider two NULLs equal in a UNIQUE constraint — two rows with NULL `observed_at` and identical other columns would NOT conflict. This breaks the latest-only upsert guarantee (PD-17-RES) if a single `UNIQUE (entity_id, metric, source, observed_at, timeframe)` constraint were used.

**Solution: partial unique indexes** (see §13). Two separate partial unique indexes replace the single constraint:

1. For KNOWN observations (`observed_at IS NOT NULL`): unique on all five columns.
2. For UNKNOWN observations (`observed_at IS NULL`): unique on four columns (entity_id, metric, source, timeframe).

This correctly ensures:
- At most one UNKNOWN classification per (entity_id, metric, source, timeframe) — latest-only within the UNKNOWN slot.
- At most one KNOWN classification per (entity_id, metric, source, observed_at, timeframe) — latest-only within each KNOWN slot.
- KNOWN and UNKNOWN can coexist for the same (entity_id, metric, source, timeframe) — they are different P6-01B identities because observed_at differs.

**Impact analysis:**

| Aspect | Impact |
|---|---|
| Unique identity | Split into two partial indexes; no sentinel, no fake identity component |
| Latest-only | Works correctly within each slot (KNOWN/UNKNOWN); PD-17-RES satisfied |
| OHLC grouping | When `observed_at IS NULL`, group key `(entity_id, source, NULL, timeframe)` is unresolvable → relational checks NOT_EVALUABLE (PD-03-RES) |
| Querying | `WHERE observed_at IS NULL` selects all UNKNOWN observations; `WHERE observed_at IS NOT NULL` selects all KNOWN — simple, type-safe, no sentinel comparison |
| Indexing | Partial indexes are PostgreSQL-native, efficient, and correctly scoped |
| Approximate cross-table joins | KNOWN rows: join on `oq.observed_at::date = mpd.date`. UNKNOWN rows: cannot join on observed_at (NULL); join falls back to `(entity_id, source, timeframe)` only (fully documented as approximate) |

**Rejected alternatives:**

| Alternative | Why rejected |
|---|---|
| Sentinel `'1970-01-01T00:00:00Z'` | Creates a fake timestamp in an identity column; indistinguishable from a real 1970 observation; undermines semantic integrity |
| `observed_at NOT NULL + observed_at_unknown BOOLEAN` | Requires sentinel to maintain NOT NULL; same fundamental problem |
| JSONB identity | Breaks PostgreSQL index/constraint support; unacceptable performance |
| Separate boolean flag with single UNIQUE including NULL | PostgreSQL NULL semantics break the constraint (two NULLs don't conflict) |

---

## 10. Quality Configuration Version

Every persisted classification carries `quality_config_version` (varchar).

Initial V1 value: `"v1"`.

**Separation from P6-01C:** P6-01C freshness/registry uses `config_version` (integer, per `p6_registry_config_versions`). Quality uses its own `quality_config_version` (varchar, different namespace). They never share values, never alias each other, and never join on version identifier.

**Configuration storage:** V1 rule configurations (check definitions, metric matrices, thresholds from PD-01-RES / PD-18-RES Part A) are stored in a separate configuration table (see §12). Each configuration set carries a version identifier that matches `quality_config_version` on the classification records it produced.

---

## 11. Latest-Only Retention (PD-17-RES)

One current quality classification per semantic identity `(entity_id, metric, source, observed_at, timeframe)`.

**Mechanism:** PostgreSQL `INSERT … ON CONFLICT` targeting the partial unique indexes (§13). Two upsert paths:
- KNOWN (`observed_at IS NOT NULL`): conflict on `(entity_id, metric, source, observed_at, timeframe)`.
- UNKNOWN (`observed_at IS NULL`): conflict on `(entity_id, metric, source, timeframe)`.

The application layer determines which path based on whether `observed_at` is present, then executes the appropriate upsert.

**Rationale:** Matches PD-17-RES (latest-only); enables efficient upsert at write-time (PD-12-RES); avoids accumulating unbounded history.

**Consequence:** Re-evaluation overwrites the previous classification. History is not preserved in V1 (OI-05 deferred).

---

## 12. Proposed Physical Schema

### 12.1 Observation Quality Table

```sql
CREATE TABLE p6_observation_quality (
    -- surrogate convenience key (NOT the semantic identity)
    id                    BIGSERIAL PRIMARY KEY,

    -- P6-01B semantic identity (self-contained)
    entity_id             INTEGER NOT NULL REFERENCES coins(id) ON DELETE CASCADE,
    metric                VARCHAR(50) NOT NULL,
    source                VARCHAR(50) NOT NULL,
    observed_at           TIMESTAMPTZ,                    -- NULL = UNKNOWN (see §9)
    timeframe             VARCHAR(30) NOT NULL,

    -- classification
    quality_status        VARCHAR(20) NOT NULL,     -- VALID | INVALID | MISSING | UNKNOWN
    observation_status    VARCHAR(20) NOT NULL,     -- aggregated: INVALID | UNKNOWN | MISSING | VALID
    quality_config_version VARCHAR(20) NOT NULL,    -- "v1"

    -- evidence (jsonb array of FieldEvidence records)
    evidence              JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- timestamps
    quality_evaluated_at  TIMESTAMPTZ NOT NULL,
    collected_at          TIMESTAMPTZ,              -- informational, nullable

    -- audit
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

);

-- Partial unique indexes for latest-only retention (PD-17, see §13)
-- KNOWN observations: full 5-column identity
CREATE UNIQUE INDEX p6_oq_known_unique
    ON p6_observation_quality (entity_id, metric, source, observed_at, timeframe)
    WHERE observed_at IS NOT NULL;

-- UNKNOWN observations: 4-column identity (observed_at absent)
CREATE UNIQUE INDEX p6_oq_unknown_unique
    ON p6_observation_quality (entity_id, metric, source, timeframe)
    WHERE observed_at IS NULL;
```

### 12.2 Column Reference

| Column | Type | Nullable | Semantic meaning | Constraints |
|---|---|---|---|---|
| `id` | BIGSERIAL | NOT NULL | Surrogate convenience key | PK; never referenced as semantic identity |
| `entity_id` | INTEGER | NOT NULL | Coin entity reference | FK → `coins.id` ON DELETE CASCADE |
| `metric` | VARCHAR(50) | NOT NULL | Canonical metric name from P6-01B vocabulary | CHECK in application: must be one of the 10 canonical metrics |
| `source` | VARCHAR(50) | NOT NULL | Canonical source ID from P6-01C | CHECK in application: BINANCE_SPOT / BINANCE_FUTURES / COINGECKO |
| `observed_at` | TIMESTAMPTZ | NULLABLE | Source observation timestamp. NULL = UNKNOWN (see §9). NOT a sentinel or fake timestamp | NULL when source does not provide observation time |
| `quality_status` | VARCHAR(20) | NOT NULL | Per-field quality classification | CHECK: IN ('VALID','INVALID','MISSING','UNKNOWN') |
| `observation_status` | VARCHAR(20) | NOT NULL | Aggregated observation-level status (PD-15) | CHECK: IN ('VALID','INVALID','MISSING','UNKNOWN') |
| `quality_config_version` | VARCHAR(20) | NOT NULL | Version of the rule set used for classification | FK concept to config table; NOT P6-01C config_version |
| `evidence` | JSONB | NOT NULL (default '[]') | Ordered array of FieldEvidence records | Non-INVALID/non-MISSING records should still carry evidence entries |
| `quality_evaluated_at` | TIMESTAMPTZ | NOT NULL | System time when classification occurred | Never substitutes observed_at |
| `collected_at` | TIMESTAMPTZ | NULLABLE | Approximate source ingestion time | Informational only |
| `created_at` | TIMESTAMPTZ | NOT NULL (default NOW()) | Row creation time | Auto |
| `updated_at` | TIMESTAMPTZ | NOT NULL (default NOW()) | Row last-updated time | Auto (trigger or application) |

### 12.3 Quality Configuration Table

```sql
CREATE TABLE p6_quality_rule_config (
    id                    SERIAL PRIMARY KEY,
    quality_config_version VARCHAR(20) NOT NULL UNIQUE,  -- "v1"
    check_id              VARCHAR(100) NOT NULL,          -- e.g. "NUMERIC_PARSE", "OHLC_HIGH_GE_LOW"
    metric                VARCHAR(50),                    -- NULL = applies to all metrics
    check_type            VARCHAR(30) NOT NULL,           -- NUMERIC_PARSE | NUMERIC_SIGN | NUMERIC_RANGE | OHLC_RELATIONAL | ENTITY_RESOLUTION
    parameters            JSONB NOT NULL DEFAULT '{}'::jsonb, -- rule parameters (sign >= 0, zero policy, etc.)
    is_enabled            BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT p6_quality_rule_config_unique
        UNIQUE (quality_config_version, check_id, metric)
);
```

**Purpose:** Stores the declarative rule definitions that implement PD-01-RES / PD-18-RES Part A. Each row is one check rule. The evaluator reads these rows to determine which checks to apply and how to interpret outcomes.

**Frozen rule metadata (Part A — rows that WILL be seeded):**

These are the frozen PD-18-RES Part A rules. They carry no unresolved numerical values:
- `NUMERIC_PARSE` (all metrics) — binary finiteness check
- `NUMERIC_SIGN` (per metric) — sign ≥ 0 check
- `NUMERIC_RANGE` zero policy (per metric) — zero = VALID or INVALID
- `OHLC_RELATIONAL` — HIGH ≥ LOW, OPEN/CLOSE in range
- `ENTITY_RESOLUTION` — registry coverage check
- Temporal checks — DEFINED but UNCONFIGURED (no rows)
- Duplicate / cross-source — OFF (no rows)

**Unresolved configuration (Part B — rows that MUST NOT exist):**

The following items are explicitly PLANNER DECISION REQUIRED and are NOT materialized as default rows, placeholder entries, or hidden fallbacks:
- OI-01: FUNDING_RATE absolute/percentile range bounds — **no row exists**
- OI-02: Future/historical timestamp tolerances — **no row exists**
- OI-08: Mixed VALID+MISSING aggregation rule — **not in config table** (lives in aggregation logic)

If a row for OI-01 or OI-02 were to be added in the future, it would appear as a standard `p6_quality_rule_config` row with the appropriate `check_type` and `parameters`. The evaluator's behavior for absent rows is: no check is applied for that rule.

**Implementation note for D2:** D2 may initially load frozen Part A rules from code constants for simpler initial implementation. The `p6_quality_rule_config` table remains the production persistence target for configuration-driven evaluation. If D2 loads from code, it must be documented as a D2 implementation choice, not a D1 design change.

### 12.4 Evidence Record Structure (jsonb element)

```json
{
  "check_id": "NUMERIC_PARSE_OPEN",
  "field": "OPEN",
  "outcome": "FAIL",
  "detail": {
    "observed_value": "NaN",
    "reason": "non-numeric input"
  }
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `check_id` | string | YES | Stable identifier matching `p6_quality_rule_config.check_id` |
| `field` | string | YES | Canonical metric name |
| `outcome` | string | YES | PASS / FAIL / NOT_APPLICABLE / NOT_EVALUABLE only |
| `detail` | object | NO | Structured context; MUST NOT embed corrected values (DQ-12) |

---

## 13. Unique Identity Strategy

**Semantic uniqueness — partial unique indexes:**

A single `UNIQUE (entity_id, metric, source, observed_at, timeframe)` constraint is not viable because PostgreSQL does not consider two NULLs equal — two rows with NULL `observed_at` would NOT conflict, breaking the latest-only guarantee.

Instead, two **partial unique indexes** enforce uniqueness:

```sql
-- KNOWN observations: full 5-column identity
CREATE UNIQUE INDEX p6_oq_known_unique
    ON p6_observation_quality (entity_id, metric, source, observed_at, timeframe)
    WHERE observed_at IS NOT NULL;

-- UNKNOWN observations: 4-column identity (observed_at absent)
CREATE UNIQUE INDEX p6_oq_unknown_unique
    ON p6_observation_quality (entity_id, metric, source, timeframe)
    WHERE observed_at IS NULL;
```

This correctly implements PD-17 latest-only retention:
- Within the KNOWN slot: at most one row per (entity_id, metric, source, observed_at, timeframe).
- Within the UNKNOWN slot: at most one row per (entity_id, metric, source, timeframe).
- KNOWN and UNKNOWN can coexist for the same (entity_id, metric, source, timeframe) — they are different P6-01B identities because observed_at differs.

**Surrogate PK (`id`):**
Exists as a convenience for application code and potential future joins. It is explicitly documented as NOT the semantic identity. Application code MUST NOT use `id` for semantic queries.

**Approximate cross-table joins:**

When quality records need to be joined to observation data in existing tables:

```sql
-- To market_price_daily (OHLCV) — KNOWN observations only:
WHERE oq.entity_id = mpd.coin_id
  AND oq.source = mpd.source
  AND oq.timeframe = 'DAILY'
  AND oq.observed_at IS NOT NULL
  AND oq.observed_at::date = mpd.date  -- approximate, documented

-- UNKNOWN observations cannot join on observed_at;
-- fallback: (entity_id, source, timeframe) only (fully documented as approximate)
```

These approximate joins are the best achievable without modifying existing tables. They are documented as approximate in code comments and will migrate to exact keys when observation persistence is upgraded.

---

## 14. Index Strategy

| Index | Columns / Filter | Purpose | Protects invariant |
|---|---|---|---|
| `p6_oq_known_unique` | (entity_id, metric, source, observed_at, timeframe) WHERE observed_at IS NOT NULL | Unique identity for KNOWN observations + upsert conflict target | PQ-01, PQ-09 |
| `p6_oq_unknown_unique` | (entity_id, metric, source, timeframe) WHERE observed_at IS NULL | Unique identity for UNKNOWN observations + upsert conflict target | PQ-01, PQ-09 |
| `p6_oq_status_idx` | (quality_status) | Filter by VALID/INVALID/MISSING/UNKNOWN | Operational convenience |
| `p6_oq_config_idx` | (quality_config_version) | Version-based queries | PQ-07 |
| `p6_oq_evaluated_idx` | (quality_evaluated_at) | Temporal range queries on evaluation time | Audit |
| `p6_oq_approx_join_idx` | (entity_id, source, timeframe, observed_at) | Approximate cross-table joins to existing observation tables | Join performance |

The two partial unique indexes replace a single constraint and enforce latest-only per slot (KNOWN/UNKNOWN). The approximate-join index supports the documented cross-table join pattern.

---

## 15. Foreign-Key Strategy

| FK | From | To | ON DELETE | Justification |
|---|---|---|---|---|
| `entity_id` → `coins.id` | `p6_observation_quality.entity_id` | `coins.id` | CASCADE | Deleting a coin removes all its quality records; mirrors existing table behavior |

**No FK to `market_price_daily` or `coin_metrics`:** These tables lack the identity components needed for a valid FK (no `metric`, no `observed_at`). The quality side table is self-contained by design.

**No FK to freshness/registry tables:** `quality_config_version` is a string identifier, not a FK to `p6_registry_config_versions`. The namespaces are intentionally separate (PQ-08).

---

## 16. OHLC Persistence Implications

**PD-03-RES frozen:** OHLC group key = exact `(entity_id, source, observed_at, timeframe)` with members {OPEN, HIGH, LOW, CLOSE}.

**Persistence representation:**

Each of the four OHLC metrics has its own row in `p6_observation_quality`:

```text
row 1: entity_id=42, metric=OPEN,   source=BINANCE_SPOT, observed_at=2026-08-25T00:00:00Z, timeframe=DAILY, quality_status=VALID
row 2: entity_id=42, metric=HIGH,   source=BINANCE_SPOT, observed_at=2026-08-25T00:00:00Z, timeframe=DAILY, quality_status=VALID
row 3: entity_id=42, metric=LOW,    source=BINANCE_SPOT, observed_at=2026-08-25T00:00:00Z, timeframe=DAILY, quality_status=INVALID
row 4: entity_id=42, metric=CLOSE,  source=BINANCE_SPOT, observed_at=2026-08-25T00:00:00Z, timeframe=DAILY, quality_status=INVALID
```

When the group relational check runs (all four members share the same group key and all are present), the evaluator:

1. Runs field-level checks on each member independently → individual `quality_status`.
2. Runs relational checks (HIGH≥LOW, OPEN in range, CLOSE in range) → FAIL evidence records appended to each affected member's evidence array.
3. Applies PD-03-RES scope (OHLC SET): if any relational FAIL exists, ALL FOUR members' `observation_status` is set to INVALID.

**observed_at = UNKNOWN:** When `observed_at IS NULL`, the group key `(entity_id, source, NULL, timeframe)` cannot be resolved. Relational checks evaluate NOT_EVALUABLE. Each member retains its independent field-level `quality_status` from field checks. No group-level propagation occurs. No business_date or collected_at is substituted.

---

## 17. Deferred Decision Handling

OI-01…OI-08 are NOT resolved by this document. Their impact on the persistence model:

| OI | Impact on persistence model |
|---|---|
| OI-01 FR range bound | No rule-config rows for FR range in `p6_quality_rule_config`. Evaluator produces no FR range check. |
| OI-02 Temporal tolerances | No rule-config rows for temporal checks. Evaluator produces no temporal check. |
| OI-03 Duplicate remediation | `ON CONFLICT DO UPDATE` (latest-only). No remediation beyond overwrite. |
| OI-04 Cross-source comparator | No comparator exists in V1. No evidence records for cross-source checks. |
| OI-05 Historical retention | Single-row-per-identity (latest-only). No history table. |
| OI-06 Feature gating | Quality data stored; feature engine not modified. Gating reads quality via future API. |
| OI-07 Signal unification | Quality namespace (`p6_*`) separate from `source_status`, `dataCompleteness`, etc. |
| OI-08 Mixed VALID+MISSING aggregation | `observation_status` defaults to VALID per PD-15-RES proposal. OI-08 may change this; migration to update existing records would be trivial (same table, same row, one column change). |

---

## 18. Existing Schema Boundary

| Component | Status |
|---|---|
| `market_price_daily` | UNCHANGED |
| `coin_metrics` | UNCHANGED |
| `source_status` | UNCHANGED |
| `features` | UNCHANGED |
| `health_scores` | UNCHANGED |
| `recommendations` | UNCHANGED |
| `indicators` | UNCHANGED |
| `coins` | UNCHANGED |
| `narratives` | UNCHANGED |
| `p6_source_definitions` | UNCHANGED |
| `p6_source_capabilities` | UNCHANGED |
| `p6_registry_config_versions` | UNCHANGED |
| `p6_freshness_policies` | UNCHANGED |
| All P3/P4/P5 tables | UNCHANGED |

---

## 19. Migration Design

Future migration (to be created in P6-01D-D2):

```sql
-- Migration: 0028_add_quality_persistence.sql

-- 1. Quality classification table
CREATE TABLE p6_observation_quality ( ... );  -- as defined in §12.1

-- 2. Quality rule configuration table
CREATE TABLE p6_quality_rule_config ( ... );  -- as defined in §12.3

-- 3. Partial unique indexes (replaces single UNIQUE constraint)
CREATE UNIQUE INDEX p6_oq_known_unique
    ON p6_observation_quality (entity_id, metric, source, observed_at, timeframe)
    WHERE observed_at IS NOT NULL;
CREATE UNIQUE INDEX p6_oq_unknown_unique
    ON p6_observation_quality (entity_id, metric, source, timeframe)
    WHERE observed_at IS NULL;

-- 4. Operational indexes
CREATE INDEX p6_oq_status_idx ON p6_observation_quality (quality_status);
CREATE INDEX p6_oq_config_idx ON p6_observation_quality (quality_config_version);
CREATE INDEX p6_oq_evaluated_idx ON p6_observation_quality (quality_evaluated_at);
CREATE INDEX p6_oq_approx_join_idx ON p6_observation_quality (entity_id, source, timeframe, observed_at);

-- 4. Seed: V1 rule configuration (PD-18-RES Part A)
-- Deterministic INSERT of the 12 frozen semantic rules.
-- NO threshold values for OI-01/OI-02.
-- Example rows:
-- (v1, NUMERIC_PARSE, NULL, 'NUMERIC_PARSE', '{"reject": ["NaN", "Infinity", "-Infinity", "non-numeric"]}', true)
-- (v1, NUMERIC_SIGN, 'OPEN', 'NUMERIC_SIGN', '{"min": 0}', true)
-- ... (full set per PD-01-RES matrix)

-- 5. No quality seed data (no observations exist yet)
-- 6. No freshness threshold seed data
-- 7. Rollback: DROP TABLE p6_observation_quality; DROP TABLE p6_quality_rule_config;
```

**Seed data scope:** Only `p6_quality_rule_config` rows (declarative rules from PD-18-RES Part A). No `p6_observation_quality` seed data — observations don't exist yet with quality classifications.

---

## 20. API Boundary

No API implementation in D1. Future read access may expose:

- `quality_status` / `observation_status`
- `evidence` array
- `quality_config_version`
- `quality_evaluated_at`

Exposure will be additive (new API route or extend existing coin API). No existing API contract is modified.

---

## 21. Security / Data Integrity Considerations

- Quality data is classification metadata, not financial data. No additional access control beyond existing admin auth.
- Evidence `detail` field is application-controlled JSON. No user-supplied data enters evidence. Injection risk is negligible.
- The `ON CONFLICT DO UPDATE` pattern prevents duplicate accumulation but does not prevent concurrent classification of the same identity. The refresh pipeline's existing lock mechanism (`checkRefreshLock`) prevents concurrent refreshes; quality classification inherits this protection.
- No DELETE operations are defined on `p6_observation_quality` in V1. Historical data is naturally replaced by upsert. Explicit cleanup (e.g., orphaned records for deleted coins) is handled by the `ON DELETE CASCADE` FK.

---

## 22. Persistence Invariants

| ID | Invariant | Justification |
|---|---|---|
| PQ-01 | The five-column semantic identity `(entity_id, metric, source, observed_at, timeframe)` is self-declared in `p6_observation_quality` and is the unique constraint. No surrogate key replaces it. | P6-01B identity authority; PD-13-RES |
| PQ-02 | `collected_at` is stored as informational provenance only. It MUST NOT be used as `observed_at` or as part of the semantic identity. | P6-01B Revision 2; DQ-14 |
| PQ-03 | `business_date` (from existing tables) is NOT used as `observed_at` or as part of the side-table identity. Cross-table joins on date are explicitly documented as approximate. | P6-01B; PD-03-RES |
| PQ-04 | `quality_status` and `observation_status` accept exactly VALID, INVALID, MISSING, UNKNOWN. No other value is stored. | DQ-01, DQ-02, PD-18-RES |
| PQ-05 | Evidence outcomes accept exactly PASS, FAIL, NOT_APPLICABLE, NOT_EVALUABLE. No other value is stored. | P6-01D-B §7 |
| PQ-06 | MISSING and NEVER collapse into the same SQL representation. UNKNOWN is represented by `quality_status = 'UNKNOWN'` with evidence explaining why assessment failed. MISSING is `quality_status = 'MISSING'` with evidence explaining absence. | DQ-08/DQ-10 |
| PQ-07 | Every row carries a non-empty `quality_config_version`. No row exists without a version identifier. | DQ-16, PD-18-RES |
| PQ-08 | `quality_config_version` is a separate namespace from P6-01C `config_version`. They never share values, never join, and never alias. | DQ-17 |
| PQ-09 | Two partial unique indexes enforce at most one current classification per semantic identity: KNOWN observations on `(entity_id, metric, source, observed_at, timeframe)` WHERE observed_at IS NOT NULL; UNKNOWN observations on `(entity_id, metric, source, timeframe)` WHERE observed_at IS NULL (PD-17 latest-only). | PD-17-RES |
| PQ-10 | Every non-VALID quality status carries at least one evidence record with outcome FAIL or an explanation entry for NOT_EVALUABLE/MISSING. Evidence is traceable to a `check_id` present in `p6_quality_rule_config`. | DQ-05, DQ-07a |
| PQ-11 | OHLC relational checks operate against the exact P6-01B group key. No approximation is used for relational check execution. Approximate joins are used only for cross-table data retrieval, not for quality evaluation logic. | PD-03-RES |
| PQ-12 | When the source does not provide an observation timestamp, `observed_at` is stored as NULL. NULL is the canonical PostgreSQL representation of "observation time unknown" — it is not a sentinel, not a fake timestamp, and not confused with any real observation time. | P6-01B UNKNOWN semantics |
| PQ-13 | Quality persistence does not modify, correct, delete, or replace any observation value in existing tables. It is read-only with respect to observations. | DQ-12 |
| PQ-14 | `p6_observation_quality` and `p6_quality_rule_config` are additive tables. No existing table is created, altered, or dropped by this migration. | DQ-20 (schema boundary) |
| PQ-15 | No P4/P5 table, contract, or semantic is modified by the persistence model. | DQ-20 |
| PQ-16 | Unresolved decisions OI-01…OI-08 are NOT materialized as default values, placeholder rows, or hardcoded fallbacks. Absent configuration means absent checks. | PD-06-RES, PD-07/08-RES, DQ-21 |

---

## 23. Implementation Readiness for D2

When this document is frozen, P6-01D-D2 may implement:

1. **Drizzle schema** for `p6_observation_quality` and `p6_quality_rule_config` in `src/db/schema.ts`.
2. **Migration** `0028_add_quality_persistence.sql` with table creation, indexes, constraints, and V1 rule-config seed data (PD-18-RES Part A).
3. **Type exports** for quality record and evidence types in `src/lib/p6/quality/types.ts`.
4. **Registry access service** for reading quality rule configuration in `src/lib/p6/quality/config.ts`.
5. **Upsert service** for writing quality classifications in `src/lib/p6/quality/service.ts`.
6. **Unit tests** for: schema constraints, config loading, upsert behavior (KNOWN/UNKNOWN paths), partial unique index enforcement, approximate-join correctness, NULL observed_at handling.

D2 MUST NOT implement: validators, quality rule evaluation logic, aggregation engine, collector changes, refresh route changes, feature gating, API endpoints.

---

## 24. Acceptance Criteria

- [x] Authoritative contracts audited (P6-01B, P6-01C, P6-01D-B, P6-01D-C2)
- [x] C2 treated as frozen
- [x] PD-13 implemented at design level (side-table model)
- [x] PD-17 latest-only semantics represented (unique constraint + upsert)
- [x] P6-01B identity preserved (five columns in side table)
- [x] observed_at never substituted (NULL for UNKNOWN, not business_date/collected_at)
- [x] collected_at remains collection timestamp (informational column)
- [x] quality_evaluated_at separately defined
- [x] VALID/INVALID/MISSING/UNKNOWN preserved (CHECK constraint)
- [x] Evidence model represented (jsonb array)
- [x] PASS/FAIL/NOT_APPLICABLE/NOT_EVALUABLE preserved
- [x] MISSING ≠ UNKNOWN (separate status values, no NULL ambiguity)
- [x] quality_config_version represented (separate namespace)
- [x] Freshness config_version remains separate (PQ-08)
- [x] OHLC exact identity constraint preserved (PQ-11)
- [x] UNKNOWN observed_at handled without fabrication (NULL, not sentinel or fake timestamp)
- [x] Physical schema proposed but NOT implemented
- [x] Migration proposed but NOT created
- [x] OI-01…OI-08 not resolved
- [x] Existing tables untouched
- [x] P4/P5 untouched
- [x] No API implementation
- [x] No validator implementation
- [x] No production code
- [x] Only D1 document changed

---

## 25. Verification

| Check | Result |
|---|---|
| Production changes | NONE |
| Schema changes | NONE |
| Migration changes | NONE |
| API changes | NONE |
| Validator changes | NONE |
| P4/P5 changes | NONE |
| P6-01B changes | NONE |
| P6-01C changes | NONE |
| Blocking gaps discovered | PARTIAL: `observed_at` and `metric` not persisted in existing tables; side table is self-contained; cross-table joins documented as approximate |
| Files changed | `docs/P6_Upgrade/P6-01D-D1_QUALITY_PERSISTENCE_MODEL.md` only |
| Git boundary | Verified clean ✅ |

---

**END OF P6-01D-D1 — PERSISTENCE DESIGN ONLY. NOT IMPLEMENTED. AWAITING PLANNER AUDIT.**
