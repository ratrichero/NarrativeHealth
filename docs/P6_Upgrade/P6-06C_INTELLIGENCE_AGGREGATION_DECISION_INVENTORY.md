# P6-06C — Intelligence Aggregation Decision Inventory & Gap Audit

## 1. Executive Summary

P6-06C reconciles all P6-06A/P6-06B decisions, discovers hidden implicit decisions, audits the four blocking decisions, verifies IA-01…IA-22, and produces the exact decision set required before Planner acceptance.

**Key findings:**

| Metric | Count |
|---|---|
| **Total decisions** | **36** |
| Explicit (carried forward: PD-06A-01…21) | 21 |
| Explicit (PD-06B-01…10) | 10 |
| **Newly discovered implicit (PD-06C-01…05)** | **5** |
| **Blocking** | **5** (4 confirmed + 1 NEW) |
| Non-blocking | 28 |
| Deferred | 3 |
| Invariants | 25 (IA-01…IA-22 verified + IA-23…IA-25 NEW) |
| Evidence gaps | 9 (0 blocking) |

### Critical Discovery

**PD-06C-01 (NEW BLOCKER): Summary window_end provenance.** The summary identity (PD-06B-05) requires `window_end`, but P6-06B does not define where window_end comes from when the primary input is not a snapshot (e.g., warnings-only population). Identity cannot be deterministically constructed without resolving this.

### Blocker Verification Result

The four P6-06A blockers are **confirmed genuinely blocking** — each defines semantics with no safe implementation default that avoids semantic ambiguity (analysis in §6).

---

## 2. P6-06A / P6-06B Reconciliation

| Source | Decisions | Status After Reconciliation |
|---|---|---|
| PD-06A-01…10 (explicit, P6-06A) | Carried into P6-06B unchanged | CONFIRMED consistent |
| PD-06A-11…18 (implicit, P6-06A) | Formalized as PROPOSED in P6-06B | CONFIRMED consistent |
| PD-06A-19…21 (deferred) | Unchanged | CONFIRMED |
| PD-06B-01…10 (new, P6-06B) | Verified against implementation reality | CONFIRMED consistent |
| New implicit (this audit) | 5 discovered | ADDED as PD-06C-01…05 |

No contradictions found between P6-06A and P6-06B. No decision ID collisions. All statuses remain PROPOSED/OPEN/DEFERRED — nothing frozen.

## 3. Complete Decision Inventory

### 3.1 Blocking Decisions (5)

| ID | Question | Proposed Resolution | Status | Why Blocking | Dependency |
|---|---|---|---|---|---|
| PD-06A-01 | Summary scope | Health + regime + warnings + changes + explanations (§20 artifact) | PROPOSED | Defines entire output artifact; no implementation possible without scope | None |
| PD-06A-02 | Explanation format | Structured arrays: what_changed[], why[], what_to_watch[] of ExplanationItem | PROPOSED | Defines structure consumed by P6-07; free-prose alternative changes determinism guarantees | PD-06A-01 |
| PD-06A-03 | Change detection window | Current vs immediate previous SUPERSEDED snapshot only | PROPOSED | Defines core "changed" semantics; alternatives silently create historical analytics engine | PD-06A-01 |
| PD-06A-04 | Minimum population | ≥1 of: current snapshot, current regime, ≥1 active/recent warning | PROPOSED | Determines generation-vs-skip boundary; affects every downstream consumer expectation | PD-06A-01 |
| **PD-06C-01** | **Where does summary window_end come from?** | **From current snapshot.window_end when snapshot exists; otherwise from latest input artifact's window/calculation time; warnings-only → most recent warning detection_window** | **PROPOSED** | **Identity (PD-06B-05) is undefined without a deterministic window_end source; idempotency and uniqueness constraints depend on it** | PD-06B-05 |

### 3.2 Newly Discovered Implicit Decisions (5)

