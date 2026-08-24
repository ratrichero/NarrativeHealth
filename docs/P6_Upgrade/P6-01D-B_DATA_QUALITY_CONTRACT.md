# P6-01D-B — Data Quality Contract

**Date:** 2026-08-24
**Task Type:** CONTRACT DESIGN ONLY — NO IMPLEMENTATION
**Status:** DRAFT FOR PLANNER AUDIT
**Frozen Authorities:** P6-01B (Observation Contract), P6-01C (Source Registry + Freshness), P6-01C-E (Freshness V1 Decision), P6-00 Execution Plan Revision 01
**Evidence Basis:** P6-01D-A Data Quality Landscape Recon

---

## 1. Purpose

This document defines the canonical **P6 Data Quality Contract**: the semantic model that classifies the quality of canonical market observations in NarrativeHealth.

The contract answers, for every observation:

> "Is this value trustworthy as recorded — and if not, why not?"

It defines:

- the frozen quality vocabulary (`VALID` / `INVALID` / `MISSING` / `UNKNOWN`);
- the semantics of each state;
- the evidence model that justifies a classification;
- the boundary between Data Quality and the frozen Freshness dimension;
- what this contract explicitly does NOT decide (candidate rules for Planner).

This document is the semantic authority for P6-01D-C (Planner decision) and P6-01D-D/E/F (implementation, tests, freeze).

---

## 2. Scope

### 2.1 In Scope

- Observation-level and field-level data quality semantics.
- The four-state quality vocabulary and its precise definitions.
- Validation **evidence** representation (what was checked, what failed).
- Independence of quality from freshness.
- Null/missing/unknown/malformed classification boundaries (semantic level).
- Duplicate and partial-observation semantics at the quality level.
- No-auto-correction rules.
- Compatibility with P6-01B observation identity and P6-01C freshness.

### 2.2 Covered Metrics

All ten canonical V1 metrics from the frozen P6-01B vocabulary:

```text
OPEN
HIGH
LOW
CLOSE
VOLUME
QUOTE_VOLUME
MARKET_CAP
FDV
OPEN_INTEREST
FUNDING_RATE
```

`PRICE` is NOT an independent canonical metric. Per P6-01B Revision 2, `PRICE` exists only as an API/presentation alias for `CLOSE`. All quality rules defined for `CLOSE` apply to any presentation alias.

### 2.3 Out-of-Scope Entities

Derived metrics are NOT observations and are NOT covered by this contract:

```text
trend_score, momentum_score, health_score,
breadth, participation, derivative_score, confidence_score
```

Quality propagation into derived layers is future scope (see Section 21).

---

## 3. Non-Scope

This contract explicitly does NOT:

1. Implement anything (no code, schema, migration, tests, API).
2. Modify P6-01B observation identity, temporal semantics, or provenance.
3. Modify P6-01C source registry or freshness semantics.
4. Reintroduce obsolete freshness states: `AGING`, `INSUFFICIENT`, `DEGRADED`.
5. Decide concrete business thresholds/ranges (see Section 26 — Planner decisions).
6. Change how collectors fetch, parse, or persist data.
7. Introduce BUY/SELL semantics, action policy, recommendation logic, or scoring weights.
8. Replace or reinterpret the operational `source_status` table (OK/PARTIAL/FAILED).
9. Define quality aggregation formulas for downstream confidence.

---

## 4. Quality Vocabulary

The canonical Data Quality vocabulary is exactly:

| State | Meaning |
|---|---|
| `VALID` | Evidence confirms the value is semantically usable as recorded. |
| `INVALID` | Evidence proves the value violates a defined validity rule. |
| `MISSING` | The expected field has no value because it was never obtained. |
| `UNKNOWN` | Quality cannot be determined with available evidence. |

No other state is permitted. The following states MUST NOT be introduced:

```text
AGING, INSUFFICIENT, DEGRADED, SUSPECT, UNAVAILABLE, WARNING, PARTIAL
```

(`PARTIAL_OK`/`OK`/`FAILED` belong to operational `source_status`, which is a separate concern.)

---

## 5. State Semantics

### 5.1 FROZEN CONTRACT SEMANTICS (authoritative)

**VALID**
An observation is `VALID` when all applicable validation checks defined for its metric pass on the recorded value. VALID means "semantically usable as recorded" — it is NOT a guarantee of truth about the real world; it asserts conformance to the contract's validity rules.

