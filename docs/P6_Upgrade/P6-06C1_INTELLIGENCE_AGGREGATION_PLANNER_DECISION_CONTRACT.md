# P6-06C1 — Intelligence Aggregation Focused Planner Decision Contract

## 1. Executive Summary

This contract presents exactly the **5 blocking decisions** identified by P6-06C for Planner acceptance before P6-06D implementation.

**Source documents:**
- P6-06A Landscape Recon (9e217c1)
- P6-06B Semantic Contract (d5d0c6f)
- P6-06C Decision Inventory (f120a8b)

**Key numbers:**
- 5 blocking decisions requiring Planner acceptance
- 31 non-blocking decisions proceed on documented safe defaults
- 25 invariants (IA-01…IA-25) unchanged
- All decisions remain PROPOSED — none frozen by Agent

**Flow:**
```
P6-06A ✅ → P6-06B ✅ → P6-06C ✅ → P6-06C1 ← THIS
  ↓
PLANNER ACCEPTANCE (5 decisions) → P6-06D → P6-06E → P6-06-FINAL
```

---

## 2. Why Planner Decision Is Required

These 5 decisions define semantics for which no safe implementation default exists:

| Decision | Why Only Planner Can Decide |
|---|---|
| PD-06A-01 | The artifact definition IS the deliverable — scope cannot be presupposed |
| PD-06A-02 | Format choice is binary and architectural; determines P6-07 contract |
| PD-06A-03 | Draws the semantic line between synthesis and prohibited historical analytics (IA-15) |
| PD-06A-04 | Threshold choice materially changes user-visible behavior (which entities appear) |
| PD-06C-01 | Identity stability across refresh sequences is a semantic commitment affecting idempotency and uniqueness forever |

Each has an exact proposed resolution with documented rationale and alternatives. The Agent does NOT have authority to accept them.

---

## 3. Decision Inventory Summary

| Category | Count |
|---|---|
| Total decisions (P6-06A+B+C) | 36 |
| **Blocking (this contract)** | **5** |
| Non-blocking with safe defaults | 28 |
| Deferred | 3 |

Accepting the 5 blockers resolves all remaining semantic dependencies (mapping in §9).

---

## 4. PD-06A-01 — Summary Scope

**Question:** What exactly does P6-06 produce?

**Status: PROPOSED**

### Proposed Resolution

P6-06 produces a coherent intelligence summary per entity (coin or narrative), containing:

1. **Current state** (pass-through from frozen layers):
   - health_score, snapshot_confidence (P6-03, as-is)
   - regime_state, regime_confidence (P6-04, as-is)
2. **Warning synthesis** (read-only from P6-05):
   - active_warning_count, highest_severity, active_warnings
3. **Change detection** (computed vs immediate previous):
   - health_delta, health_change_pct, regime_changed, new/resolved warning counts
4. **Structured explanations:**
   - what_changed[], why[], what_to_watch[]
5. **Metadata + traceability:**
   - quality/freshness metadata, full provenance chain, standalone version tuple

Full artifact shape: P6-06B §20.

### Rationale

P6-03/04/05 alone answer isolated questions ("what is X?") but not the user questions ("what changed?", "why?", "what should I watch?"). This scope synthesizes without re-computing any upstream value.

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Warnings-only digest | Loses state context; regime+health are essential to "why" |
| Full historical trend report | Prohibited historical analytics (IA-15); P6-08 scope |

### Downstream Dependencies

→ Output artifact fields (P6-06B §20)
→ Explanation subsystem (PD-06A-02)
→ Persistence schema (`p6_intelligence_summaries`)
→ Partial-input behaviors (PD-06A-14…18)

---

## 5. PD-06A-02 — Explanation Format

**Question:** What format do explanations use?

**Status: PROPOSED**

### Proposed Resolution

Structured arrays of `ExplanationItem`:

```typescript
interface ExplanationItem {
  category: "HEALTH" | "REGIME" | "WARNING" | "QUALITY" | "FRESHNESS";
  text: string;              // template-rendered from evidence values only
  evidence_ref: string;      // provenance pointer to source artifact
  severity: Severity | null; // for ordering
}
```

Three fixed arrays: `what_changed[]`, `why[]`, `what_to_watch[]`.

Explanations MUST be:
- Deterministic (same evidence → same text)
- Template-derived (pure functions, NO LLM/free-form prose generation)
- Provenance-traceable (evidence_ref on every item)
- Bounded (cap: 10 items per array — PD-06B-08)
- Machine-readable (structured JSON for P6-07)