| ID | Question | Proposed Resolution | Status | Blocking | Dependency |
|---|---|---|---|---|---|
| PD-06C-01 | Summary window_end provenance (see above) | Snapshot-first fallback chain | PROPOSED | **YES** | PD-06B-05 |
| PD-06C-02 | Idempotent re-run within same window: supersede or skip? | Supersede — re-run replaces CURRENT summary for same (entity, timeframe, window_end); deterministic because inputs identical → content identical | PROPOSED | NO — safe default (supersession preserves audit trail; skip loses correction ability) | PD-06B-06 |
| PD-06C-03 | `health_change_pct` formula and zero-denominator behavior | `(current - previous) / previous × 100` rounded to 2 decimals; previous = 0 or null → pct = null | PROPOSED | NO — safe default (null propagation per IA-16) | PD-06A-03 |
| PD-06C-04 | Does null→value (or INSUFFICIENT_DATA→value) count as `regime_changed`? | YES — any difference between previous and current regime values (including null↔value transitions) counts as change | PROPOSED | NO — safe default (literal comparison is simplest deterministic rule) | PD-06A-03 |
| PD-06C-05 | How are `new_warnings` identified and what bounds `resolved_warnings`? | new = ACTIVE warnings whose detection_window equals current summary window; resolved = RESOLVED warnings with effective_until after previous evaluation's calculated_at | PROPOSED | NO — safe default (deterministic, bounded to two-point comparison per IA-15) | PD-06A-03 |

### 3.3 Non-Blocking Decisions (28)

Carried forward with safe defaults (all PROPOSED):

| ID | Default |
|---|---|
| PD-06A-05 | Same model for coins/narratives |
| PD-06A-06 | All ACTIVE warnings displayed |
| PD-06A-07 | Latest-only persistence in p6_intelligence_summaries |
| PD-06A-08 | Synchronous after P6-05 |
| PD-06A-09 | Full provenance chain |
| PD-06A-10 | Standalone version tuple |
| PD-06A-11 | Severity desc → recency ranking |
| PD-06A-12 | Template-based why generation |
| PD-06A-13 | HIGH/CRITICAL + transitions watch selection |
| PD-06A-14–18 | Partial-input behaviors per P6-06B §18 |
| PD-06B-01 | No derived synthesis confidence V1 |
| PD-06B-02 | severity desc → recency desc → id asc |
| PD-06B-03 | Template fills, never LLM prose |
| PD-06B-04 | HIGH/CRITICAL → TRANSITIONING → deltas |
| PD-06B-05 | (entity_type, entity_id, timeframe, window_end) identity |
| PD-06B-06 | CURRENT \| SUPERSEDED lifecycle |
| PD-06B-07 | Top-N member movers as context only (N=5) |
| PD-06B-08 | Explanation cap = 10 items/array |
| PD-06B-09 | Stale inputs generate normally, metadata notes staleness |
| PD-06B-10 | Synchronous wiring after P6-05 |
| PD-06C-02…05 | Per §3.2 above |

### 3.4 Deferred Decisions (3)

| ID | Decision | Deferral |
|---|---|---|
| PD-06A-19 | Historical summary comparison | P6-08 |
| PD-06A-20 | Cross-entity correlation | V2 |
| PD-06A-21 | User acknowledgement workflow | V2 |

## 4. Explicit Decision Verification

All 31 explicit decisions (21 PD-06A + 10 PD-06B) verified for:
- Internal consistency: ✅ PASS
- Consistency with frozen P6-01…05 contracts: ✅ PASS
- No hidden reinterpretation of frozen vocabularies: ✅ PASS
- No ID collisions across phases: ✅ PASS

## 5. Implicit Decision Discovery Methodology

Systematic scan performed across the 40 semantic areas listed in the task specification. Results:

- **Areas fully specified by existing decisions:** 32
- **Areas requiring new explicit decisions:** 5 (→ PD-06C-01…05)
- **Areas collapsed into existing decisions:** 3 (empty-population ↔ PD-06A-04; no-change summaries ↔ §18 partial-input behaviors; conflicting-signals handling ↔ independent template rendering)

### Collapsed Areas Justification

1. **Empty/no-change summaries:** If nothing changed, explanation arrays are empty but summary persists with current state values. Covered by PD-06A-01 (scope includes state regardless of change) + §18. No separate decision needed.
2. **Conflicting signals** (e.g., HEALTH_IMPROVEMENT active while health dropped): Each warning/explanation item renders independently from its own evidence. Contradictions are surfaced, not resolved — resolution is a consumer concern. Covered by template purity (IA-17). No separate decision needed.
3. **Temporal alignment:** DAILY-only inherited from P6-03 V1; single-timeframe comparison eliminates alignment ambiguity. Covered by PD-06A-03.

