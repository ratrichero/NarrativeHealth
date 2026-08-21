# P6-01C — Freshness Policy Contract

**Date:** 2026-08-21
**Task Type:** CONTRACT DESIGN DOCUMENT ONLY — NO IMPLEMENTATION
**Frozen Authorities:**
- P6-01B Observation Contract (ad5d7df)
- P6-01C-A Source Registry Contract (18fb0f0)
- P6-01C-B Source Registry Implementation (03b092b)

---

## 1. Purpose

This document defines the executable Freshness Policy model that will later be consumed by a Freshness Evaluator.

The contract specifies:
- freshness state vocabulary (frozen)
- FreshnessPolicy model structure
- temporal evaluation semantics
- expected_interval semantics
- stale_after semantics
- policy identity and resolution
- configuration versioning
- compatibility with P6-01B and P6-01C-A/B

**This is a policy model design document.** It does not implement the evaluator, modify collectors, modify observation persistence, or affect P4/P5.

---

## 2. Scope

### 2.1 In Scope

- Freshness state vocabulary (frozen from P6-01B)
- FreshnessPolicy model definition
- Temporal evaluation contract (age calculation)
- expected_interval semantics
- stale_after semantics
- Policy identity (deterministic tuple)
- Policy resolution rules
- Configuration versioning model

### 2.2 Out of Scope

- Freshness evaluator implementation
- Freshness threshold values (PLANNER DECISION REQUIRED)
- Collector modifications
- Observation persistence changes
- Feature calculation changes
- Health score changes
- Alert creation
- P4/P5 modifications

---

## 3. Frozen Dependencies

| Document | Commit | What It Freezes |
|---|---|---|
| P6-01B | ad5d7df | Observation identity, observed_at, collected_at, timeframe, metric vocabulary, units, provenance, freshness states, quality states |
| P6-01C-A | 18fb0f0 | Source registry contract, source identity, source type, source status, capability model, entity coverage, timeframe coverage, freshness configuration model |
| P6-01C-B | 03b092b | Source registry implementation (schema, types, service, tests) |

This contract does NOT modify any frozen authority. It extends the freshness configuration model defined in P6-01C-A §11 with executable policy semantics.

---

## 4. Freshness States

### 4.1 Frozen Vocabulary

Exactly three freshness states (frozen by P6-01B §9.1):

| State | Definition |
|---|---|
| `FRESH` | Data is current and within expected operational cadence |
| `STALE` | Data is older than expected and may not reflect current state |
| `UNKNOWN` | Freshness cannot be determined |

### 4.2 Constraints

- No other freshness state is permitted
- `AGING`, `INSUFFICIENT`, `DEGRADED` are NOT freshness states
- Freshness states are distinct from quality states (VALID, INVALID, MISSING, UNKNOWN)
- Freshness states are distinct from market health states

---

## 5. FreshnessPolicy Model

### 5.1 Conceptual Structure

```
FreshnessPolicy
├── source_id           (which source this policy applies to)
├── metric              (which canonical metric)
├── timeframe           (which temporal resolution)
├── expected_interval   (expected time between observations)
├── stale_after         (threshold for STALE classification)
└── config_version      (which configuration version this policy belongs to)
```

### 5.2 Field Definitions

| Field | Type | Definition | Constraints |
|---|---|---|---|
| `source_id` | SourceId | Canonical source identifier | Must be a valid value from P6-01C-B types: `BINANCE_SPOT`, `BINANCE_FUTURES`, `COINGECKO` |
| `metric` | CanonicalMetric | Canonical metric identifier | Must be a valid value from P6-01B §6.1 vocabulary |
| `timeframe` | Timeframe | Temporal resolution | Must be a valid value from P6-01B §5.3 vocabulary |
| `expected_interval` | Duration | Expected time between observations for this (source, metric, timeframe) | Configurable. Must be > 0. Unit: milliseconds or ISO 8601 duration. |
| `stale_after` | Duration | Threshold after which data is classified as STALE | Configurable. Must be > 0. Unit: milliseconds or ISO 8601 duration. |
| `config_version` | integer | Configuration version this policy belongs to | Must reference a valid `p6_registry_config_versions.version` |

### 5.3 What FreshnessPolicy Does NOT Contain

The following fields are explicitly NOT part of the FreshnessPolicy model:

- `priority` — source priority is out of scope (P6-01C-A §6)
- `fallback` — fallback policy is out of scope (P6-01C-A §7)
- `health_weight` — not a freshness concern
- `quality_threshold` — quality is a separate dimension (P6-01B §10)
- `retry_count` — operational concern, not freshness
- `error_threshold` — operational concern, not freshness

---

## 6. Temporal Evaluation Contract

### 6.1 Age Calculation

Freshness is evaluated using:

```
age = evaluation_time - observed_at
```

Where:
- `evaluation_time` is the timestamp when freshness is being evaluated (typically "now")
- `observed_at` is the source observation timestamp from the canonical observation (P6-01B §5.1)

### 6.2 Evaluation Rules

| Condition | freshness_status |
|---|---|
| `observed_at` is known AND `age ≤ stale_after` | `FRESH` |
| `observed_at` is known AND `age > stale_after` | `STALE` |
| `observed_at = UNKNOWN` | `UNKNOWN` |
| No matching FreshnessPolicy exists | `UNKNOWN` |

### 6.3 Critical Constraints

- `collected_at` is NEVER used in freshness age calculation
- `observed_at = UNKNOWN` ALWAYS produces `freshness_status = UNKNOWN`
- Freshness evaluation is per-observation, not per-source
- Freshness evaluation uses the policy matching the observation's (source_id, metric, timeframe, config_version)

### 6.4 Evaluation Scope

Freshness evaluation applies to CANONICAL observations only (P6-01B §3.2). Raw observations do not have freshness semantics. Derived metrics inherit freshness from their input observations.

---

## 7. expected_interval

### 7.1 Definition

`expected_interval` describes the expected cadence at which the source provides new data for a specific (metric, timeframe) combination.

### 7.2 Semantics

- `expected_interval` is a declarative configuration value
- `expected_interval` describes expected behavior, not guaranteed behavior
- `expected_interval` is used for monitoring and diagnostics, not for freshness classification
- `expected_interval` MUST NOT automatically imply `stale_after`

### 7.3 Examples (Illustrative Only)

The following are illustrative examples of what `expected_interval` might represent. They are NOT actual threshold values.

| (source, metric, timeframe) | expected_interval might be | Reasoning |
|---|---|---|
| (BINANCE_SPOT, CLOSE, DAILY) | PLANNER DECISION REQUIRED | Binance provides daily klines; expected cadence is once per day |
| (BINANCE_FUTURES, OPEN_INTEREST, SOURCE_SNAPSHOT) | PLANNER DECISION REQUIRED | OI is a point-in-time snapshot; cadence depends on refresh cycle |
| (COINGECKO, MARKET_CAP, SOURCE_SNAPSHOT) | PLANNER DECISION REQUIRED | CoinGecko provides snapshot; cadence depends on refresh cycle |

### 7.4 Relationship to stale_after

`expected_interval` and `stale_after` are DISTINCT concepts:

- `expected_interval` = "how often should new data arrive?"
- `stale_after` = "how old can data be before it's STALE?"

A common pattern might be `stale_after = k × expected_interval` where `k > 1`, but this is a PLANNER DECISION, not a contract requirement.

---

## 8. stale_after

### 8.1 Definition

`stale_after` is the duration threshold after which an observation is classified as `STALE`.

### 8.2 Semantics

- `stale_after` is a declarative configuration value
- `stale_after` is the sole determinant of FRESH vs STALE classification (given a known `observed_at`)
- `stale_after` is NOT derived from `expected_interval` by the contract
- `stale_after` values are PLANNER DECISION REQUIRED

### 8.3 Threshold Values

**CRITICAL: No threshold values are defined by this contract.**

All `stale_after` values are PLANNER DECISION REQUIRED. The model supports configurable values without deciding what those values are.

### 8.4 Configuration, Not Code

`stale_after` is:
- Stored in the source registry configuration
- Versioned with the configuration
- NOT hard-coded in collectors, services, feature calculations, or API routes
- Changeable without code deployment

---

## 9. Policy Identity

### 9.1 Deterministic Identity

A FreshnessPolicy is uniquely identified by:

```
(source_id, metric, timeframe, config_version)
```

### 9.2 Uniqueness Requirement

For any given `config_version`, there must be AT MOST one FreshnessPolicy matching a specific `(source_id, metric, timeframe)` tuple.

If multiple policies match the same `(source_id, metric, timeframe)` within the same `config_version`, the system behavior is undefined. The implementation MUST enforce uniqueness.

### 9.3 Identity Rationale

- `source_id` — different sources may have different freshness expectations for the same metric
- `metric` — different metrics may have different freshness expectations from the same source
- `timeframe` — different timeframes have different cadences
- `config_version` — freshness policies may change across configuration versions

---

## 10. Configuration Version

### 10.1 Version Association

Every FreshnessPolicy is associated with a `config_version` that identifies which version of the source registry configuration it belongs to.

### 10.2 Version Semantics

- `config_version` references `p6_registry_config_versions.version` (P6-01C-B schema)
- Each configuration version contains a complete set of FreshnessPolicies
- Changing a freshness threshold creates a new configuration version
- Historical observations retain the version marker of the configuration that was active when they were collected

### 10.3 What Is NOT Implemented