### Rationale

Master specification principle #3 separates raw data, derived metrics, and presentation language; #10 requires user comprehension. Template rendering satisfies both: deterministic and auditable, yet human-readable.

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| LLM-generated prose | Nondeterministic; violates IA-13/IA-17; unauditable |
| Free-form strings without structure | Not machine-readable; no provenance linkage |
| Unbounded lists | Noise flooding in high-warning environments |

### Downstream Dependencies

→ Explanation schema (jsonb storage shape)
→ Ordering rules (PD-06B-02: severity desc → recency desc → id asc)
→ Item caps (PD-06B-08)
→ Deterministic rendering guarantee (IA-17)
→ IA-25 (arrays always present, never omitted)

---

## 6. PD-06A-03 — Change Detection Window

**Question:** How far back does change detection compare?

**Status: PROPOSED**

### Proposed Resolution

Compare current aggregation against the **immediately previous aggregation snapshot only** (two-point comparison):

- Previous = most recent SUPERSEDED snapshot immediately preceding the current CURRENT snapshot
- Same entity, same snapshot type, DAILY timeframe
- Version difference allowed (recorded in provenance)
- Missing previous → change fields null; explanation notes "first evaluation"
- No historical multi-window comparison in V1
- Historical comparison remains outside P6-06 scope (P6-08)

### Rationale

Two-point comparison keeps P6-06 a synthesis layer. Multi-window analysis would silently convert it into a historical analytics engine, violating its non-goals and IA-15.

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| N-day rolling window | Creates historical analytics layer (prohibited); duplicates P6-08 |
| Trend-vector comparison | Requires multi-point data; same violation |

### Downstream Dependencies

→ Health delta / pct computation (PD-06C-03: delta/prev×100, prev=0→null)
→ Regime change detection (PD-06C-04: literal comparison incl. null↔value)
→ Warning new/resolved identification (PD-06C-05: window-bounded)
→ Top-N mover context (PD-06B-07 uses same two-point delta)
→ IA-15 enforcement

---

## 7. PD-06A-04 — Minimum Population

**Question:** When is a summary generated vs skipped?

**Status: PROPOSED**

### Proposed Resolution

At least ONE authoritative P6 input required:

- ≥1 of: current snapshot, current regime, ≥1 ACTIVE/recently-resolved warning

Empty population → NO summary persisted (no fabricated intelligence).

Additional rules:
- One input alone is sufficient (e.g., snapshot-only coin produces valid summary)
- Population size is DISTINCT from QualityState — INVALID inputs still count (IA-11)
- Missing values propagate as null; never invented (IA-16)
- Warnings-only population produces summary with health_score=null

### Rationale

Too-low threshold floods consumers with empty shells; too-high hides entities that have warnings but lagging snapshots. ≥1 authoritative input is the minimal honest boundary.

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| Require snapshot AND regime | Hides warnings-only entities entirely |
| Require all three inputs | Excessive; most entities lack some layer at bootstrap |
| Zero inputs → empty summary | Fabricates intelligence artifacts from nothing |

### Downstream Dependencies

→ Empty population boundary (no summary vs empty summary)
→ Missing-member handling (nulls propagate)
→ Summary existence semantics
→ Insufficient-data display ("data unavailable" via nulls, not invented values)

---

## 8. PD-06C-01 — window_end Provenance

**Question:** Where does summary `window_end` come from when population lacks a snapshot?

**Status: PROPOSED — NEW BLOCKER discovered by P6-06C**

### Problem

Summary identity (PD-06B-05) = `(entity_type, entity_id, timeframe, window_end)`.

When population includes a snapshot, `window_end = snapshot.window_end` is obvious.
But PD-06A-04 permits **warnings-only populations** (valid per minimum-population rule), which have no snapshot. Using wall-clock calculation_time would violate deterministic identity (explicitly rejected alternative in PD-06B-05).

Without resolution: identity, uniqueness constraint, idempotency, and IA-23 are undefined for a permitted population case.

### Proposed Resolution

Deterministic precedence chain:

```
1. snapshot.window_end            (if snapshot exists)
2. regime.calculation_time        (else, if regime exists)
3. max(warning.detection_window)  (else, if warnings exist)
```

This precedence is used consistently for:
- Summary identity
- Uniqueness constraint `(entity_type, entity_id, timeframe, window_end)`
- Idempotency (re-evaluation of same inputs → same window_end → supersession not duplication)
- Provenance recording
- Change detection windowing