**INVALID**
An observation may be classified `INVALID` only on the basis of positive recorded evidence of rule violation — i.e., at least one executed check produced a `FAIL` outcome, AND the applicable Planner-approved mapping assigns INVALID to that evidence pattern. INVALID requires positive evidence of rule violation. Absence of evidence can never produce INVALID (see Section 8). Where the evidence-to-state mapping is explicitly deferred (see Sections 9 and 11), a FAIL alone does not freeze the final state.

**MISSING**
A field is `MISSING` when the system knows the field was expected but no value exists for it — e.g., the collector returned nothing for the field, or the source payload omitted it. MISSING is a statement about **value absence**, not value badness.

**UNKNOWN**
Quality is `UNKNOWN` when the system cannot determine validity — e.g., validation could not run, evidence is unavailable, the input format defeats evaluation, or the classification path itself failed. UNKNOWN is an **epistemic** state ("we do not know"), not an error synonym.

### 5.2 CANDIDATE RULES REQUIRING PLANNER DECISION

The concrete conditions that map raw situations onto these states are **not decided here**. Specifically deferred to P6-01D-C:

- Which numeric conditions make each metric INVALID (negative price? zero volume? NaN after parse?).
- Whether OHLC relationship violations classify the whole observation or individual fields.
- Whether malformed numeric strings are INVALID or MISSING.
- Timestamp tolerance windows (future / historical) before INVALID.
- Entity-mapping failure classification.
- Duplicate remediation policy.
- Aggregation thresholds (how many invalid fields invalidate the observation).

Section 26 enumerates these as open Planner decisions. This contract defines only the **state semantics and evidence structure**, not the trigger conditions.

---

## 6. Observation-Level Quality Model

Conceptual model (semantic, not schema):

```text
ObservationQuality
├── target
│   ├── observation_ref        # reference to a P6-01B observation identity
│   │                          # (entity_id, metric, source, observed_at, timeframe)
│   └── scope                  # FIELD | OBSERVATION
│
├── status                     # VALID | INVALID | MISSING | UNKNOWN
│
├── evidence[]                 # ordered list of FieldValidationEvidence
│   ├── check_id               # stable identifier of the applied rule
│   ├── field                  # metric/field evaluated
│   ├── outcome                # PASS | FAIL | NOT_APPLICABLE | NOT_EVALUABLE
│   └── detail                 # optional, implementation-defined context
│
└── metadata
    ├── evaluated_at           # when classification ran (system time)
    └── quality_config_version # version of the rule set used
```

Key properties:

1. Quality is **attached to observations**, keyed by P6-01B observation identity. It never redefines identity.
2. Quality classification is a separate artifact from the observation itself. It MAY be stored alongside, adjacent, or computed — persistence choice is a Planner decision (SD-09 from P6-01D-A), not fixed here.
3. Every non-VALID status MUST be explainable by at least one evidence entry (except MISSING, whose evidence is the absence record itself — see Section 9).

---

## 7. Field-Level Validation Evidence Model

Each validation check produces a `FieldValidationEvidence`:

| Attribute | Requirement |
|---|---|
| `check_id` | Stable, deterministic identifier (e.g., `OHLC_HIGH_GE_LOW`). Naming convention is implementation detail; stability across versions is required. |
| `field` | One canonical metric name from Section 2.2. |
| `outcome` | Exactly one of `PASS`, `FAIL`, `NOT_APPLICABLE`, `NOT_EVALUABLE`. |
| `detail` | Optional structured context (observed value, bound, etc.). MUST NOT contain auto-corrected values. |

Outcome semantics:

| Outcome | Meaning |
|---|---|
| `PASS` | Check ran; value conforms. |
| `FAIL` | Check ran; the check has evidence of a rule violation against the value. |
| `NOT_APPLICABLE` | Rule does not apply to this metric/context (e.g., funding-rate range check on OPEN). |
| `NOT_EVALUABLE` | Check could not run because the assessment capability or prerequisite evidence was unavailable. |

**Frozen rule (evidence-only outcomes):** Check outcomes are EVIDENCE ONLY. A `FAIL` means "the executed check has evidence of a rule violation" — it MUST NOT, by itself, freeze the final quality state. The mapping from evidence to final classification (`VALID` / `INVALID` / `MISSING` / `UNKNOWN`) is a separate step:

```text
check execution  →  evidence (outcome)  →  classification (final quality state)
```

For most straightforward violations this mapping is trivial (FAIL → INVALID); however, where this contract explicitly defers the mapping (e.g., NUMERIC_PARSE failures — see Section 11; entity failures — see Section 14; OHLC violation scope — see Section 12), the final classification remains subject to the corresponding Planner decision. No conforming implementation may hard-code a deferred mapping into evaluation logic.