- Historical version replay — not in scope
- Version retention policy — PLANNER DECISION REQUIRED
- Algorithm version — separate from configuration version (P6-01B §13)

---

## 11. Policy Resolution

### 11.1 Resolution Algorithm

When evaluating freshness for an observation:

1. Identify the observation's `(source_id, metric, timeframe)` from the canonical observation
2. Identify the observation's `config_version` (the configuration version active when the observation was collected)
3. Look up the FreshnessPolicy matching `(source_id, metric, timeframe, config_version)`
4. If found, apply the policy's `stale_after` to classify the observation
5. If not found, classify freshness as `UNKNOWN`

### 11.2 No Source Priority

Policy resolution does NOT introduce source priority. If multiple sources provide the same metric, each has its own independent FreshnessPolicy. The freshness evaluator evaluates each observation independently.

### 11.3 No Fallback

Policy resolution does NOT introduce fallback. If a policy is not found for a specific `(source_id, metric, timeframe, config_version)`, the result is `UNKNOWN`. There is no fallback to another source's policy or another timeframe's policy.

### 11.4 Deterministic Resolution

Given the same observation and the same registry state, policy resolution must produce the same freshness status. No randomness, no wall-clock dependency (beyond `evaluation_time`), no side effects.

---

## 12. P6-01B Compatibility

### 12.1 Preserved Semantics

This contract preserves all P6-01B frozen semantics:

| P6-01B Concept | Preserved | How |
|---|---|---|
| Freshness states (FRESH/STALE/UNKNOWN) | YES | Uses exactly these three states |
| observed_at semantics | YES | Uses observed_at for age calculation |
| collected_at non-substitution | YES | collected_at never used in freshness |
| UNKNOWN observed_at → UNKNOWN freshness | YES | Explicit rule in §6.2 |
| Metric vocabulary | YES | Uses P6-01B canonical metrics |
| Timeframe vocabulary | YES | Uses P6-01B timeframes |
| Quality independence | YES | Freshness is independent from quality |

### 12.2 No Modifications

This contract does NOT modify:
- P6-01B observation identity
- P6-01B temporal contract
- P6-01B metric vocabulary
- P6-01B quality states
- P6-01B persistence boundary

---

## 13. P6-01C-A/B Compatibility

### 13.1 Preserved Semantics

| P6-01C-A/B Concept | Preserved | How |
|---|---|---|
| Source identity (3 canonical sources) | YES | Uses P6-01C-B SourceId type |
| Source type classification | YES | Not used in freshness policy |
| Source status (ACTIVE/INACTIVE) | YES | Not used in freshness policy |
| Capability model | YES | Policy applies to capabilities defined in registry |
| Entity coverage | YES | Not directly used in freshness policy |
| Timeframe coverage | YES | Policy uses P6-01C-B Timeframe type |
| No source priority | YES | Policy resolution has no priority |
| No fallback | YES | Policy resolution has no fallback |
| Configuration versioning | YES | Policies are versioned with config_version |

### 13.2 Extension

This contract EXTENDS P6-01C-A §11 (Freshness Configuration) by:
- Defining the executable policy model structure
- Defining temporal evaluation semantics
- Defining policy resolution rules
- Defining configuration versioning behavior

---

## 14. P3/P4/P5 Boundary

### 14.1 No Modifications

This contract does NOT modify:
- P3 intelligence semantics
- P4 decision support
- P5 policy/safety/approval/permission
- P5 explanation/audit
- P5 decision assembly
- P5 historical artifact persistence
- P5 presentation transformation
- Any BUY/SELL/LONG/SHORT/ORDER vocabulary

### 14.2 No Interaction

Freshness policy does NOT:
- Influence health scoring
- Influence recommendation signals
- Influence action decisions
- Create trading signals
- Trigger order execution

Freshness is an operational metadata concern, independent from intelligence and decision layers.

---

## 15. Invariants

### FP-01: Frozen Freshness Vocabulary
Freshness states are exactly `FRESH`, `STALE`, `UNKNOWN`. No other state is permitted.

### FP-02: observed_at for Freshness
Freshness age is calculated using `observed_at`, never `collected_at`.

### FP-03: No collected_at Substitution
`collected_at` cannot substitute for `observed_at` in freshness evaluation under any circumstance.

### FP-04: UNKNOWN observed_at → UNKNOWN Freshness
If `observed_at = UNKNOWN`, then `freshness_status = UNKNOWN`. Always. No exception.

### FP-05: Distinct Interval Concepts
`expected_interval` and `stale_after` are distinct concepts. `stale_after = expected_interval` is NOT assumed by this contract.

### FP-06: Configuration, Not Code
`stale_after` is configuration, not hidden code. It is external, declarative, and versioned.

