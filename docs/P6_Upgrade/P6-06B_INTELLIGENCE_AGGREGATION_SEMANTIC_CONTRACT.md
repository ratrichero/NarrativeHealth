# P6-06B — Intelligence Aggregation Semantic Contract

## 1. Executive Summary

P6-06 is the **Intelligence Aggregation & Explainability** layer — the mechanism that synthesizes P6-03 snapshots, P6-04 regimes, and P6-05 warnings into a coherent intelligence view with deterministic, structured explanations.

**Contract status:** PROPOSED — no decisions frozen. Planner acceptance required before P6-06D implementation.

**Key numbers:**
- 4 blocking decisions carried forward (PD-06A-01…04)
- 10 new decisions discovered during contract formalization (PD-06B-01…10)
- 24 total decisions
- 4 blocking / 17 non-blocking / 3 deferred
- 22 invariants (IA-01…IA-22): 12 Class-A (boundary), 10 Class-B (semantic)

---

## 2. Contract Status

| Aspect | Status |
|---|---|
| Semantic contract | PROPOSED |
| Decisions | PROPOSED / OPEN / DEFERRED only |
| Frozen decisions | NONE by Agent |
| Implementation | NOT STARTED |
| Schema | NOT MODIFIED |

Only the Planner may ACCEPT/FREEZE decisions.

## 3. P6-06 Purpose

Combine authoritative P6-native artifacts into a coherent intelligence view and explain:

- **WHAT CHANGED** — delta since previous evaluation
- **WHY IT CHANGED** — causal chain from warnings/regime/snapshot
- **WHAT TO WATCH** — prioritized attention items

P6-03 says "health = 72". P6-04 says "STABLE". P6-05 says "deteriorated 12 points". P6-06 says: "Health dropped to 72 from 84; regime remains STABLE with declining confidence; watch CONFIDENCE_DETERIORATION — if health falls below 60, regime transition to WEAK is likely."

## 4. Scope

| In Scope (V1) | Out of Scope |
|---|---|
| Intelligence summary per entity | Historical comparison (P6-08) |
| Change detection vs previous | Cross-entity correlation (V2) |
| Structured explanations | User acknowledgement (V2) |
| Full provenance chain | Notification delivery (P6-07) |
| Coin + narrative parity | New health scoring |
| Latest-only persistence | New regime detection |
| Synchronous refresh integration | New warning generation |

## 5. Non-Goals

P6-06 is **NOT**:

- ❌ BUY/SELL engine
- ❌ Trading signal engine
- ❌ Action engine
- ❌ Policy engine
- ❌ P5 bridge
- ❌ Decision engine
- ❌ Historical intelligence engine (P6-08)
- ❌ Replacement for P6-03 health scoring
- ❌ Replacement for P6-04 regime detection
- ❌ Replacement for P6-05 warning generation
- ❌ Legacy narrative-health engine

P6-06 does not create a second health score. It consumes the frozen P6-03 health score as-is.

## 6. Layer Position

```
P6-01 Observation → P6-02 Feature → P6-03 Snapshot → P6-04 Regime → P6-05 Warning
                                                                            ↓
                                                              P6-06 Intelligence Summary
                                                                            ↓
                                                              P6-07 UI / Dashboard
```

P6-06 sits strictly above P6-05. It consumes frozen outputs and produces a synthesis artifact for downstream UI consumption.

## 7. Input Authority

### Authoritative Inputs

| Input | Source Layer | Classification |
|---|---|---|
| Current snapshot (health_score, dimensions, confidence) | P6-03 | AUTHORITATIVE |
| Previous snapshot | P6-03 persistence | AUTHORITATIVE |
| Current regime state + confidence | P6-04 | AUTHORITATIVE |
| Previous regime state | P6-04 persistence | AUTHORITATIVE |
| Active warnings | P6-05 | AUTHORITATIVE |
| Recently resolved warnings | P6-05 | AUTHORITATIVE |
| Quality metadata | P6-03 | AUTHORITATIVE (metadata) |
| Freshness metadata | P6-03 | AUTHORITATIVE (metadata) |

### Explicitly Rejected Inputs