**Frozen rule (FAIL requires presence):** A FAIL outcome requires the check to have actually executed against a present value. If a value is absent, the correct outcome is a MISSING classification, not a FAIL.

---

## 8. Quality vs Freshness Independence

FROZEN. Data Quality and Freshness are fully independent dimensions.

Freshness (frozen under P6-01C): `FRESH / STALE / UNKNOWN`.
Quality (this contract): `VALID / INVALID / MISSING / UNKNOWN`.

The following inferences are PROHIBITED:

```text
STALE  → INVALID        (PROHIBITED)
FRESH  → VALID          (PROHIBITED)
MISSING → STALE         (PROHIBITED)
UNKNOWN(quality) → INVALID   (PROHIBITED)
UNKNOWN(freshness) → UNKNOWN(quality)   (PROHIBITED — may coincide, must not be inferred)
```

All 4 × 3 = 12 combinations of quality × freshness are legal. Examples confirmed by the execution-plan revision:

```text
Freshness = FRESH   + Quality = INVALID    (fresh but broken value)
Freshness = STALE   + Quality = VALID      (old but good value)
Freshness = FRESH   + Quality = MISSING    (recent collection, field absent)
Freshness = UNKNOWN + Quality = VALID      (observation time unknown, value fine)
```

The shared label `UNKNOWN` in both dimensions does NOT merge the dimensions.

---

## 9. Missing vs Unknown Semantics

FROZEN distinction:

| Situation | Classification |
|---|---|
| Field expected; collector did not obtain a value (source omitted field, API error for that field, coin has no mapping for that source) | `MISSING` |
| Assessment itself cannot run or its result cannot be determined (validator crashed, prerequisite evidence unavailable, classification capability unavailable) | `UNKNOWN` |
| Value exists and the applicable Planner-approved mapping assigns INVALID from recorded FAIL evidence | `INVALID` |
| Value exists and all applicable mappings assign VALID from recorded PASS evidence | `VALID` |

**Malformed / unparseable values (explicit):**

A present but malformed/unparseable value (e.g., a numeric field containing a non-numeric string, or a value that parses to NaN/Infinity) is handled as follows:

1. The value IS present evidence — it is not absence, so it is not automatically MISSING.
2. The `NUMERIC_PARSE` check EXECUTES against it.
3. The check outcome is `FAIL` (evidence of a parse-rule violation).
4. The FINAL quality classification for such evidence (INVALID vs MISSING vs another state) remains **deferred to Planner decision PD-02**.

Do NOT automatically classify malformed values as `UNKNOWN`. `UNKNOWN` is reserved exclusively for situations where quality assessment cannot be determined because the required assessment evidence or capability is unavailable — e.g., the validator crashed, an input structure is so broken that even presence/absence of the field cannot be established, or a prerequisite reference is missing. Malformed-but-present values have assessable evidence (the parse ran and failed); they therefore produce FAIL evidence, not UNKNOWN by default.

Boundary clarifications:

1. MISSING is always **field-level first**. An observation-level MISSING applies only when every field of the observation is missing.
2. A missing field is NEVER classified INVALID. "No value" cannot violate a value rule.
3. UNKNOWN never results merely from a missing value. If the only problem is absence → MISSING. UNKNOWN requires an assessment capability/evidence failure (see the malformed-value clarification above for the contrast).
4. Source-level API failure (HTTP error, timeout, empty response) makes affected fields **MISSING**, not INVALID. See Section 10.

---

## 10. Source Failure Semantics

FROZEN:

1. **API/source failure ≠ INVALID observation.** When a source call fails (timeout, HTTP error, empty body), no observation is produced; the corresponding fields are `MISSING` with evidence referencing the source failure.
2. Source failure is already tracked operationally by the `source_status` table (OK/PARTIAL/FAILED). That table remains untouched. It MAY be consumed as *input* to quality evidence, but MUST NOT be relabeled as quality.
3. A partial payload (some fields present, some absent) yields per-field classifications: present fields get their own quality; absent fields are `MISSING`. Partial presence never poisons present values.
4. If the failure mode is ambiguous — e.g., the payload arrived but its structure is unrecognizable such that presence vs absence cannot even be established — affected fields are `UNKNOWN` (assessment impossible), with evidence describing the ambiguity.

---

## 11. Numeric Validity Boundary

FROZEN (boundary only — concrete ranges are Planner decisions):