### FP-07: No Invented Thresholds
No freshness threshold value may be invented by the Agent. All threshold values are PLANNER DECISION REQUIRED.

### FP-08: Deterministic Policy Identity
Policy identity `(source_id, metric, timeframe, config_version)` is deterministic. Same tuple → same policy.

### FP-09: Explicit Configuration Version
Configuration version is explicit. Every FreshnessPolicy has a `config_version`. There is no implicit or default version.

### FP-10: No Source Priority
Policy resolution does not introduce source priority. Each source's policy is evaluated independently.

### FP-11: No Fallback
Policy resolution does not introduce fallback. Missing policy → `UNKNOWN`. No precedence chain.

### FP-12: No P4/P5 Semantics
Freshness policy does not contain or imply P4/P5 action semantics, recommendation logic, or BUY/SELL vocabulary.

---

## 16. Open Decisions

| # | Question | Status | Impact |
|---|---|---|---|
| 1 | What are the actual `stale_after` values for each (source, metric, timeframe) policy? | **PLANNER DECISION REQUIRED** | Determines FRESH/STALE threshold |
| 2 | What are the actual `expected_interval` values for each (source, metric, timeframe) policy? | **PLANNER DECISION REQUIRED** | Determines expected cadence for monitoring |
| 3 | How should configuration version history be retained? | **PLANNER DECISION REQUIRED** | Affects storage and audit capability |
| 4 | Should freshness policies be stored in the existing `p6_source_capabilities` table or a separate table? | **PLANNER DECISION REQUIRED** | Affects schema design |
| 5 | What unit should `expected_interval` and `stale_after` use (milliseconds, ISO 8601 duration, seconds)? | **PLANNER DECISION REQUIRED** | Affects implementation representation |
| 6 | Should there be a default policy for unmatched (source, metric, timeframe) combinations? | **PLANNER DECISION REQUIRED** | Affects fallback behavior (if any) |
| 7 | Should freshness evaluation happen at write time, query time, or both? | **PLANNER DECISION REQUIRED** | Affects performance and freshness currency |
| 8 | Should freshness be stored on the observation record or computed dynamically? | **PLANNER DECISION REQUIRED** | Affects storage and freshness currency |

---

## 17. Acceptance Criteria

- [x] Model is precise (FreshnessPolicy with 6 semantic fields)
- [x] States are frozen (FRESH/STALE/UNKNOWN only)
- [x] Temporal semantics correct (age = evaluation_time - observed_at)
- [x] observed_at protected (never substituted with collected_at)
- [x] expected_interval defined (distinct from stale_after)
- [x] stale_after defined (configurable, not invented)
- [x] No threshold values invented (all PLANNER DECISION REQUIRED)
- [x] Policy identity deterministic ((source_id, metric, timeframe, config_version))
- [x] config_version represented (explicit field)
- [x] No source priority (invariant FP-10)
- [x] No fallback (invariant FP-11)
- [x] P6-01B preserved (all frozen semantics maintained)
- [x] P6-01C-A/B preserved (all frozen semantics maintained)
- [x] P3/P4/P5 preserved (no modifications)
- [x] Open decisions explicit (8 items, all PLANNER DECISION REQUIRED)
- [x] Documentation only (no production code)
- [x] Git boundary clean (single document file)

---

## 18. Freeze Checklist

| # | Item | Status |
|---|---|---|
| 1 | Freshness state vocabulary frozen (3 values) | ✓ |
| 2 | FreshnessPolicy model defined (6 fields) | ✓ |
| 3 | Temporal evaluation contract defined | ✓ |
| 4 | expected_interval semantics defined | ✓ |
| 5 | stale_after semantics defined | ✓ |
| 6 | Policy identity defined (deterministic tuple) | ✓ |
| 7 | Policy resolution rules defined | ✓ |
| 8 | Configuration versioning model defined | ✓ |
| 9 | P6-01B compatibility verified | ✓ |
| 10 | P6-01C-A/B compatibility verified | ✓ |
| 11 | P3/P4/P5 boundary preserved | ✓ |
| 12 | 12 invariants stated (FP-01 through FP-12) | ✓ |
| 13 | 8 open decisions marked PLANNER DECISION REQUIRED | ✓ |
| 14 | No threshold values invented | ✓ |
| 15 | No source priority introduced | ✓ |
| 16 | No fallback introduced | ✓ |
| 17 | No production code modified | ✓ |
| 18 | No schema modified | ✓ |
| 19 | No API modified | ✓ |
| 20 | No P4/P5 modified | ✓ |

---

**P6-01C FRESHNESS POLICY CONTRACT — COMPLETE**
**NO PRODUCTION CODE CHANGES**
**NO SCHEMA CHANGES**
**NO API CHANGES**
**NO P4/P5 CONTRACT CHANGES**
