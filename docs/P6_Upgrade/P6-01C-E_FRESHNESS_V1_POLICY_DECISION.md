# P6-01C-E — Freshness V1 Policy Decision

**Status:** FROZEN — PLANNER DECISION
**Phase:** P6
**Scope:** Freshness V1 configuration policy
**Depends on:** P6-01B Observation Contract; P6-01C Source Registry Contract; P6-01C Freshness Policy Contract; P6-01C-D Freshness Evaluator

---

## 1. Purpose

This document freezes the Planner/Product decisions governing Freshness V1 configuration. It does not change the observation contract, source registry semantics, or evaluator algorithm. It defines the production policy parameters that the implementation may configure.

The Agent must execute these decisions and MUST NOT invent alternative thresholds or semantics.

## 2. Frozen Dependencies

The following contracts remain authoritative and unchanged:

- P6-01B — Canonical Observation Contract
- P6-01C-A — Source Registry Contract
- P6-01C-B — Source Registry implementation/model
- P6-01C-C — Freshness Policy Contract
- P6-01C-D — Freshness Evaluator implementation

## 3. Freshness States

Freshness has exactly three states:

- `FRESH`
- `STALE`
- `UNKNOWN`

No `AGING`, `DEGRADED`, `INSUFFICIENT`, or `UNAVAILABLE` freshness state may be introduced.

## 4. Temporal Authority

Freshness age is always:

```text
age = evaluation_time - observed_at
```

`observed_at` is the authoritative observation timestamp.

If `observed_at = UNKNOWN`, freshness MUST be `UNKNOWN`.

`collected_at` MUST NEVER substitute for `observed_at`.

## 5. Freshness Evaluation Boundary

For a resolved production policy:

```text
age <= stale_after  -> FRESH
age > stale_after   -> STALE
```

No intermediate freshness state exists.

A missing/unresolved policy is a configuration state, not a freshness state:

```text
missing policy -> POLICY_UNRESOLVED
```

`POLICY_UNRESOLVED` MUST NOT be converted into `FRESH` or `STALE`.

## 6. Policy Identity

Production freshness policy identity remains:

```text
(source_id, metric, timeframe, config_version)
```

Each policy must explicitly define:

- `source_id`
- `metric`
- `timeframe`
- `expected_interval`
- `stale_after`
- `config_version`

The evaluator consumes configuration. Thresholds MUST NOT be hard-coded into evaluation logic.

## 7. V1 Cadence Classes

### 7.1 DAILY

For supported `DAILY` observations:

```text
expected_interval = 24h
stale_after       = 36h
```

The 36-hour stale boundary provides a 1.5× cadence margin intended to absorb normal scheduler jitter, collector delay, network latency, and API response delay while retaining useful stale-data detection.

### 7.2 4H

For supported `4H` observations:

```text
expected_interval = 4h
stale_after       = 6h
```

The 6-hour stale boundary provides the same 1.5× cadence margin principle.

### 7.3 SOURCE_SNAPSHOT

No production freshness threshold is frozen for `SOURCE_SNAPSHOT` at this stage.

Production `SOURCE_SNAPSHOT` policies MUST NOT be seeded until the actual collector/source observation cadence has been independently established with code evidence.

The required sequence is:

```text
collector cadence reconnaissance
        -> evidence
        -> Planner threshold decision
        -> policy activation
```

`SOURCE_SNAPSHOT` MUST NOT be assumed to mean `DAILY` or `4H`.

## 8. Metric Grouping Rule

Metrics sharing the same source, timeframe, and actual observation cadence should use the same freshness policy semantics where appropriate. V1 MUST NOT create arbitrary metric-specific stale thresholds merely because the metric name differs.

Metric nature or market volatility MUST NOT be used as a reason to alter data freshness thresholds.

Freshness measures data availability/recency, not market health or market volatility.

## 9. Source Priority Boundary

Freshness policy does not select between sources.

No priority such as:

```text
BINANCE_FUTURES > BINANCE_SPOT
```

or the reverse is introduced by this decision.

The evaluator assesses the observation/source presented to it.

## 10. Fallback Boundary

Freshness policy does not implement source fallback.