## 6. Blocking Decision Audit

### PD-06A-01: Summary Scope — CONFIRMED BLOCKING

- **Implementation ambiguity:** Without accepted scope, module boundary, type definitions, and persistence schema cannot be written.
- **Downstream:** Every other decision depends on scope.
- **Affected invariants:** IA-13, IA-14, IA-16.
- **Safe default possible?** NO — the artifact definition IS the deliverable; there is no smaller implementable subset that doesn't presuppose the answer.
- **Planner acceptance required:** YES.

### PD-06A-02: Explanation Format — CONFIRMED BLOCKING

- **Implementation ambiguity:** Structured arrays vs prose changes the entire explanation subsystem, storage format (jsonb shape), and P6-07 contract.
- **Downstream:** PD-06B-02/03/04/08 all depend on format.
- **Affected invariants:** IA-17 (template purity).
- **Safe default possible?** NO — format choice is binary and architectural.
- **Planner acceptance required:** YES.

### PD-06A-03: Change Detection Window — CONFIRMED BLOCKING

- **Implementation ambiguity:** Two-point vs multi-point comparison determines whether P6-06 stays a synthesis layer or becomes historical analytics (prohibited by IA-15).
- **Downstream:** PD-06C-03, PD-06C-04, PD-06C-05.
- **Affected invariants:** IA-15.
- **Safe default possible?** NO — the boundary between synthesis and analytics is a semantic line only the Planner can draw.
- **Planner acceptance required:** YES.

### PD-06A-04: Minimum Population — CONFIRMED BLOCKING

- **Implementation ambiguity:** Generation-vs-skip boundary determines which entities appear in downstream UI; too-low produces noise, too-high hides entities.
- **Downstream:** Refresh wiring behavior, empty-population handling.
- **Affected invariants:** IA-11, IA-16.
- **Safe default possible?** NO — threshold choice materially changes user-visible behavior.
- **Planner acceptance required:** YES.

### PD-06C-01: Window End Provenance — NEWLY BLOCKING

- **Implementation ambiguity:** Summary uniqueness constraint `(entity_type, entity_id, timeframe, window_end)` requires a deterministic window_end. When snapshot exists → snapshot.window_end is obvious. But warnings-only population (valid per PD-06A-04) has no snapshot; using calculation_time would violate deterministic identity (rejected in PD-06B-05 alternatives).
- **Downstream:** PD-06B-05 (identity), PD-06C-02 (idempotency), schema uniqueness constraint.
- **Affected invariants:** IA-13 (determinism), IA-20 (lifecycle separation).
- **Safe default possible?** A fallback chain is proposed (snapshot.window_end → regime.calculation_time → max(warning.detection_window)), but the ORDER of the chain is a semantic choice affecting identity stability across refresh sequences. Planner should confirm.
- **Planner acceptance required:** YES.

**Result: 5 blockers total (4 confirmed + 1 newly promoted with documented justification).**

## 7. Aggregation Semantic Gap Audit

### HEALTH

| Aspect | Specified? | Location |
|---|---|---|
| Coin aggregation | ✅ Pass-through synthesis | P6-06B §9 |
| Narrative aggregation | ✅ Pass-through (member detail contextual only) | P6-06B §10 |
| Weighting | ✅ N/A — no re-weighting; P6-03 authoritative | P6-06B §10 |
| Missing members | ✅ Nulls propagate (IA-16) | P6-06B §18 |
| Invalid members | ✅ Noted in metadata, don't block | P6-06B §14 |
| UNKNOWN | ✅ Preserved as metadata | P6-06B §14 |
| Empty population | ✅ No summary generated | P6-06B §19 |

**Verdict: FULLY SPECIFIED.**

### REGIME

| Aspect | Specified? | Location |
|---|---|---|
| Display | ✅ As-is from P6-04 | P6-06B §11 |
| Aggregate computation | ✅ Prohibited in V1 | P6-06B §11 |
| Mixed/conflicting regimes | ✅ N/A — single entity-level state from P6-04 | Inherited design |
| UNKNOWN / INSUFFICIENT_DATA | ✅ Displayed as-is; missing ≠ UNKNOWN | P6-06B §11 |
| Transitions | ✅ Explained via why[] | PD-06A-12 |
| null→value change counting | ⚠️ Was underspecified → **RESOLVED by PD-06C-04** | This doc |