Ties within step 3 broken by lowest warning id (consistent with global tie-break rule).

### Rationale

The chain follows input authority order (snapshot > regime > warnings), matching the pipeline hierarchy. Each step yields a value intrinsic to the artifact, never wall-clock. As snapshots accumulate, summaries naturally migrate to snapshot-derived windows.

### Alternatives Considered

| Alternative | Rejected Because |
|---|---|
| calculation_time (wall-clock) | Nondeterministic identity; repeated refresh creates unbounded rows |
| Require snapshot for identity | Contradicts PD-06A-04 warnings-only validity |
| Separate identity schemes per population type | Two identity systems = ambiguous uniqueness |

### Downstream Dependencies

→ Summary identity (PD-06B-05 becomes fully determinate)
→ Schema uniqueness constraint
→ Idempotency (PD-06C-02: supersede-not-duplicate)
→ IA-23 (deterministic window end) — enforceable ONLY after this decision
→ Latest-only/historical semantics (stable window keys enable clean supersession)

---

## 9. Dependency Matrix

### Blocker → Downstream Semantics

```
PD-06A-01 (scope)
    → output artifact fields (P6-06B §20)
    → explanation subsystem existence
    → persistence schema columns
    → resolves: PD-06A-14, 15, 16, 17, 18 (partial-input shapes)

PD-06A-02 (explanation format)
    → ExplanationItem schema
    → ordering rules (PD-06B-02 operative)
    → why-generation method (PD-06B-03 operative)
    → watch selection (PD-06B-04 operative)
    → item caps (PD-06B-08 operative)
    → ranking rules (PD-06A-11/12/13 operative)
    → IA-17, IA-25 enforceable

PD-06A-03 (change window)
    → health delta computation
    → PD-06C-03 (pct formula) operative
    → PD-06C-04 (regime change def) operative
    → PD-06C-05 (new/resolved warnings) operative
    → PD-06B-07 (movers context) operative
    → IA-15 enforceable

PD-06A-04 (minimum population)
    → empty-population boundary
    → warnings-only population validity
    → missing-member null propagation paths
    → insufficient-data display semantics
    → IA-11 enforceable

PD-06C-01 (window_end precedence)
    → PD-06B-05 (identity) fully determined
    → uniqueness constraint defined
    → PD-06C-02 (idempotency/supersession) operative
    → IA-23 enforceable
    → latest-only semantics stable
```

### Implicit Decisions Resolved Per Blocker

| Blocker Accepted | Resolves |
|---|---|
| PD-06A-01 | PD-06A-14…18 (5 implicit partial-input behaviors) |
| PD-06A-02 | PD-06B-02, 03, 04, 08 + PD-06A-11, 12, 13 (7 rules become operative) |
| PD-06A-03 | PD-06C-03, 04, 05 + PD-06B-07 (4 computations defined) |
| PD-06A-04 | Empty-population boundary + warnings-only validity |
| PD-06C-01 | PD-06B-05 + PD-06C-02 + IA-23 (identity/idempotency complete) |

**Result: 5 acceptances → 36/36 decisions fully determined.**

---

## 10. Invariant Impact

| Invariant | Tied To | Status |
|---|---|---|
| IA-01…IA-12 (Class-A boundary) | Frozen contract discipline | UNCHANGED |
| IA-13 (determinism) | PD-06A-02 + PD-06C-01 | UNCHANGED |
| IA-14 (health pass-through) | PD-06A-01 | UNCHANGED |
| IA-15 (two-point boundary) | PD-06A-03 | UNCHANGED |
| IA-16 (null propagation) | PD-06A-04 | UNCHANGED |
| IA-17 (template purity) | PD-06A-02 | UNCHANGED |
| IA-18…IA-22 | Existing semantics | UNCHANGED |
| **IA-23** (deterministic window end) | **PD-06C-01 explicitly** | ENFORCEABLE after acceptance |
| **IA-24** (idempotent re-evaluation) | **PD-06C-01 + PD-06C-02** | ENFORCEABLE after acceptance |
| **IA-25** (explanation arrays always present) | **PD-06A-02 explicitly** | ENFORCEABLE after acceptance |

All 25 invariants remain unchanged in meaning. None weakened.

---

## 11. P6-01…P6-05 Compatibility