1. Each numeric metric MUST have an explicit set of numeric validity checks defined **in configuration/rules**, not hidden inside evaluator code paths (mirrors FP-06/SRC-12 style of the freshness contract).
2. The contract recognizes these check categories:
   - `NUMERIC_PARSE` — value parses to a finite number (rejects NaN, Infinity, malformed strings);
   - `NUMERIC_SIGN` — sign constraint per metric;
   - `NUMERIC_RANGE` — min/max bounds per metric.
3. Frozen facts from recon (P6-01D-A) that constrain design:
   - `FUNDING_RATE` is legitimately negative in normal operation → a blanket non-negative rule would be WRONG. Sign rules are per-metric.
   - Zero is legitimate for some metrics (VOLUME, QUOTE_VOLUME, OPEN_INTEREST, FUNDING_RATE neutral) and anomalous for others (OPEN/HIGH/LOW/CLOSE, MARKET_CAP, FDV). Per-metric zero policy = Planner decision (SD-05).
4. A value failing `NUMERIC_PARSE` (NaN/Infinity/malformed string) is a PRESENT value with executed-check evidence: the check runs, the outcome is `FAIL`, and the final classification (INVALID vs MISSING) is a **Planner decision** (PD-02). The contract requires only that the situation be captured as evidence with outcome `FAIL` (parse attempted on a present-but-unusable value) and final state assigned per the Planner's later rule — never hard-coded into evaluation logic.

**Not decided here:** acceptable negative bounds, zero policies per metric, absolute range limits, decimal precision tolerances.

---

## 12. OHLC Relational Validation Boundary

FROZEN (boundary only):

### 12.1 Cross-Observation Group Context

Per P6-01B, `OPEN`, `HIGH`, `LOW`, and `CLOSE` are FOUR SEPARATE canonical observations, each with its own identity:

```text
(entity_id, OPEN,    source, observed_at, timeframe)
(entity_id, HIGH,    source, observed_at, timeframe)
(entity_id, LOW,     source, observed_at, timeframe)
(entity_id, CLOSE,   source, observed_at, timeframe)
```

OHLC relational checks are therefore NOT single-observation checks. They operate on a **conceptual validation group**: a set of sibling observations sharing common identity attributes:

```text
OHLCValidationGroup :=
    group_key   = (entity_id, source, observed_at, timeframe)
    members     = {OPEN, HIGH, LOW, CLOSE}      # each member is a full P6-01B observation
```

Boundary guarantees:

1. This group is a VALIDATION CONTEXT only. It does NOT create a new observation identity, does NOT replace P6-01B identity, and does NOT merge the four observations into one.
2. Each OHLC member keeps its own individual quality classification; relational checks ADDITIONALLY produce group-level evidence records referencing the member observations involved.
3. Group membership requires exact match on `(entity_id, source, observed_at, timeframe)`. Observations differing in any key attribute belong to different groups and MUST NOT be relationally compared.

### 12.2 Relational Checks

Within a group, the recognized relational checks are:

- `HIGH ≥ LOW`
- `LOW ≤ OPEN ≤ HIGH`
- `LOW ≤ CLOSE ≤ HIGH`

These checks are first-class check IDs in the evidence model (e.g., `OHLC_HIGH_GE_LOW`, `OHLC_OPEN_IN_RANGE`, `OHLC_CLOSE_IN_RANGE`); their evidence records cite both the group key and the member fields evaluated.

### 12.3 Scope and Presence Rules

1. Whether a relational violation marks the violating pair of fields, all four OHLC members, or the whole group as INVALID is a **Planner decision** (PD-03). The contract supports all three scopes; the choice must not be hard-coded.
2. A relational check runs only when ALL referenced group members are present. If any referenced member is MISSING, the check outcome is `NOT_EVALUABLE` — never FAIL. (A missing member never causes sibling members to fail.)

**Not decided here:** violation severity, cross-source OHLC consistency (Spot vs Futures disagreement = SD-11), historical repair.

---

## 13. Timestamp Validation Boundary

FROZEN:

1. `observed_at` remains governed exclusively by P6-01B. When the source provides no observation time, `observed_at = UNKNOWN`; collected_at MUST NOT substitute (P6-01B invariant, reaffirmed here as DQ-14).
2. Timestamp validation is a **quality concern only over timestamps that exist**: e.g., is a kline `openTime` structurally valid, absurdly future, or absurdly old?
3. A timestamp that fails structural validation affects the quality of the observation's temporal identity, and therefore the observation is classified per Planner rule; until decided, such cases MUST be surfaced as evidence with outcome FAIL or NOT_EVALUABLE rather than silently accepted.
4. Future-timestamp tolerance and historical-tolerance windows are **Planner decisions** (per task prohibitions). No values are invented here.
5. Timezone handling (`Asia/Ho_Chi_Minh` business-date bucketing via `getBusinessDate()`) is existing behavior and out of scope; quality does not alter bucketing.