| Input | Classification | Reason |
|---|---|---|
| Legacy `narrativeHealth` table | DO NOT USE | P3-era calculation, different algorithm |
| Legacy `src/lib/scoring/narrative-health.ts` | DO NOT USE | Different aggregation semantics |
| P3 intelligence service | DO NOT USE | Semantically incompatible |
| P4 explanation templates | DO NOT USE | P3-era, frozen in P4 context |
| P5 decisions/risk | DO NOT USE | P6 must not consume action semantics |

### Metadata Inputs

Coin/narrative metadata tables (`coins`, `narratives`) are READ-ONLY for display names only — never semantic sources.

## 8. Input Artifact Contract

Each input consumed by P6-06 MUST be read via the frozen persistence layers:

```typescript
// P6-03: latest CURRENT snapshot for entity
readCurrentSnapshot(entityType, entityId) → CoinSnapshotOutput | NarrativeSnapshotOutput | null

// P6-03: previous SUPERSEDED snapshot (for change detection)
readPreviousSnapshot(entityType, entityId) → SnapshotOutput | null

// P6-04: current CURRENT regime
readCurrentRegime(entityType, entityId) → RegimeState | null

// P6-05: all ACTIVE warnings
readActiveWarnings(entityType, entityId) → WarningRecord[]

// P6-05: recently RESOLVED warnings (for "what changed")
readRecentlyResolvedWarnings(entityType, entityId) → WarningRecord[]
```

No direct SQL against legacy tables. No approximate joins.

## 9. Coin Aggregation Contract

Coin aggregation is **synthesis**, not mathematical aggregation:

```
Coin Intelligence Summary =
    f(current coin snapshot,
      previous coin snapshot,
      current coin regime,
      active coin warnings)
```

The health_score passes through unchanged from P6-03. No new health model. No re-weighting. No reinterpretation.

## 10. Narrative Aggregation Contract

Narrative aggregation follows the same synthesis model as coins:

```
Narrative Intelligence Summary =
    f(current narrative snapshot,
      previous narrative snapshot,
      current narrative regime,
      active narrative warnings)
```

### Critical Boundary

**P6-06 does NOT perform member-level narrative aggregation.** The market-cap weighted narrative health score was already computed by P6-03 (PD-03B-04, FROZEN). P6-06 consumes that score as-is.

Member-level detail (top movers, weakest members) may be included as EXPLANATION CONTEXT but never as recomputed health.

### Membership Source

Membership semantics are inherited from P6-03 (PD-03B-14: live `coin_narratives`). P6-06 does not redefine membership.

### Legacy Weighting Prohibited

Legacy `calculateWeightedNarrativeHealth()` (equal-weight fallback, different thresholds) MUST NOT become authoritative. The frozen P6-03 market-cap weighting is sole authority.

## 11. Regime Synthesis Contract

P6-06 reads the frozen P6-04 regime state per entity.

**No aggregate regime computation across members in V1.** A narrative's regime comes from P6-04's narrative-level regime detection (which itself consumes narrative snapshots). P6-06 displays this state and explains transitions — it never computes a second regime.

Regime vocabulary remains exactly:
```
STRONG | STABLE | WEAK | TRANSITIONING | INSUFFICIENT_DATA | UNKNOWN
```

If regime input is missing, the summary records `regime_state = null` with metadata noting unavailability — it does NOT invent UNKNOWN as a substitute unless the source itself reported UNKNOWN.

## 12. Warning Synthesis Contract

P6-06 represents P6-05 warnings without recreating warning logic:

| Field | Source |
|---|---|
| `active_warning_count` | Count of ACTIVE warnings |
| `highest_severity` | Max severity among ACTIVE warnings (null if none) |
| `active_warnings` | Ordered list of ACTIVE warnings |
| `new_warnings` | Warnings detected in current window not present in previous |
| `resolved_warnings` | Warnings resolved since previous evaluation |

### Constraints

- Warning lifecycle is NOT modified by P6-06 (EW-inheritance: lifecycle belongs to P6-05)
- Resolved/SUPERSEDED warnings appear only in change summaries, never as active
- No second dedup layer — P6-05 dedup is authoritative
- No severity recalculation — P6-05 severity is authoritative

## 13. Confidence Contract

**V1: pass-through only.** P6-06 reports:

- `snapshot_confidence` — from P6-03 (as-is)
- `regime_confidence` — from P6-04 (as-is)

