# P6-00 — Execution Plan Revision 01

**Status:** APPROVED EXECUTION OVERRIDE
**Phase:** P6
**Applies from:** P6-01D onward
**Parent:** `docs/P6_Upgrade/P6_00_EXECUTION_PLAN.md`

## 1. Purpose

This document is an authoritative execution-plan override for the parts of the original P6 execution plan affected by the completed P6-01C work.

Where this revision conflicts with the original P6-00 wording, this revision takes precedence.

## 2. P6-01C Closure

P6-01C — Source Registry + Freshness is complete and frozen.

Frozen components include:

- Source Registry contract and implementation;
- Freshness Policy contract;
- Freshness evaluator;
- Freshness V1 Planner Decision;
- SOURCE_SNAPSHOT cadence reconnaissance;
- V1 production freshness policies.

Frozen Freshness vocabulary:

```text
FRESH / STALE / UNKNOWN
```

Frozen V1 policies:

```text
DAILY: expected_interval = 24h, stale_after = 36h
4H:    expected_interval = 4h,  stale_after = 6h
SOURCE_SNAPSHOT production policies = 0
```

Freshness MUST NOT be redesigned under P6-01D.

## 3. P6-01D Scope Correction

The original P6-00 execution plan described P6-01D as a combined Freshness / Data Quality contract and referenced obsolete freshness states.

That definition is superseded.

**P6-01D is Data Quality only.**

Canonical Data Quality vocabulary is:

```text
VALID / INVALID / MISSING / UNKNOWN
```

Data Quality and Freshness are independent dimensions.

Valid combinations include:

```text
Freshness = FRESH   + Quality = INVALID
Freshness = STALE   + Quality = VALID
Freshness = UNKNOWN + Quality = UNKNOWN
```

The same `UNKNOWN` label in the two dimensions does not merge the dimensions and MUST NOT cause one dimension to be inferred from the other.

The obsolete Freshness vocabulary below MUST NOT be reintroduced:

```text
AGING
INSUFFICIENT
DEGRADED
```

## 4. P6-01D Execution Graph

```text
P6-01D-A
Data Quality Landscape Recon
        |
        v
P6-01D-B
Data Quality Contract
        |
        v
P6-01D-C
Planner Decision / Quality Rules
        |
        v
P6-01D-D
Data Quality Implementation
        |
        v
P6-01D-E
Tests + Regression
        |
        v
P6-01D-FINAL
Audit + Freeze
```

## 5. P6-01D-A — Data Quality Landscape Recon

The first executable task is reconnaissance only.

The Agent must inspect current implementation truth for:

- collector validation;
- normalization validation;
- database constraints;
- existing validation helpers;
- null handling;
- malformed payload handling;
- duplicate handling;
- timestamp validation;
- entity/symbol validation;
- metric-specific validation;
- existing quality flags/status fields;
- existing tests covering invalid or missing observations;
- current provenance behavior.

The Agent must distinguish:

1. behavior explicitly implemented in code;
2. behavior implied by database constraints;
3. behavior enforced only by tests;
4. behavior documented but not implemented;
5. behavior currently absent.

### Strict prohibition

P6-01D-A MUST NOT decide or freeze the semantic conditions for:

- `VALID`;
- `INVALID`;
- `MISSING`;
- `UNKNOWN`.

It may identify candidate rules and ambiguities, but those remain Planner decisions.

It MUST NOT modify production code, schema, collectors, APIs, P6-01B, P6-01C, P4, or P5.

## 6. Required Recon Output

Create:

`docs/P6_Upgrade/P6-01D-A_DATA_QUALITY_LANDSCAPE_RECON.md`

The report must contain:

1. executive summary;
2. observation validation paths;
3. collector/source behavior by source;
4. metric-specific validation evidence;
5. null/missing behavior;
6. malformed payload behavior;
7. duplicate behavior;
8. timestamp validation behavior;
9. database constraints relevant to quality;
10. existing quality-related fields/tables;
11. existing tests and coverage;
12. reuse candidates;
13. gaps;
14. candidate semantic decisions requiring Planner/Owner;
15. P3/P4/P5 boundary assessment;
16. exact files inspected;
17. verification evidence.

## 7. Acceptance Gate for P6-01D-A

PASS requires:

- current validation behavior is evidenced from source/tests/schema;
- collector behavior is traced rather than assumed;
- missing vs unknown behavior is explicitly reported;
- existing quality semantics are inventoried;
- no new production semantics are introduced;
- no production code/schema/API changes;
- no P3/P4/P5 changes;
- documentation is committed only within the assigned P6 documentation boundary;
- Git diff is clean and limited to the recon report.

A semantic ambiguity is a report finding, not an implementation authorization.

## 8. Authority Chain

```text
P6-01B Observation Contract      FROZEN
             |
             +---- P6-01C Source + Freshness   FROZEN
             |
             +---- P6-01D Data Quality
                         |
                         +-- Recon
                         +-- Contract
                         +-- Planner Decision
                         +-- Implementation
```

P6-01D must preserve the frozen P6-01B observation identity, timestamp semantics, provenance boundary and null semantics. It must preserve all frozen P6-01C Freshness semantics.

P6-01D must also preserve the frozen P4/P5 semantic boundary.

## 9. Next Task

The next executable task is **P6-01D-A**.

No P6-01D implementation is authorized until the Planner audits and accepts the P6-01D-A reconnaissance report and freezes the required contract/decision sequence.