---

## 14. Entity / Source Validation Boundary

FROZEN (boundary):

1. An observation references an entity via the P6-01B `entity_id` and a source via canonical `source_id` (BINANCE_SPOT / BINANCE_FUTURES / COINGECKO — frozen under P6-01C-A/B).
2. Entity-resolution failure (unknown symbol, missing `coingeckoId`, missing `binanceSpotSymbol`) currently causes silent skip. Under this contract such failures produce explicit evidence records; whether they classify as MISSING or a dedicated entity-check FAIL is a **Planner decision** (extends SD-02).
3. Cross-source entity mismatch (Spot symbol ≠ Futures symbol asset) is recognized as a candidate consistency check but is NOT mandated here (SD-11).
4. The registry (P6-01C-B) declares coverage requirements (`binanceSpotSymbol`, `binanceFuturesSymbol + hasFutures`, `coingeckoId`). Quality evidence SHOULD reference registry coverage when explaining entity-related absence.

---

## 15. Duplicate Semantics

FROZEN:

1. Current deduplication is DB-constraint-based upsert (`market_price_daily`: unique `(coinId, date)`; `coin_metrics`: unique `(coinId, date, source)`). This behavior is unchanged by quality.
2. Quality does not create, resolve, or remediate duplicates. Duplicate detection/remediation policy is a **Planner decision** (SD-16 below; P6-01D-A left duplicate remediation undecided).
3. When multiple physical rows map to one semantic observation identity (possible today because `market_price_daily` identity `(coinId, date)` lacks `source`), quality classification targets the semantic P6-01B identity; the storage collision is reported as evidence, not silently ignored.
4. Repeated collector execution overwriting the same slot is normal upsert behavior, NOT a quality event, unless the Planner later defines otherwise.

---

## 16. Partial Observation Semantics

FROZEN:

1. Observations are classified **field-by-field**; a partially populated observation is valid overall only in the sense that each present field carries its own status.
2. Partial presence does not degrade the quality status of present fields.
3. An observation composed entirely of MISSING fields is an observation-level MISSING.
4. Mixed observations (some VALID, some MISSING) are represented by the per-field evidence list; whether a single aggregate observation-level status is computed — and by what aggregation formula/threshold — is a **Planner decision** (SD-17 aggregation thresholds; SD-07 partial-data policy).

---

## 17. Null Semantics

FROZEN:

1. NULL in storage is a value-absence signal. It corresponds to `MISSING` unless evidence shows assessment failed (then `UNKNOWN`) or the null itself violates an executed rule (then per Planner rule).
2. Quality classification MUST NOT write substitution values into observations. Writing defaults (0, previous value, mean) over nulls is PROHIBITED (see Section 19).
3. Nullable DB columns (`quoteVolume`, `openInterest`, `fundingRate`, `marketCap`, `fullyDilutedValuation`) accepting nulls is existing schema behavior — unchanged.
4. Existing implicit behaviors documented in P6-01D-A (e.g., `marketCapToSave > 0` filter in refresh route) remain production behavior; quality adds classification alongside, it does not retroactively reinterpret them.

---

## 18. Provenance Semantics

FROZEN:

1. P6-01B narrowed provenance scope to RAW → CANONICAL OBSERVATION. Quality provenance extends this chain by one link: **OBSERVATION → QUALITY CLASSIFICATION**.
2. Quality evidence records which rule-set version produced the classification (`quality_config_version`), mirroring the freshness config-version mechanism (P6-01C-C §10) — but as a SEPARATE version namespace. Quality versions do not reuse or alter freshness config versions.
3. Quality evidence MAY cite source identity (`source_id`) and observation identity attributes, but MUST NOT modify them.
4. Raw payload retention remains optional (P6-01B); quality does not mandate raw retention.

---

## 19. No-Auto-Correction Rule

FROZEN. Quality classification is read-only with respect to observations:

The quality layer MUST NOT perform any of:

```text
substitution       (replace a value with a default/derived value)
interpolation      (synthesize values between observations)
forward fill       (carry last known value forward)
clamping           (bound values into an allowed range)
source switching   (re-collect from another source to "fix" a value)
correction         (alter any recorded value in place)
deletion           (remove observations deemed invalid)
```

Consequences:

1. An INVALID observation stays recorded as-is, flagged INVALID.
2. A MISSING field stays missing; nothing fills it.
3. If downstream consumers need corrected/synthesized data, that is a separate derived-layer task requiring its own Planner authorization.
4. Reclassification (changing a quality status when rules change) is permitted; modification of the underlying observation is not.

---

## 20. Persistence Boundary

FROZEN (boundary only — physical design deferred to P6-01D-D):

1. Quality artifacts are conceptually separable from observations. Storage options (inline columns vs side table vs computed-on-read) are enumerated as Planner decision (SD-09 from P6-01D-A recon); this contract does not choose.
2. Whatever the storage choice, quality data MUST be joinable/resolvable to a P6-01B observation identity.
3. No new tables, migrations, or schema changes are authorized by THIS document.
4. Existing tables (`market_price_daily`, `coin_metrics`, `features`, `source_status`) are not modified by the contract.

---

## 21. Downstream Boundary

FROZEN:

1. This contract governs OBSERVATION-level quality only. Provenance/classification chains beyond it are future scope:
   ```text
   CANONICAL OBSERVATION → DERIVED   (future P6 task)
   DERIVED → INTELLIGENCE            (future P6 task)
   INTELLIGENCE → UI                 (future P6 task)
   ```
2. Quality information MAY be exposed additively to downstream consumers. It MUST NOT silently change existing computations.
3. Whether feature-engine inputs are gated by quality (e.g., skip INVALID rows) is a **Planner decision** (SD-14 from recon). Not decided here.

---

## 22. P4/P5 Compatibility

FROZEN:

1. Quality classification MUST NOT alter P4 decision-support outputs, P5 policy/safety/approval/permission flows, or any recommendation.
2. Quality MUST NOT introduce BUY/SELL/action/recommendation semantics.
3. Existing P4/P5 inputs (`confidenceScore`, `dataCompleteness`, `missingSources`) keep current semantics. Any future quality-weighted confidence is a separate Planner-authorized task (SD-15 from recon).
4. P4/P5 files, contracts, and handoff boundaries are untouched by this document.

---

## 23. Error / Evidence Representation

Requirements for any implementation of this contract:

1. Every non-VALID classification carries machine-readable evidence (check_id, field, outcome, optional detail).
2. Evidence MUST distinguish "check ran, violation evidenced" (`FAIL`) from "assessment capability/evidence unavailable" (`NOT_EVALUABLE`) — collapsing these two is a contract violation.
3. Error objects from the classification process itself (exceptions, crashes) map to `UNKNOWN` outcomes with evidence — never silently to VALID, and never by altering the observation. Present-but-unusable VALUES (malformed numerics) are NOT process errors: they yield FAIL evidence with classification deferred per Section 11.
4. Evidence detail payloads MUST NOT embed suggested corrections.

---

## 24. Versioning

FROZEN:

1. Quality rule sets carry an explicit `quality_config_version`.
2. The mechanism follows the same pattern as P6-01C configuration versioning (registry config versions): declarative, identifiable, associated with each classification result.
3. Historical replay/version-history retention is NOT implemented by this contract (Planner decision, mirroring FP open item).
4. There is NO `algorithm_version` on observations. Quality versioning describes the RULE SET, not the data.
5. Changing rule sets creates a new config version; it does not retroactively rewrite prior classifications unless a Planner authorizes a migration.

---

## 25. Invariants

Each invariant is testable and implementation-independent where possible.

### Vocabulary & States

**DQ-01** — Quality states are exactly `VALID`, `INVALID`, `MISSING`, `UNKNOWN`. No other value is producible by any conforming implementation.

**DQ-02** — The states `AGING`, `INSUFFICIENT`, `DEGRADED`, `SUSPECT`, `UNAVAILABLE` MUST NOT appear anywhere in the quality vocabulary, including UI labels derived from quality.

### Independence

**DQ-03** — For any observation, quality status and freshness status are determined independently; no conforming implementation derives one from the other.

**DQ-04** — All 12 combinations of {VALID, INVALID, MISSING, UNKNOWN} × {FRESH, STALE, UNKNOWN} are representable without contradiction.

### Evidence Requirement

**DQ-05** — Every `INVALID` classification is backed by at least one evidence record with outcome `FAIL` from a check that actually executed. (FAIL evidence is a NECESSARY condition for INVALID, never by itself sufficient where a Planner-deferred mapping applies.)

**DQ-06** — Absence of evidence can never produce `INVALID`. With zero executed checks, the only permissible statuses are `MISSING` (value absent) or `UNKNOWN` (value present, unevaluable).