**Verdict: FULLY SPECIFIED (after PD-06C-04).**

### WARNINGS

| Aspect | Specified? | Location |
|---|---|---|
| Occurrence counting | ✅ active_warning_count | P6-06B §12 |
| Severity | ✅ Pass-through highest_severity | P6-06B §12 |
| Lifecycle | ✅ Read-only; P6-05 authoritative | P6-06B §12 |
| Duplicate handling | ✅ P6-05 dedup authoritative; no second layer | P6-06B §12 |
| Ranking | ✅ severity desc → recency desc → id asc | PD-06B-02 |
| Watch-item selection | ✅ PD-06B-04 | P6-06B §17 |
| new/resolved identification | ⚠️ Was underspecified → **RESOLVED by PD-06C-05** | This doc |

**Verdict: FULLY SPECIFIED (after PD-06C-05).**

### CONFIDENCE

| Aspect | Specified? | Location |
|---|---|---|
| Pass-through | ✅ Both confidences as-is | P6-06B §13 |
| Synthetic confidence | ✅ Prohibited V1 (PD-06B-01) | P6-06B §13 |
| Missing confidence | ✅ Null propagates | IA-16 |

**Verdict: FULLY SPECIFIED.**

### QUALITY / FRESHNESS

| Aspect | Specified? |
|---|---|
| Metadata only | ✅ |
| No new QualityState | ✅ IA-05 |
| Freshness independent | ✅ IA-06 |
| Infrastructure failure separation | ✅ IA-12 |

**Verdict: FULLY SPECIFIED.**

## 8. Coin Aggregation Audit

Coin model = pass-through synthesis of 4 inputs. No weighting, no member logic, no special cases. **FULLY SPECIFIED** — no gaps beyond those already tracked.

## 9. Narrative Aggregation Audit

| Check | Result |
|---|---|
| Member recomputation prohibited | ✅ P6-06B §10 |
| Membership source inherited from P6-03 (PD-03B-14) | ✅ |
| Legacy equal-weight fallback rejected | ✅ IA-10 |
| Top-N movers contextual only (N=5) | ✅ PD-06B-07 |
| Membership-change effects | ✅ Deferred (membership history is P6-08) |
| Missing members | ✅ Nulls propagate; P6-03 already excludes unusable members per IS-26 |

One residual note: top-N mover selection rule ("by health change") uses the same two-point delta as the summary itself — consistent with PD-06A-03. **No additional blocker.**

## 10. Warning Aggregation Audit

See §7 WARNINGS table. Fully specified after PD-06C-05. P6-05 remains sole authority for lifecycle/severity/dedup (IA-18).

## 11. Regime Aggregation Audit

See §7 REGIME table. Fully specified after PD-06C-04. P6-04 remains sole authority (IA-19).

## 12. Confidence Audit

Pass-through only. No synthetic confidence. Missing confidence → null. **FULLY SPECIFIED.**

## 13. Quality/Freshness Audit

Both remain orthogonal metadata. No new states. STALE never becomes INVALID. Infrastructure failure never becomes quality. **FULLY SPECIFIED** (verified via IA-05, IA-06, IA-12).

## 14. Missing/Invalid/UNKNOWN Audit

P6-06B §18 covers 7 scenarios. One scenario implicitly covered but worth making explicit here: **warnings-present-without-snapshot** — summary generates with health_score=null, warnings populated, explanations note unavailable health data. This follows directly from PD-06A-04 (≥1 input) + IA-16 (null propagation). **No new decision needed** — recorded as clarification, not gap.

## 15. Explanation Determinism Audit

| Property | Verified | Mechanism |
|---|---|---|
| Data-derived | ✅ | Templates fill from evidence values only |
| Template-derived | ✅ | Pure functions, no LLM/free inference |
| Deterministic | ✅ | Same evidence → same text |
| Provenance-traceable | ✅ | evidence_ref on every ExplanationItem |
| Deterministic ordering | ✅ | PD-06B-02: severity desc → recency desc → id asc |
| Maximum item count | ✅ | PD-06B-08: cap 10/array |
| Empty explanation behavior | ✅ | Empty arrays persisted (not omitted) |
| Category enum fixed order | ✅ | HEALTH → REGIME → WARNING → QUALITY → FRESHNESS |