If a policy is unavailable for a requested source/metric/timeframe, the system MUST NOT substitute another source.

## 11. Configuration Completeness

A production freshness policy is complete only when all of the following are present and valid:

```text
source_id
metric
timeframe
expected_interval
stale_after
config_version
```

`stale_after = null` or an otherwise missing threshold is not a valid production policy.

## 12. Threshold Safety Rules

The following rules are frozen for V1:

1. `expected_interval > 0`.
2. `stale_after > expected_interval`.
3. `stale_after` is configuration, never evaluator hard-code.
4. Production thresholds must come from this Planner decision or a later explicitly versioned Planner decision.
5. Test-only thresholds may exist in isolated test fixtures, but MUST NOT enter production seed/configuration.

## 13. Production Policy Scope

Production policy seeding is limited to capability combinations supported by the frozen P6-01C source registry.

Do not create policies for unsupported source/metric/timeframe combinations.

For V1:

- Supported `DAILY` combinations may use `24h / 36h`.
- Supported `4H` combinations may use `4h / 6h`.
- `SOURCE_SNAPSHOT` combinations remain unconfigured pending cadence reconnaissance and a subsequent Planner decision.

## 14. SOURCE_SNAPSHOT Reconnaissance Requirement

The following existing SOURCE_SNAPSHOT targets require evidence before activation:

- `BINANCE_FUTURES / OPEN_INTEREST / SOURCE_SNAPSHOT`
- `BINANCE_FUTURES / FUNDING_RATE / SOURCE_SNAPSHOT`
- `COINGECKO / MARKET_CAP / SOURCE_SNAPSHOT`
- `COINGECKO / FDV / SOURCE_SNAPSHOT`

Reconnaissance must establish, where available:

- actual collector path
- actual fetch cadence
- timestamp provenance
- whether `observed_at` is source-provided
- whether cadence is deterministic or variable

If the source does not provide an observation timestamp, the system MUST preserve `observed_at = UNKNOWN`; `collected_at` cannot be substituted.

## 15. Frozen Invariants

### FVD-01
Every production freshness policy has an explicit `source_id`.

### FVD-02
Every production freshness policy uses canonical metric vocabulary.

### FVD-03
Every production freshness policy uses a supported timeframe.

### FVD-04
`expected_interval > 0`.

### FVD-05
`stale_after > expected_interval`.

### FVD-06
`stale_after` is configuration and is never hard-coded in the evaluator.

### FVD-07
`observed_at = UNKNOWN` produces `UNKNOWN` freshness.

### FVD-08
`collected_at` cannot substitute for `observed_at`.

### FVD-09
A missing/unresolved policy cannot become `FRESH` or `STALE`.

### FVD-10
Freshness policy does not select a source.

### FVD-11
Freshness policy does not implement fallback.

### FVD-12
`SOURCE_SNAPSHOT` requires evidence-based cadence before production activation.

### FVD-13
Production policies contain no test-fixture thresholds.

### FVD-14
Configuration version is explicit.

### FVD-15
Policy identity remains `(source_id, metric, timeframe, config_version)`.

## 16. Explicit Non-Decisions

The following remain outside this decision and MUST NOT be invented by an Agent:

- source priority
- source fallback
- market-health thresholds
- volatility-dependent freshness thresholds
- P4 decision semantics
- P5 intelligence semantics
- SOURCE_SNAPSHOT production thresholds before reconnaissance

## 17. Acceptance Criteria

P6-01C-E implementation may proceed only if:

- DAILY policies use `24h / 36h`.
- 4H policies use `4h / 6h`.
- SOURCE_SNAPSHOT production policies are not seeded before cadence evidence.
- No threshold is hard-coded in evaluator logic.
- Policy identity remains unchanged.
- Missing policy remains distinguishable from `UNKNOWN` observation freshness.
- No source priority or fallback is introduced.
- P3/P4/P5 contracts remain unchanged.

## 18. Freeze Gate

This document is the Planner authority for Freshness V1 policy values.

**Decision:** FROZEN.

Any future change to these values requires an explicitly versioned Planner decision and MUST NOT be silently changed by implementation agents.