**DQ-07** — Every evidence record distinguishes `FAIL` (rule ran, violation evidenced) from `NOT_EVALUABLE` (assessment capability/evidence unavailable). No conforming implementation merges them.

**DQ-07a** — Check outcomes are evidence only: no outcome value (`PASS`, `FAIL`, `NOT_APPLICABLE`, `NOT_EVALUABLE`) may, by itself, determine the final quality state where this contract defers the evidence-to-state mapping to a Planner decision (PD-02, PD-03, PD-09). Deferred mappings MUST be external configuration, not evaluation logic.

### Missing Semantics

**DQ-08** — A field with no recorded value is classified `MISSING`, never `INVALID`.

**DQ-09** — Source/API failure (timeout, HTTP error, empty response) yields `MISSING` for affected fields, never `INVALID`.

### Unknown Semantics

**DQ-10** — `UNKNOWN` is reserved for cases where validity cannot be determined because the assessment evidence or capability is unavailable; a mere missing value never produces `UNKNOWN` at field level, and a present-but-malformed value produces FAIL evidence (with classification deferred), not automatic UNKNOWN.

**DQ-11** — Failures of the classification process itself (exception, crash, structural input collapse preventing even presence determination) produce `UNKNOWN` with evidence, never `VALID` and never a modified observation. Present-but-malformed VALUES do not fall under DQ-11; they follow the NUMERIC_PARSE path (Section 11).

**DQ-11a** — OHLC relational validation operates on validation groups keyed by `(entity_id, source, observed_at, timeframe)` over the member set {OPEN, HIGH, LOW, CLOSE}; it MUST NOT alter, merge, or extend P6-01B observation identity, and each member retains its own independent quality classification.

### No Correction

**DQ-12** — Quality classification MUST NOT mutate the observation: no substitution, interpolation, forward fill, clamping, source switching, correction, or deletion of recorded values.

### Temporal Boundary

**DQ-13** — Timestamp quality checks evaluate only timestamps that exist; tolerance windows are external rule configuration, never hard-coded in evaluation logic.

**DQ-14** — `collected_at` MUST NOT substitute for `observed_at` in any quality determination. When `observed_at` is UNKNOWN (P6-01B), temporal quality checks that require `observed_at` return `NOT_EVALUABLE`, and the observation's quality does not become INVALID because of the missing timestamp alone.

### Identity & Provenance

**DQ-15** — Quality attaches to observations via the frozen P6-01B identity `(entity_id, metric, source, observed_at, timeframe)`; quality classification never alters any component of that identity.

**DQ-16** — Every classification records the rule-set version (`quality_config_version`) used; classifications without an identifiable rule-set version are non-conforming.

**DQ-17** — Quality versioning uses its own namespace; it MUST NOT reuse, alias, or modify freshness `config_version` values.

### Duplicates & Partials

**DQ-18** — Duplicate handling remains governed by existing DB constraints; the quality layer detects and reports collisions on semantic identity but performs no remediation absent a Planner decision.

**DQ-19** — In a partial observation, the quality status of each present field is independent of absent sibling fields; absence of one field never downgrades another field's status.

### Boundaries

**DQ-20** — Quality classification MUST NOT alter P4/P5 outputs, decisions, vocabularies, or introduce BUY/SELL/action semantics.

**DQ-21** — Concrete numeric/timestamp/entity rule VALUES live in declarative rule configuration identified by `quality_config_version`; they MUST NOT be embedded in evaluation code paths.

**DQ-22** — `PRICE` is not classified as an independent metric; any quality result for `PRICE` is by definition the quality of `CLOSE`.

---

## 26. Open Planner Decisions

All items below are explicitly UNRESOLVED. None may be resolved during implementation without Planner authorization.