**PD-06B-01 (NEW):** Whether P6-06 derives a synthesis confidence is OPEN. Proposed: NO new confidence in V1 — derived confidence would create a second scoring model. DEFERRED to V2 if needed.

## 14. Quality Contract

Quality vocabulary remains exactly:

```
VALID | INVALID | MISSING | UNKNOWN
```

- Quality is METADATA in P6-06 — preserved in provenance, never used to gate/weight/derive summaries
- No new QualityState (IA-05)
- Infrastructure failure NEVER becomes DATA_QUALITY_DEGRADATION or any quality value
- INVALID inputs do not block summary generation; they are noted in metadata

## 15. Freshness Contract

Freshness remains independent from quality:

- `FRESH | STALE | UNKNOWN` preserved as metadata
- STALE ≠ INVALID (never conflated)
- Stale inputs still generate summaries (no suppression in V1)
- Freshness metadata recorded in summary provenance
- No freshness weighting (IA-06)

## 16. Change Detection Contract

**PD-06A-03 (BLOCKING):** Change detection compares **current vs previous only**.

### Formal Definition of "Previous"

| Dimension | Definition |
|---|---|
| Same entity | (entity_type, entity_id) identical |
| Same snapshot type | COIN_HEALTH vs COIN_HEALTH; NARRATIVE_HEALTH vs NARRATIVE_HEALTH |
| Selection rule | Most recent SUPERSEDED snapshot immediately preceding the current CURRENT snapshot |
| Version difference | Allowed — version recorded in provenance; comparison still valid |
| Timeframe | DAILY only (inherited from P6-03 V1) |
| Missing previous | Change fields = null; explanations note "first evaluation" |

### Boundary

- P6-06 compares exactly TWO points: current + immediate previous
- Multi-point trend analysis is P6-08 scope
- P6-06 MUST NOT silently become a historical analytics engine (IA-15)

## 17. Explanation Contract

**PD-06A-02 (BLOCKING):** Explanations are structured, deterministic arrays — never free-form prose.

```typescript
interface Explanation {
  what_changed: ExplanationItem[];
  why: ExplanationItem[];
  what_to_watch: ExplanationItem[];
}

interface ExplanationItem {
  category: "HEALTH" | "REGIME" | "WARNING" | "QUALITY" | "FRESHNESS";
  text: string;              // template-rendered, evidence-filled
  evidence_ref: string;      // provenance pointer to source artifact
  severity: Severity | null; // for ordering
}
```

### Generation Rules (PROPOSED — PD-06B-02…04)

| Rule | Source |
|---|---|
| what_changed items ranked by severity desc, then recency desc | PD-06B-02 |
| why items generated from template fills (regime transition + warning triggers + health delta), never LLM/free inference | PD-06B-03 |
| what_to_watch selected from HIGH/CRITICAL warnings first, then TRANSITIONING regime, then notable deltas | PD-06B-04 |