| Phase | Check | Result |
|---|---|---|
| P6-01 | QualityState VALID/INVALID/MISSING/UNKNOWN preserved as metadata only | ✅ COMPATIBLE |
| P6-01 | No new QualityState (IA-05) | ✅ COMPATIBLE |
| P6-02 | Feature semantics untouched; no second scoring model | ✅ COMPATIBLE |
| P6-03 | Snapshot identity/lifecycle/weighting untouched; health pass-through (IA-14); market-cap weighting remains sole narrative authority | ✅ COMPATIBLE |
| P6-04 | RegimeState vocabulary displayed as-is; no recomputation (IA-19) | ✅ COMPATIBLE |
| P6-05 | Warning lifecycle/severity/dedup read-only (IA-18); no second warning engine | ✅ COMPATIBLE |

No dependency or semantic contradiction exists between these 5 decisions and any frozen phase.

---

## 12. P4 Boundary

| Check | Result |
|---|---|
| P6-06 modifies P4 | ❌ NEVER (IA-03) |
| P6-06 consumes P4 output | ❌ Not in V1 |
| P6-06 reinterprets P4 intelligence semantics | ❌ PROHIBITED |
| These 5 decisions affect P4 | ❌ NO |

---

## 13. P5 Boundary / Replay

| Check | Result |
|---|---|
| P6-06 modifies P5 | ❌ NEVER |
| BUY/SELL/trading/action/policy semantics | ❌ PROHIBITED (IA-02) |
| Consumes P5 decisions/actions/risk | ❌ PROHIBITED (IA-04) |
| P5 replay artifact contamination | ❌ PROHIBITED (IA-08) |
| These 5 decisions affect P5 | ❌ NO |

---

## 14. Legacy Boundary

| Component | Classification | Reaffirmed |
|---|---|---|
| Legacy narrative-health calculation (`src/lib/scoring/narrative-health.ts`) | **DO NOT USE** | ✅ IA-10 — equal-weight fallback conflicts with frozen PD-03B-04 market-cap weighting |
| Legacy `narrativeHealth` table | DO NOT USE | ✅ |
| P3 intelligence service | DO NOT USE | ✅ |
| P3 alert rules/history | DO NOT USE | ✅ |
| P4 explanation templates | DO NOT USE (P6-06 defines own templates) | ✅ |
| Dashboard/narrative API routes | ADAPT later (P6-07 migration) | ✅ Untouched by P6-06 |

No legacy component can silently alter P6-native meaning under any of these 5 decisions.

---

## 15. Planner Acceptance Gate

The Planner must explicitly decide each:

```
PD-06A-01: ACCEPT / REJECT / MODIFY     — summary scope
PD-06A-02: ACCEPT / REJECT / MODIFY     — explanation format (structured arrays)
PD-06A-03: ACCEPT / REJECT / MODIFY     — change detection window (two-point)
PD-06A-04: ACCEPT / REJECT / MODIFY     — minimum population (≥1 input)
PD-06C-01: ACCEPT / REJECT / MODIFY     — window_end precedence chain
```

### If REJECT or MODIFY

- Record the modification precisely
- Do NOT implement it
- Identify affected downstream decisions (per §9 mapping)
- Return affected decisions to recon/re-audit if the modification cascades

### Gate Condition

P6-06D implementation is permitted **ONLY when 5/5 decisions are ACCEPTED** (or modified with documented re-audit).

**The Agent does NOT mark these accepted. Planner action required.**

---

## 16. Post-Acceptance State

Once 5/5 accepted:

| Outcome | Detail |
|---|---|
| Blocking dependencies | ALL resolved — 36/36 decisions fully determined |
| Invariants | IA-23/24/25 become enforceable; IA-01…22 already specified |
| Implementation path | `src/lib/p6/summary/` module + additive `p6_intelligence_summaries` table |
| Refresh wiring | Synchronous after P6-05 (PD-06B-10 default stands unless overridden) |
| Next task | P6-06D — Intelligence Aggregation Implementation |

Non-blocking decisions proceed exactly as documented in P6-06C §3.3 (28 safe defaults).

---

## 17. Git Boundary

This document is the ONLY changed file:
- No production code
- No schema/migrations
- No API changes
- No test modifications
- No P6-01…05 modifications
- No P4/P5 modifications

---

## Verdict

**READY FOR PLANNER ACCEPTANCE**

5 blocking decisions presented with exact proposed resolutions, rationale, alternatives, and full downstream dependency mapping. Accepting them resolves all 36 decisions and unblocks P6-06D.