| ID | Question | Why it matters | Candidate options | Planner decision required |
|---|---|---|---|---|
| PD-01 | What constitutes INVALID per metric? (negative price, zero price, NaN-after-parse, etc.) | Defines core INVALID rules | Strict reject / lenient flag / per-metric matrix | YES |
| PD-02 | Final classification of present-but-malformed/unparseable values (NUMERIC_PARSE FAIL evidence) | Determines NaN/malformed-string final state. Evidence path is frozen (present value → FAIL); only the final mapping is open | INVALID / MISSING (automatic UNKNOWN is excluded by contract) | YES |
| PD-03 | OHLC violation scope: field-pair, all-OHLC, or whole observation? | Determines blast radius of relational violations | Pair / OHLC set / observation | YES |
| PD-04 | Negative-value policy for VOLUME, QUOTE_VOLUME, MARKET_CAP, FDV, OPEN_INTEREST | Sign rules per metric | INVALID / UNKNOWN / per-metric | YES |
| PD-05 | Zero-value policy per metric (legitimate for VOLUME/OI/FR=neutral; anomalous for prices/MC/FDV?) | Avoids false INVALID on legitimate zeros | Per-metric allow/deny matrix | YES |
| PD-06 | FUNDING_RATE acceptable range bounds | Prevents garbage rates while allowing negative normals | Symmetric bound / percentile / none | YES |
| PD-07 | Future-timestamp tolerance | Detects clock/anomaly corruption | Tolerance window / hard reject / warn-only | YES |
| PD-08 | Historical-timestamp tolerance | Detects stale-backfill mislabeled as new | Window / none | YES |
| PD-09 | Entity-resolution failure classification (MISSING vs dedicated check FAIL) | Affects entity coverage reporting | MISSING / INVALID / separate status | YES |
| PD-10 | Duplicate remediation policy (detect-only vs merge vs keep-latest) | Semantic identity collisions today | Detect-only / keep-latest / flag | YES |
| PD-11 | Cross-source consistency (Spot vs Futures disagreement) as a quality signal? | Could catch subtle corruption | On / off / advisory-only | YES |
| PD-12 | Quality computation timing: write-time, read-time, or both? | Performance vs freshness of classification | Write / read / hybrid | YES |
| PD-13 | Quality persistence model: inline column, side table, computed? | Schema design for P6-01D-D | Inline / side-table / virtual | YES |
| PD-14 | Should feature engine consume/gate on quality? | Downstream impact | Additive only / gating / weighted | YES |
| PD-15 | Quality aggregation formula: how do field statuses combine into observation status? | Single-status consumers need it | All-present-valid / threshold / worst-case | YES |
| PD-16 | Coexistence strategy with `dataCompleteness` / `confidenceScore` / `source_status` | Migration clarity | Coexist / extend / replace | YES |
| PD-17 | Retention/history of quality classifications and rule-set versions | Auditability vs cost | Keep history / latest-only | YES |
| PD-18 | Concrete rule values for every check category (ranges, bounds) once PD-01..08 shapes are chosen | Implementation needs numbers | Deferred until shapes frozen | YES |

---

## 27. Acceptance Criteria

- [x] Contract clearly defines VALID (§5.1)
- [x] Contract clearly defines INVALID (§5.1, §7)
- [x] Contract clearly defines MISSING (§5.1, §9)
- [x] Contract clearly defines UNKNOWN (§5.1, §9)
- [x] Quality/Freshness independence explicit (§8, DQ-03/DQ-04)
- [x] Source failure semantics explicit (§10, DQ-09)
- [x] Missing/Unknown distinction explicit (§9, DQ-08/DQ-10)
- [x] No-auto-correction invariant explicit (§19, DQ-12)
- [x] P6-01B identity preserved (DQ-15)
- [x] P6-01B observed_at semantics preserved (DQ-14)
- [x] P6-01C freshness preserved (§8, DQ-03/DQ-04/DQ-17)
- [x] All 10 canonical metrics covered (§2.2)
- [x] Candidate rules separated from frozen semantics (§5.2, §11–§14, §26)
- [x] No business thresholds invented (explicitly deferred, PD-18)
- [x] Invariants numbered and testable (DQ-01 … DQ-22)
- [x] Open Planner decisions documented (PD-01 … PD-18)
- [x] P4/P5 boundary preserved (§22, DQ-20)
- [ ] Only one file changed (verified at commit)

---

## 28. Freeze Checklist

| Item | Status |
|---|---|
| Vocabulary matches execution plan revision 01 | ✅ VALID/INVALID/MISSING/UNKNOWN |
| Obsolete states excluded | ✅ AGING/INSUFFICIENT/DEGRADED prohibited (DQ-02) |
| Freshness dimension untouched | ✅ References only; no redefinition |
| P6-01B compatibility verified | ✅ Identity, observed_at, provenance preserved |
| P6-01C compatibility verified | ✅ Registry sources, freshness states/versioning respected |
| P4/P5 boundary verified | ✅ No action/scoring semantics |
| Recon alignment | ✅ Built on P6-01D-A findings (G1–G15, SD-01–SD-15 carried into PD items) |
| Production changes | NONE |
| Schema changes | NONE |
| Migration | NONE |
| Tests | N/A — contract-only |
| Git boundary | This file only |

---

**END OF P6-01D-B — DATA QUALITY CONTRACT (DESIGN ONLY)**

Awaiting Planner audit before P6-01D-C (Planner Decision / Quality Rules).