Templates are pure functions of evidence values. Every sentence reconstructible from actual artifact values (pattern consistent with system principle #3).

## 18. Missing / Invalid / UNKNOWN Contract

| Scenario | Summary Behavior |
|---|---|
| No snapshot, no regime, no warnings | NO summary generated (below minimum population) |
| Snapshot present, no regime | Summary generated; regime_state = null; explanation notes unavailable regime |
| Snapshot present, no warnings | Summary generated; warning_count = 0 |
| INVALID current snapshot | Summary generated from snapshot values as-is; quality metadata notes INVALID |
| MISSING snapshot (gap) | If previous exists, change fields note gap; summary uses available data |
| UNKNOWN quality | Summary generated normally; quality metadata notes UNKNOWN |
| All inputs STALE | Summary generated; freshness metadata notes staleness |

Missing data NEVER becomes invented data. Nulls propagate honestly.

## 19. Minimum Population Contract

**PD-06A-04 (BLOCKING):** A summary requires at least ONE authoritative input:

- ≥1 of: current snapshot, current regime, or ≥1 ACTIVE/recently-resolved warning

Empty population (zero inputs) → NO summary persisted.

One-member population is valid (a coin with only a snapshot produces a valid summary).

Population size is distinct from QualityState — a single INVALID snapshot still counts as population (IA-11).

## 20. Output Artifact Contract

```typescript
interface IntelligenceSummary {
  // Identity (§21)
  entity_type: "coin" | "narrative";
  entity_id: number;
  
  // Current state (pass-through from frozen layers)
  health_score: number | null;           // from P6-03, as-is
  snapshot_confidence: number | null;    // from P6-03, as-is
  regime_state: string | null;           // from P6-04, as-is
  regime_confidence: number | null;      // from P6-04, as-is
  
  // Warning synthesis (from P6-05, as-is)
  active_warning_count: number;
  highest_severity: Severity | null;
  active_warnings: WarningSummary[];
  
  // Change detection (computed vs previous)
  health_delta: number | null;
  health_change_pct: number | null;
  regime_changed: boolean;
  previous_regime_state: string | null;
  new_warning_count: number;
  resolved_warning_count: number;
  
  // Explanation output
  what_changed: ExplanationItem[];
  why: ExplanationItem[];
  what_to_watch: ExplanationItem[];
  
  // Metadata
  quality_metadata: Record<string, unknown> | null;
  freshness_metadata: Record<string, unknown> | null;
  
  // Traceability
  provenance: SummaryProvenance;
  version: SummaryVersionTuple;
  
  // Timestamps
  calculated_at: Date;
  window_end: Date;
}
```

## 21. Identity Contract

**PD-06B-05 (NEW):** Summary identity follows the P6-03/P6-04 pattern:

```
SummaryIdentity = (entity_type, entity_id, timeframe, window_end)
```

- One summary per entity per DAILY window
- Distinct from snapshot identity (different semantic domain)
- Distinct from regime identity
- Distinct from warning occurrence identity

## 22. Version Contract

**PD-06A-10:** Standalone version tuple:

```typescript
interface SummaryVersionTuple {
  readonly algorithm_version: string;   // "p6-summary-v1"
  readonly parameter_version: string;   // explanation config version
  readonly schema_version: string;      // "v1"
  readonly config_hash: string;
}
```

Independent from feature/snapshot/regime/warning version tuples. Version changes invalidate/recalculate downstream deterministically (IA-09).

## 23. Provenance Contract

Minimum provenance (full chain per PD-06A-09):

```typescript
interface SummaryProvenance {
  source_layer: "P6-06";
  entity: { entity_type; entity_id };
  input_snapshot_id: number | null;
  input_snapshot_window_end: Date | null;
  previous_snapshot_id: number | null;
  input_regime_id: number | null;
  input_warning_ids: number[];
  calculation_time: Date;
  window_end: Date;
  summary_version: SummaryVersionTuple;
  upstream_versions: {
    snapshot_version: SnapshotVersionTuple | null;
    regime_version: RegimeVersionTuple | null;
    warning_version: WarningVersionTuple | null;
  };
  quality_summary: Record<string, unknown> | null;
  freshness_summary: Record<string, unknown> | null;
}
```

No fabricated IDs. Missing references recorded as null, never synthesized.

## 24. Lifecycle Contract

**PD-06B-06 (NEW):** Summary lifecycle has exactly 2 states:

```
CURRENT | SUPERSEDED
```

- New summary supersedes existing CURRENT summary for same entity
- SUPERSEDED is terminal
- Lifecycle is independent from QualityState, RegimeState, WarningLifecycle, SnapshotStatus

## 25. Persistence Contract

**PD-06A-07:** New table `p6_intelligence_summaries`:

| Property | Value |
|---|---|
| Uniqueness | (entity_type, entity_id, timeframe, window_end) |
| Latest-only | YES — status CURRENT/SUPERSEDED |
| Append-only | Partial — rows never deleted; status updated |
| Historical | Deferred (P6-08) |
| Idempotency | Same inputs + same versions → same summary; re-run replaces via supersession |
| Failure semantics | Persistence failure = infrastructure failure; returns error/null; NEVER converted to quality or summary content (IA-16) |

## 26. Determinism Contract

Same authoritative inputs + same versions + same configuration → same summary, byte-for-byte.

| Element | Deterministic Rule |
|---|---|
| Member/warning ordering | Sort by id ascending before processing |
| Explanation ordering | severity desc → recency desc → category order (fixed enum order) |
| Tie-breaking | Lower artifact id wins |
| Rounding | Health delta rounded to 2 decimals (consistent with P6-03) |
| Empty population | No summary (not empty summary) |
| Template rendering | Pure function of evidence values |
| No wall-clock dependency | calculated_at is input, not classification input |

## 27. Replay Boundary

- P6-06 summaries are NOT part of the P5 replay artifact chain
- Recomputation of a summary from stored inputs is deterministic (replay-safe by construction)
- Historical summaries are NOT retroactively recalculated when versions change
- P6-06 never writes to P5 tables

## 28. P4 Boundary

| Check | Requirement |
|---|---|
| Modify P4 | ❌ PROHIBITED (IA-03) |
| Consume P4 output | ❌ Not in V1 |
| Reinterpret P4 intelligence semantics | ❌ PROHIBITED |
| Produce P4 input | ❌ No |

## 29. P5 Boundary

| Check | Requirement |
|---|---|
| Modify P5 | ❌ PROHIBITED (IA-03) |
| Consume P5 actions/decisions/risk | ❌ PROHIBITED (IA-04) |
| Produce BUY/SELL/action/policy | ❌ PROHIBITED (IA-02) |
| Contaminate P5 replay artifacts | ❌ PROHIBITED (IA-17) |
| Become a P5 bridge | ❌ PROHIBITED |

## 30. Backward Compatibility

- Existing consumers (`/api/dashboard`, `/api/narratives/[id]`, `/api/coins/[id]`) remain untouched
- P6-06 output is additive — new table, new module
- Legacy narrative health continues operating until P6-07 migration (explicitly out of scope here)
- No legacy table becomes a P6-06 semantic source

## 31. Decision Inventory

### Carried Forward from P6-06A (unchanged IDs)

| ID | Question | Proposed Resolution | Status | Blocking |
|---|---|---|---|---|
| PD-06A-01 | Summary scope | Health + regime + warnings + changes + explanations | PROPOSED | YES |
| PD-06A-02 | Explanation format | Structured arrays (what_changed/why/what_to_watch) | PROPOSED | YES |
| PD-06A-03 | Change detection window | Current vs immediate previous only | PROPOSED | YES |
| PD-06A-04 | Minimum population | ≥1 authoritative input | PROPOSED | YES |
| PD-06A-05 | Coin/narrative model | Same model, entity_type param | PROPOSED | NO |
| PD-06A-06 | Warning display threshold | All ACTIVE warnings | PROPOSED | NO |
| PD-06A-07 | Persistence model | Latest-only, p6_intelligence_summaries | PROPOSED | NO |
| PD-06A-08 | Refresh timing | Synchronous after P6-05 | PROPOSED | NO |
| PD-06A-09 | Provenance depth | Full chain | PROPOSED | NO |
| PD-06A-10 | Version tuple | Standalone 4-field tuple | PROPOSED | NO |
| PD-06A-11 | Change ranking | Severity desc, then recency | PROPOSED | NO |
| PD-06A-12 | Why generation | Template-based from triggers | PROPOSED | NO |
| PD-06A-13 | Watch selection | HIGH/CRITICAL warnings + transitions | PROPOSED | NO |
| PD-06A-14–18 | Partial-input behaviors | Per §18 | PROPOSED | NO |
| PD-06A-19–21 | Historical/correlation/ack | DEFERRED | DEFERRED | — |

### New Decisions Discovered During Formalization

| ID | Question | Proposed Resolution | Rationale | Alternatives | Dependency | Status | Blocking |
|---|---|---|---|---|---|---|---|
| PD-06B-01 | Derived synthesis confidence? | NO in V1 — pass-through only | Avoids second scoring model | Derive weighted confidence | None | PROPOSED | NO |
| PD-06B-02 | What-changed ranking rule | severity desc → recency desc → id asc | Deterministic, user-relevant first | Chronological only | PD-06A-02 | PROPOSED | NO |
| PD-06B-03 | Why-generation method | Template fills from regime transitions + warning triggers + deltas | Deterministic, auditable | LLM prose (rejected — nondeterministic) | PD-06A-02 | PROPOSED | NO |
| PD-06B-04 | Watch-item selection | HIGH/CRITICAL warnings → TRANSITIONING regime → material deltas | Prioritizes attention | All warnings equally | PD-06A-02 | PROPOSED | NO |
| PD-06B-05 | Summary identity tuple | (entity_type, entity_id, timeframe, window_end) | Consistent with P6-03 pattern | calculation_time-based (rejected — nondeterministic identity) | PD-06A-01 | PROPOSED | YES→NO* |
| PD-06B-06 | Summary lifecycle states | CURRENT \| SUPERSEDED | Consistent with P6-03/04 | 3+ states (rejected — unnecessary) | PD-06A-07 | PROPOSED | NO |
| PD-06B-07 | Narrative member detail in summary | Include top-N member movers as explanation context only | Useful for narrative "why" without recomputing health | Full member listing (deferred) | PD-06A-05 | PROPOSED | NO |
| PD-06B-08 | Explanation item count cap | Cap at 10 items per array | Prevents noise flooding | Unlimited (rejected — noise) | PD-06A-02 | PROPOSED | NO |
| PD-06B-09 | Stale-input summary behavior | Generate normally, note staleness in metadata | Graceful degradation (master principle #8) | Suppress on stale (rejected — data loss) | §15 | PROPOSED | NO |
| PD-06B-10 | Refresh integration wiring point | After P6-05 in refresh pipeline, synchronous | Pipeline ordering integrity | Async job (rejected — complexity) | PD-06A-08 | PROPOSED | NO |

*PD-06B-05 blocks schema design but has an exact proposed resolution; classified non-blocking-with-default contingent on PD-06A-01 acceptance.*

## 32. Blocking Decisions

| ID | Question | Why Blocking |
|---|---|---|
| PD-06A-01 | Summary scope | Defines the entire output artifact |
| PD-06A-02 | Explanation format | Defines structure consumed by P6-07 |
| PD-06A-03 | Change detection window | Defines core "changed" semantics |
| PD-06A-04 | Minimum population | Determines generation vs skip boundary |

All four have exact proposed resolutions documented above. Planner acceptance required.

## 33. Non-Blocking Decisions

PD-06A-05…18, PD-06B-01…10 — all have safe V1 defaults documented in §31.

## 34. Deferred Decisions

| ID | Decision | Deferral |
|---|---|---|
| PD-06A-19 | Historical summary comparison | P6-08 |
| PD-06A-20 | Cross-entity correlation | V2 |
| PD-06A-21 | User acknowledgement workflow | V2 |

## 35. Evidence Gaps

| Gap | Impact | Blocking |
|---|---|---|
| Explanation template quality needs production validation | Tuning only | NO |
| Production warning density affects summary noise | Cap tuning (PD-06B-08) | NO |
| P6-07 UI consumption contract undefined | Output format refinement | NO |
| Legacy dashboard migration timing | Consumer transition plan | NO |
| Member-mover count (N) tuning | PD-06B-07 default N=5 | NO |
| Historical "trend" explanations | P6-08 dependency | NO |
| Explanation localization/i18n | Future requirement | NO |
| Summary retention policy | P6-08 archival | NO |

## 36. Invariants

### Class-A Invariants (Boundary)

| ID | Rule | Validation |
|---|---|---|
| IA-01 | P6-06 consumes ONLY frozen P6-03/04/05 outputs; no legacy semantic source | Import audit; no legacy table reads |
| IA-02 | P6-06 output contains NO BUY/SELL/trading/action/policy/approval fields | Output field audit; string scan tests |
| IA-03 | P6-06 does NOT modify P4 contracts, implementation, or behavior | P4 regression suite passes unchanged |
| IA-04 | P6-06 does NOT consume P5 decisions/actions/risk as inputs | No P5 imports in P6-06 modules |
| IA-05 | P6-06 introduces NO new QualityState; quality remains VALID/INVALID/MISSING/UNKNOWN | Type audit |
| IA-06 | Freshness remains orthogonal; STALE never becomes INVALID or suppresses summaries | Behavior tests |
| IA-07 | P6-06 does NOT modify frozen P6-01…05 contracts, invariants, vocabularies, or implementations | Diff audit; full regression |
| IA-08 | P6-06 does NOT contaminate P5 replay artifact chain | No P5 table writes |
| IA-09 | Summary VersionTuple is standalone; no inheritance from other layer versions | Type audit |
| IA-10 | Legacy narrative-health calculation MUST NOT become authoritative for P6-06 | No import of scoring/narrative-health |
| IA-11 | Population size is distinct from QualityState; INVALID inputs still satisfy minimum population | Behavior tests |
| IA-12 | Infrastructure/persistence failure NEVER becomes a quality value or summary content | Error boundary tests |

### Class-B Invariants (Semantic)

| ID | Rule | Validation |
|---|---|---|
| IA-13 | Same inputs + same versions + same config → byte-identical summary | Determinism replay tests |
| IA-14 | Health score passes through from P6-03 unchanged; no second health model | Pass-through assertion tests |
| IA-15 | Change detection compares exactly current vs immediate previous; no silent historical analytics | Boundary tests |
| IA-16 | Missing data propagates as null; no invented scores/regimes/warnings | Missing-data tests |
| IA-17 | Explanations are template-rendered pure functions of evidence; deterministic ordering | Template determinism tests |
| IA-18 | Warning representation never modifies P6-05 lifecycle, severity, or dedup semantics | Read-only consumption tests |
| IA-19 | Regime vocabulary displayed exactly as P6-04 produced; no new regime states | Vocabulary tests |
| IA-20 | Summary lifecycle (CURRENT/SUPERSEDED) distinct from all other lifecycles | Separation tests |
| IA-21 | Provenance traces to real artifact IDs; missing references are null, never fabricated | Provenance validation tests |
| IA-22 | Coin and narrative use identical synthesis model; entity_type is parameter, not behavioral fork | Parity tests |

## 37. Dependency Map

```
Frozen: P6-01 → P6-02 → P6-03 → P6-04 → P6-05
                                        ↓
        PD-06A-01 (summary scope)
             ↓
        PD-06A-02 (explanation format)
             ↓
   PD-06B-02/03/04 (explanation rules) ← PD-06B-08 (cap)
             ↓
        PD-06A-03 (change window) → PD-06B-05 (identity)
             ↓
        PD-06A-04 (minimum population)
             ↓
        PD-06A-07 (persistence) → PD-06B-06 (lifecycle)
             ↓
        p6_intelligence_summaries schema
             ↓
        PD-06A-08 + PD-06B-10 (refresh wiring)
             ↓
        P6-06D implementation

Standalone: PD-06A-05, PD-06A-06, PD-06A-09, PD-06A-10, PD-06B-01, PD-06B-07, PD-06B-09
Deferred: PD-06A-19/20/21
```

## 38. Implementation Boundary

P6-06C/D may implement ONLY after Planner accepts the 4 blocking decisions.

Implementation will require:
- New module `src/lib/p6/summary/` (types, engine, explanations, provenance, persistence)
- Additive schema: `p6_intelligence_summaries`
- Tests covering all 22 invariants
- Optional additive refresh wiring (per PD-06B-10)

No modification to any frozen module.

## 39. Planner Acceptance Gate

P6-06D implementation requires ALL of:

1. ✅/❌ PD-06A-01 accepted — summary scope
2. ✅/❌ PD-06A-02 accepted — explanation format (structured arrays)
3. ✅/❌ PD-06A-03 accepted — change detection window (current vs previous)
4. ✅/❌ PD-06A-04 accepted — minimum population (≥1 input)
5. Aggregation semantics confirmed (synthesis, not mathematical re-aggregation)
6. Narrative weighting confirmed — P6-03 market-cap weighting remains sole authority
7. Regime synthesis confirmed — display-only, no recomputation
8. Warning synthesis confirmed — read-only representation of P6-05
9. Provenance/versioning accepted (PD-06A-09/10)
10. Persistence semantics accepted (PD-06A-07, PD-06B-05/06)
11. P4/P5 boundary verified (IA-03, IA-04, IA-08)
12. All Class-A invariants acknowledged (IA-01…IA-12)
13. Evidence gaps confirmed non-blocking

**Agent does NOT mark these accepted. Planner action required.**

## 40. Git Boundary

This document is the ONLY changed file:
- No production code
- No schema/migrations
- No API changes
- No test modifications
- No P6-01…05 contract changes
- No P4/P5 changes

---

## Verdict

**READY FOR P6-06C**

All blocking decisions have exact proposed resolutions. All semantics formalized. All boundaries verified. No frozen contract modified.