**No LLM-generated prose anywhere. VERIFIED.**

## 16. Legacy Contamination Audit

Re-verified against repository:

| Component | Classification | Contamination Risk |
|---|---|---|
| `src/lib/scoring/narrative-health.ts` | DO NOT USE | Equal-weight fallback conflicts with frozen PD-03B-04 market-cap weighting. Guarded by IA-10. |
| Legacy `narrativeHealth` table | DO NOT USE | Different schema/algorithm entirely. |
| P3 intelligence service | DO NOT USE | P3-era view models. |
| P3 alert rules/history | DO NOT USE | User-rule alerts, unrelated semantics. |
| P4 decision support | DO NOT USE | Frozen interpretation layer; P6-06 must not feed or read it. |
| P5 action/policy/risk | DO NOT USE | Action semantics prohibited (IA-02, IA-04). |
| Dashboard route (`/api/dashboard`) | ADAPT (later, P6-07) | Currently reads legacy tables; untouched by P6-06. |
| `/api/narratives/[id]` | ADAPT (later, P6-07) | Same. |

**No legacy component can silently change P6-native meaning** — P6-06 modules will import exclusively from `src/lib/p6/*`.

## 17. IA-01…IA-22 Invariant Audit

| ID | Description | Status |
|---|---|---|
| IA-01 | Input authority (frozen outputs only) | PASS |
| IA-02 | No action semantics in output | PASS |
| IA-03 | P4 unmodified | PASS |
| IA-04 | No P5 consumption | PASS |
| IA-05 | No new QualityState | PASS |
| IA-06 | Freshness orthogonal | PASS |
| IA-07 | P6-01…05 frozen contracts unmodified | PASS |
| IA-08 | No P5 replay contamination | PASS |
| IA-09 | Standalone VersionTuple | PASS |
| IA-10 | Legacy narrative-health not authoritative | PASS |
| IA-11 | Population ≠ QualityState | PASS |
| IA-12 | Infra failure ≠ quality/content | PASS |
| IA-13 | Deterministic byte-identical output | PASS — strengthened by PD-06C-01 resolution requirement |
| IA-14 | Health pass-through, no second model | PASS |
| IA-15 | Two-point comparison only | PASS |
| IA-16 | Null propagation, no invention | PASS |
| IA-17 | Template-pure deterministic explanations | PASS |
| IA-18 | P6-05 semantics preserved read-only | PASS |
| IA-19 | Regime vocabulary preserved | PASS |
| IA-20 | Summary lifecycle distinct | PASS |
| IA-21 | Provenance real IDs, no fabrication | PASS |
| IA-22 | Coin/narrative parity | PASS |

**22/22 verified. 0 gaps, 0 contradictions.**

## 18. New Invariants

### IA-23: Deterministic Window End
**Rule:** Summary window_end MUST derive from input artifacts via a fixed, deterministic precedence (snapshot.window_end first; fallback per PD-06C-01 chain) — never from wall-clock calculation time.
**Class:** CLASS-A (boundary)
**Rationale:** Identity and idempotency depend on stable window_end.
**Validation:** Warnings-only population produces identical window_end on repeated evaluation.

### IA-24: Idempotent Re-Evaluation
**Rule:** Evaluating the same inputs twice within the same window MUST produce identical summary content; re-run supersedes rather than duplicates.
**Class:** CLASS-B (semantic)
**Rationale:** Repeated refresh must be safe (per P6-05 occurrence precedent).
**Validation:** Double-evaluation tests.

### IA-25: Explanation Arrays Always Present
**Rule:** Persisted summaries always contain all three explanation arrays (possibly empty); arrays are never omitted/null.
**Class:** CLASS-B (semantic)
**Rationale:** Stable consumer contract for P6-07.
**Validation:** Schema/persistence round-trip tests.

## 19. Evidence Gap Audit

| Gap | What's Missing | Matters Because | Blocking? | Proceed Without? |
|---|---|---|---|---|
| Explanation template wording validation | Production user feedback | Tuning only | NO | YES — templates correctable post-freeze via parameter_version |
| Production summary density | Real data volumes | Noise cap tuning (PD-06B-08) | NO | YES |
| P6-07 consumption contract | UI requirements doc | Output refinement | NO | YES — structured JSON is self-describing |
| Legacy dashboard migration plan | Transition schedule | Consumer cutover | NO | YES — explicitly P6-07 scope |
| Top-N mover optimal N | Usage data | PD-06B-07 tuning | NO | YES — N=5 safe default |
| Historical trend explanations | P6-08 artifacts | Deeper "why" | NO | YES — deferred by design |
| i18n/localization | Requirements | Future reach | NO | YES — English V1 |
| Summary retention policy | Archival requirements | Storage growth | NO | YES — append-only retains all; archival is P6-08 |
| Explanation template test coverage depth | Implementation-phase work | Quality assurance | NO | YES — P6-06E hardening scope |

**0 blocking evidence gaps.**

## 20. Dependency Matrix

```
BLOCKING LAYER
PD-06A-01 ──┬──► PD-06A-02 ──┬──► PD-06B-02/03/04/08 (explanation rules)
            │                └──► PD-06A-11/12/13 (ranking/why/watch)
            ├──► PD-06A-03 ──┬──► PD-06C-03 (pct formula)
            │                ├──► PD-06C-04 (regime change def)
            │                ├──► PD-06C-05 (new/resolved warnings)
            │                └──► PD-06B-07 (movers context)
            ├──► PD-06A-04 ──────► warnings-only population validity
            └──► PD-06B-05 (identity) ◄── PD-06C-01 (window_end source) ★NEW

NON-BLOCKING LAYER
PD-06A-07 (persistence) ──► PD-06B-06 (lifecycle) ──► PD-06C-02 (idempotency)
PD-06A-08 ──► PD-06B-10 (wiring point)

SCHEMA
All blocking + PD-06B-05 + PD-06C-01/02 ──► p6_intelligence_summaries DDL ──► P6-06D

INVARIANTS MAPPING
IA-13, IA-20 ← PD-06C-01, PD-06C-02
IA-15 ← PD-06A-03, PD-06C-03/04/05
IA-17 ← PD-06A-02, PD-06B-02/03/04/08
IA-16, IA-11 ← PD-06A-04
```

### Implicit Decision Resolution Map

Once the 5 blockers are accepted, these resolve automatically:

| Blocker Accepted | Implicit Decisions Resolved |
|---|---|
| PD-06A-01 | PD-06A-14/15/16/17/18 (partial-input shapes) |
| PD-06A-02 | PD-06B-02/03/04/08 become fully operative |
| PD-06A-03 | PD-06C-03/04/05 become fully operative |
| PD-06A-04 | Empty-population boundary fixed |
| PD-06C-01 | PD-06B-05 identity fully determined; IA-23 enforceable |

**Total: 28 non-blocking decisions carry exact defaults; only 5 require Planner action.**

## 21. Implementation Readiness

### P6-06D Prerequisites Checklist

| Requirement | Status |
|---|---|
| All blocking decisions identified | ✅ 5 blockers with exact proposals |
| No unresolved semantic ambiguity | ✅ All 40 scanned areas mapped |
| Aggregation semantics complete | ✅ §7–§14 audits |
| Explanation determinism verified | ✅ §15 |
| Coin/narrative symmetry verified | ✅ §8–§9 |
| Legacy contamination guarded | ✅ §16, IA-10 |
| All invariants verified/new-assigned | ✅ IA-01…IA-25 |
| Evidence gaps non-blocking | ✅ 0 blocking gaps |
| Safe defaults documented | ✅ 28 non-blocking defaults |
| P4/P5 boundaries clean | ✅ IA-03/04/08 |

### Verdict

**READY FOR P6-06C1**

The focused Planner Decision Contract should present exactly these 5 decisions:

1. **PD-06A-01** — Summary scope (health + regime + warnings + changes + explanations)
2. **PD-06A-02** — Explanation format (structured ExplanationItem arrays)
3. **PD-06A-03** — Change detection (current vs immediate previous only)
4. **PD-06A-04** — Minimum population (≥1 authoritative input)
5. **PD-06C-01** — Window end precedence (snapshot → regime → max warning detection_window)

Accepting these 5 resolves all remaining semantics. The other 28 non-blocking decisions proceed on documented safe defaults.

## 22. Git Boundary

This document is the ONLY changed file. No production code, schema, migrations, API changes, test modifications, or frozen-contract edits.
