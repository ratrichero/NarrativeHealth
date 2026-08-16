# P4 MASTER SPECIFICATION — NarrativeHealth Decision Support

**Status:** AUTHORITATIVE PHASE-LEVEL CONTRACT for P4. DOCUMENT-ONLY.
No production code, no P3/P2 modification, no implementation.

**Governance:** All future P4 implementation agents treat this document as the
primary phase contract. Task-specific specifications (P4-01 → P4-04) remain
detailed supporting documents and are referenced, not superseded, by this
Master.

---

## 1. Authoritative hierarchy

```text
1. docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md          (this document — phase contract)
2. P4 task-specific frozen specifications:
     P4_01_DECISION_SUPPORT_CONTRACT_AND_GAP_AUDIT.md
     P4_01A (Semantic Decision Addendum — embedded in P4-01)
     P4_02_SEMANTIC_CONTRACT_AND_READ_PATH_SPEC.md
     P4_03_DECISION_INTERPRETATION_AND_QUALITATIVE_SCORING_SPEC.md
     P4_04_EXPLANATION_WHY_ENGINE_SPEC.md
3. Existing P3/P2 operational contracts (implementation is truth)
4. Legacy roadmap documents (p3.md §44/§45 and older references)
```

**Conflict rule:** if two documents conflict — do not silently choose one;
record the conflict (§26), identify the operational/authoritative source
(implementation + persisted artifacts for P3; P4-01A decisions for P4), and
specify the required resolution. This Master does not silently invent new
semantics.

**Examples vs rules:** canonical examples/scenarios MUST NOT override a
frozen deterministic rule (frozen P4 semantic rules, or deterministic
mathematical/threshold rules inherited from P3). Where an example conflicts
with a frozen rule, the example is corrected — see §19B and P4-03 §21.

## 2. Master executive definition

> **P4 transforms validated P3 intelligence and approved secondary evidence
> into explainable, traceable and deterministic Decision Support.**

- P3 answers: *"What is happening?"*
- P4 answers: *"What does it mean, how strong is the evidence, and why does
  it matter?"*
- P5 answers: *"What action, if any, should be executed?"*

## 3. P4 objectives

1. **Evidence-grounded interpretation** — every conclusion maps to persisted
   evidence (EvidenceReference).
2. **Deterministic semantics** — identical input ⇒ identical output; no LLM,
   no ML, no hidden heuristic.
3. **Explainability** — template-based Why layer (P4-04).
4. **Provenance** — full traceability to artifacts/events and versioned
   interpretation identity.
5. **Historical context** — frozen P3-18 history consumed as context, never
   recomputed.
6. **Decision relevance** — Actionability distinct from Confidence.
7. **Graceful degradation** — UNKNOWN/null/degraded without fabrication;
   P4 failure never breaks the narrative API or P3 data.
8. **No P3 semantic mutation** — P4 reads persisted evidence only.
9. **No opaque composite scoring** — v1 qualitative
   LOW/MEDIUM/HIGH/UNKNOWN only.
10. **Versioned interpretation** — results attributable to rule-set versions.

## 4. P4 scope

**P4 Core (frozen):** Signal · Direction · Opportunity · Risk · Confidence ·
Actionability · Explanation / Why · Evidence traceability.

**P4 Evidence Extensions (future/optional providers, NOT Core):**
Catalyst/Event Intelligence · Token Unlock Intelligence · Narrative
Discovery · Smart Money/On-chain. Their role: **they may provide evidence to
P4; they do not redefine P4 Core** (Q1).

## 5. P4 non-goals

New P3 metrics · P3 recalculation · P3 threshold modification · P2 threshold
reuse · price prediction · ML · LLM · autonomous trading · order execution ·
portfolio rebalancing · automatic buy/sell · opaque scoring · unsupported
recommendations.

## 6. Architecture

```text
Raw market data
    ↓
P0-P2 (collection → features → health → recommendations)
    ↓
P3 intelligence (P3-04..P3-09 kernel)
    ↓
Persisted P3 artifacts / read models (immutable)
    ↓
P4 evidence assembly            (P3 read services; P2 secondary evidence)
    ↓
P4 interpretation               (P4-03 rules)
    ↓
P4 explanation                  (P4-04 templates)
    ↓
P4DecisionSupportViewModel      (read-time derived)
    ↓
Narrative API / UI              (GET /api/narratives/[id] → narrative page)
    ↓
P5 (future action/automation)
```

Secondary P2 evidence path:

```text
P2 Event Risk  →  secondary evidence (source = P2_EVENT_RISK)  →  P4
```

## 7. P3 → P4 evidence boundary (authoritative: P4-02 §5.3/§6)

**Allowed P3 evidence:** Regime · Rotation (classification + score) · Breadth ·
Momentum · Relative Strength · Leadership · Constituents · Availability ·
Artifact identity · Historical trend · Historical series/steps.
**Allowed P2 secondary evidence:** Event Risk (provenance, scope-limited).

**Frozen:** P4 *interprets* persisted evidence; P4 does **not** recalculate
P3; P4 must **not import P3 implementation modules directly**
(`src/lib/p3/*`); P4 consumes the P3 read-service outputs only.

## 8. Semantic model (master table)

| Concept | Layer | Meaning | Allowed values | Status |
|---|---|---|---|---|
| Regime | P3 | Current narrative regime classification | P3 states incl. NEUTRAL (operational) | FROZEN P3 |
| Rotation | P3 | Capital-flow direction + score | 5 states + 0–100 score | FROZEN P3 |
| Historical Trend | P3 | Historical trajectory | IMPROVING/DETERIORATING/STABLE/TRANSITION/UNKNOWN | FROZEN P3 |
| Signal | P4 | Meaningful interpreted state/event | 8-signal v1 catalog | FROZEN (P4-03) |
| Direction | P4 | Current interpreted direction | POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN | FROZEN (P4-03) |
| Opportunity | P4 | Favorable decision context | LOW/MEDIUM/HIGH/UNKNOWN | FROZEN (qualitative v1) |
| Risk | P4 | Unfavorable exposure context | LOW/MEDIUM/HIGH/UNKNOWN | FROZEN (qualitative v1) |
| Confidence | P4 | Evidence strength | LOW/MEDIUM/HIGH/UNKNOWN | FROZEN (qualitative v1) |
| Actionability | P4 | Decision usefulness | LOW/MEDIUM/HIGH/UNKNOWN | FROZEN (qualitative v1) |
| EvidenceReference | P4 | Traceable evidence pointer | P4-02 §5 fields | FROZEN (humanValue amendment REJECTED — §16/§25) |
| ExplanationItem | P4 | Human-readable Why item | P4-04 §3 fields | FROZEN (P4-04) |

**Preserved distinctions:** NEUTRAL ≠ MIXED ≠ UNKNOWN; MIXED ≠ TRANSITION;
Direction ≠ Regime.

## 9. Frozen semantic decisions (P4-01A Q1–Q5 — FROZEN)

- **Q1 — P4 = Decision Support.** P4 Core vs P4 Evidence Extensions; legacy
  roadmap items preserved as extensions.
- **Q2 — NEUTRAL is a valid P3 classification** and does not mean UNKNOWN;
  P4 Direction is not a Regime lookup; NEUTRAL never degrades to
  UNKNOWN/MISSING/INSUFFICIENT_HISTORY/INVALID/MIXED unless the independent
  interpretation produces it.
- **Q3 — MIXED and TRANSITION are orthogonal.** No 1:1 mapping.
- **Q4 — P4 v1 uses qualitative LOW/MEDIUM/HIGH/UNKNOWN** for Opportunity,
  Risk, Confidence, Actionability. No numeric composite scoring.
- **Q5 — P2 Event Risk is secondary evidence** with provenance
  `source = P2_EVENT_RISK`; never overwrites P3; coin-level ≠ narrative-level;
  P2 Decision Engine thresholds are NOT P4 thresholds.

## 10. P4-03 interpretation rules (summary — details in P4-03)

- **Signal firing:** 8 signals, deterministic conditions over frozen
  deltas/ranks/trends; multi-evidence for NARRATIVE_*, single-evidence
  allowed for BROADENING/NARROWING/LEADERSHIP/REGIME/ROTATION_CHANGE.
- **Direction aggregation:** gates (no valid current → UNKNOWN; <2 artifacts
  → UNKNOWN; ≥2/3 core UNKNOWN → UNKNOWN); core = regime + rotation +
  momentum; corroborators = breadth + RS; dominant/tentative/MIXED/NEUTRAL
  decision table.
- **Opportunity / Risk:** qualitative base tiers + suppression ladder /
  structural DET thresholds + P2 scope adjustment (+1 tier cap HIGH).
- **Confidence:** coverage/consistency/historical-support/provenance rubric;
  caps stale ≤ MEDIUM, insufficient → LOW.
- **Actionability:** Direction × Confidence × context table; NEUTRAL ⇒ LOW.
- **Conflict:** EVIDENCE_CONFLICT with materiality; never alone ⇒ Risk HIGH.
- **UNKNOWN propagation:** 10-condition matrix; UNKNOWN does not
  blanket-propagate (Confidence stays determinable).
- **P2 Event Risk projection:** coin-local / multi-coin / narrative-wide
  scope tiers with provenance.

## 11. Frozen vs provisional (mandatory matrix)

| Rule | Status | Authority | Validation needed |
|---|---|---|---|
| P3 semantics / thresholds / trend states / epsilons / ranks | FROZEN | P3-04..09, P3-14, P3-18 | none (P3 closed) |
| UNKNOWN gates (valid current, sufficiency, core availability) | FROZEN | P4-02/03 | none |
| NEUTRAL ≠ MIXED ≠ UNKNOWN; MIXED ≠ TRANSITION; Direction ≠ Regime | FROZEN | P4-01A Q2/Q3 | none |
| Direction core composition (regime+rotation+momentum) | FROZEN | P3-14 D.1 | none |
| P2 secondary-only + provenance rule | FROZEN | P4-01A Q5 | none |
| Evidence identity + traceability contract | FROZEN | P4-02 | none |
| Signal identity `(signalId, narrativeId, windowEnd)` | FROZEN | P4-02/03 | none |
| Corroborator set + reconciliation (breadth/RS) | PROVISIONAL | P4-03 §4 | P4 historical validation |
| Conflict materiality + severity | PROVISIONAL* | P4-03 §9 | P4 historical validation |
| P2 scope tiers (multi-coin ≥2; narrative-wide +1 cap HIGH) | PROVISIONAL | P4-03 §10/§11 | P4 historical validation |
| Opportunity suppression ladder | PROVISIONAL | P4-03 §12 | P4 historical validation |
| Risk base thresholds (≥2 DET HIGH / 1 MEDIUM / 0 LOW) | PROVISIONAL | P4-03 §12 | P4 historical validation |
| Confidence combination rubric + caps | PROVISIONAL* | P4-03 §7 | P4 historical validation |
| Actionability table | PROVISIONAL | P4-03 §8 | P4 historical validation |
| Opportunity × Risk explanation matrix | PROVISIONAL | P4-03 §13 | P4 historical validation |
| NARRATIVE_* corroboration minimums | PROVISIONAL | P4-03 §3.10 | P4 historical validation |

**PROVISIONAL does not mean optional.** It means approved for implementation
but requires empirical validation in P4 historical validation (§13 Master).
PROVISIONAL rules are not hidden; they are auditable via
`interpretationRuleVersion` (P4-03 §17).

*For "Conflict materiality + severity" and "Confidence combination rubric +
caps", the v1 semantic content was FROZEN by §19B (P4-05A SEMANTIC
RESOLUTION, C1/C2); the PROVISIONAL marker now refers only to the future
historical-validation review trigger, not to unresolved semantics.

## 12. P4-04 explanation layer (summary — details in P4-04)

WHAT = P4-03 (decision logic); WHY = P4-04 (explanation logic). Engine is
template-based, deterministic, evidence-grounded, non-LLM. Limits: primary ≤
3, conflicting ≤ 2, contextual ≤ 2. No unsupported language. UNKNOWN/degraded
explanations state the real reason. P2 provenance and scope preserved.
Versioned (`explanationVersion`). Failure isolation: `explanation = []` —
never crashes the narrative endpoint.

## 13. Read path (frozen)

```text
UI
 ↓
GET /api/narratives/[id]
 ↓
P4 read service (getP4DecisionSupport)
 ↓
P3 read models + approved P2 evidence
 ↓
P4 interpretation (P4-03)
 ↓
P4 explanation (P4-04)
 ↓
P4DecisionSupportViewModel
```

**P4 results are derived at read time. No P4 persistence in v1.**

## 14. API contract (frozen)

`data.p4DecisionSupport` on `GET /api/narratives/[id]`:

| Scenario | value |
|---|---|
| Success | full ViewModel |
| No evidence | `null` |
| Partial evidence | ViewModel with DEGRADED status |
| Failure | `null` (never breaks narrative response) |
| Backward compat | additive field; existing consumers unaffected |

P4 failure must not break the existing narrative response or P3 data.

## 15. UI placement (frozen intent)

```text
Narrative Header
    ↓
P3IntelligencePanel
    ↓
P4 Decision Support     ← new card (Summary/Direction/Signals/Opportunity/Risk/Why/Evidence)
    ↓
Correlation / other context
```

Do not duplicate P3 historical intelligence (reuse P3HistoricalTrend as the
evidence layer). P4's UI purpose: *"So what?"*

## 16. Explanation contract

- `ExplanationItem` — P4-04 §3 (id, statement, role, supporting/conflicting/
  contextual evidence, severity?, sourceReferences, versions, generatedAt).
- `EvidenceReference` — P4-02 §5 (reused verbatim).
- `explanationVersion` — "1".

**Resolved amendment — `EvidenceReference.humanValue`:** **REJECTED / CLOSED.**
**Decision (P4-04-IMPL):** Alternative B was adopted — display values are
resolved **outside** `EvidenceReference` at template-render time from the
in-memory P3 read models, which already carry deterministic display fields
(`regime.display`, `rotation.scoreDisplay`, `breadth.display`,
`momentum.display`, `relativeStrength.display`, `leadership.scoreDisplay`).
`humanValue` is **NOT ADDED** to `EvidenceReference` (would add redundancy to
the frozen contract).

**Implemented by:** `src/lib/p4/explanation/resolver.ts` — display values are
keyed by full evidence identity and resolved outside the reference; an
unresolved reference falls back to its `field` name (the engine never formats
numbers itself and never invents values).

## 17. Versioning (frozen conceptual identity)

```text
semanticVersion           = "1"
algorithmVersion          = "p4-decision-support"
interpretationRuleVersion = "p4-03/v1"
explanationVersion        = "1"
signalCatalogVersion      = "v1"
```

**Reproducibility:** same versions + same evidence snapshot ⇒ same
interpretation + explanation. No persistence required in P4 v1.

## 18. Validation strategy

```text
P4-03 semantic specification
    ↓
P4 implementation
    ↓
historical validation
    ↓
production validation
    ↓
P4 closure
```

- **Specification validity:** does the implementation match the frozen rules?
  (semantic test vectors from P4-03 §16 / P4-04 §22).
- **Historical validity:** do rules behave sensibly on historical artifacts
  (the growing P3 series)?
- **Production validity:** does the live system preserve determinism,
  provenance and reliability (P4-07)?
- **Empirical tuning:** which PROVISIONAL rules (§11 Master) should be
  revised? Empirical findings are **never silently converted into new
  semantics** — any change requires a versioned amendment (§23 Master) and a
  new `interpretationRuleVersion`.

## 19. P4 roadmap (frozen)

| Task | Deliverable | Status |
|---|---|---|
| P4-01 | Contract & Gap Audit | ✅ COMPLETE |
| P4-01A | Semantic Decisions Q1–Q5 | ✅ COMPLETE |
| P4-02 | Semantic Contract & Read Path | ✅ COMPLETE |
| P4-03 | Decision Interpretation & Qualitative Scoring | ✅ COMPLETE |
| P4-04 | Explanation / Why | ✅ COMPLETE |
| P4-04-IMPL | Explanation Engine | ✅ COMPLETE |
| P4-05A | Decision Support Read Service | ✅ COMPLETE |
| P4-05A-REVIEW | Semantic Conflict Resolution & Documentation Freeze | ✅ COMPLETE |
| P4-05B | API Integration (`data.p4DecisionSupport`) | ✅ COMPLETE |
| P4-05C | Decision Support UI | ✅ COMPLETE |
| P4-05-DOC | End-to-End Documentation & Phase Checkpoint | ✅ COMPLETE |
| P4-05 | Decision Support (End-to-End) | ✅ COMPLETE |
| P4-06A | Historical Validation Dataset & Replay Framework | ✅ COMPLETE |
| P4-06B-DOC | Historical Validation Execution Spec (protocol freeze) | ✅ COMPLETE |
| P4-06B | Historical Validation Execution | ✅ COMPLETE (execution; all rules INSUFFICIENT EVIDENCE) |
| P4-06 | Historical Decision Validation | OPEN / DATA ACCRUAL (standing validation track — not a P4 closure blocker; revalidation trigger per `P4_08_CLOSURE_DECISION.md`) |
| P4-07-DOC | Production Validation Spec (runtime operational validation) | ✅ COMPLETE |
| P4-07 | Production Validation | ✅ COMPLETE (PASS WITH LIMITATIONS) |
| P4-08 | P4 Closure | ✅ COMPLETE |
| **P4** | **Phase closure** | **✅ CLOSED** (P4-06 validation track OPEN / DATA ACCRUAL) |
| P5 | Next Phase (action/automation) | NEXT — NOT STARTED |

P4 Evidence Extensions remain outside current core implementation unless
explicitly promoted by a new versioned decision.

## 20. Traceability matrix

| Requirement | Master section | Supporting doc | Implementation task | Validation |
|---|---|---|---|---|
| P4 semantic model | §8 | P4-02 §2-3 | P4-04-IMPL (types) | P4-06 |
| Direction | §10 | P4-03 §4 | P4-04-IMPL | P4-03 §16 vectors |
| Signal | §10 | P4-03 §3 | P4-04-IMPL | P4-03 §16 vectors |
| Opportunity | §10 | P4-03 §12 | P4-04-IMPL | P4-06 |
| Risk | §10 | P4-03 §12/§11 | P4-04-IMPL | P4-06 |
| Confidence | §10 | P4-03 §7 | P4-04-IMPL | P4-06 |
| Actionability | §10 | P4-03 §8 | P4-04-IMPL | P4-06 |
| Evidence Sufficiency | §7 | P4-02 §4 | P4-04-IMPL | P4-06 |
| Evidence Traceability | §7/§16 | P4-02 §5 | P4-04-IMPL | P4-06 |
| P2 Event Risk | §7/§10 | P4-01A Q5, P4-03 §10 | P4-04-IMPL | P4-06 |
| Read Service | §13 | P4-02 §9 | P4-04-IMPL | P4-07 |
| ViewModel | §13/§16 | P4-02 §8 | P4-04-IMPL | P4-07 |
| API | §14 | P4-02 §10 | P4-05+ (API wiring) | P4-07 |
| Explanation | §12/§16 | P4-04 | P4-04-IMPL | P4-04 §22 |
| UI | §15 | P4-02 §11 | P4-05 | P4-07 |
| Historical Validation | §18 | P4-03 §17 | P4-06 | P4-06 |
| Production Validation | §18 | — | P4-07 | P4-07 |

No implementation commit references are fabricated; implementation tasks that
do not exist yet are marked TBD in their task column.

---

## 19A. P4-04-IMPL Implementation Status

**Status: COMPLETE** (verified 2026-08-16).

**Implementation location:** `src/lib/p4/`

| Module | Purpose |
|---|---|
| `src/lib/p4/types.ts` | P4 domain contract: `P4EvidenceReference` (P4-02 §5, reused verbatim — **no `humanValue`**), `ExplanationItem` (P4-04 §3.1), `P4InterpretationResult` (the typed P4-03 output the engine consumes), version constants |
| `src/lib/p4/explanation/evidence.ts` | Evidence identity key, deduplication, §5 tiered ranking (ordered precedence, no arithmetic weights), per-role selection with frozen limits (primary ≤ 3, conflicting ≤ 2, contextual ≤ 2) |
| `src/lib/p4/explanation/resolver.ts` | Alternative B display-value resolution — values keyed by full evidence identity, outside EvidenceReference; unresolved refs fall back to the `field` name |
| `src/lib/p4/explanation/templates.ts` | Frozen template families: Direction (5 states), Opportunity/Risk/Confidence/Actionability, all 8 signals, degraded/UNKNOWN reasons, P2 scope, banned-language list |
| `src/lib/p4/explanation/engine.ts` | Explanation composition (Summary / Supporting ≤3 / Conflicts ≤2 / Context ≤2 / Caveat ≤1, total ≤6), signal priority ordering, deterministic selection, failure isolation (`null` input ⇒ `items: []`) |
| `src/lib/p4/explanation/__tests__/engine.test.ts` | 22 semantic tests: E1–E10 canonical examples (exact statement assertions), limits, dedup, identity isolation, stale/invalid, degradation states, P2 scope, banned language, P4-03 consistency, determinism, null/failure isolation |
| `src/lib/p4/explanation/__tests__/evidence.test.ts` | 16 selection/ranking/identity/resolver tests |

**Scope discipline:** the engine consumes only the typed P4-03 interpretation
result + its evidence references; it never recomputes a P4-03 decision and
never recalculates P3 metrics. `src/lib/p4/types.ts` imports the
frontend-safe P3-18 read-model type (`P3TrendState`) only — **no
`src/lib/p3/*` kernel import, no P2 kernel import**.

**Verification (actual results, 2026-08-16):**

- `npx tsc --noEmit` → **0 errors**
- `npx jest src/lib/p4` → **38/38 passing** (2 suites)
- Semantic test coverage: E1–E10 canonical examples; selection limits
  (primary ≤ 3 / conflicting ≤ 2 / contextual ≤ 2 / total ≤ 6);
  deduplication; identity isolation; STALE/INVALID exclusion from
  supporting; all 8 degradation states; P2 scope/provenance (coin-local /
  multi-coin / narrative-wide); banned-language scan; P4-03 result
  consistency (§14); determinism; null-input failure isolation.

**Determinism clarification:** semantic explanation generation is
deterministic for the same (P4-03 interpretation, evidence snapshot, version
tuple) — identical statements, ordering, and evidence references. The runtime
`generatedAt` field is read-time metadata and is **excluded from semantic
equality**; tests assert semantic equality via snapshots that strip
`generatedAt`. No byte-for-byte equality *including* `generatedAt` is claimed
or guaranteed.

**humanValue:** REJECTED / CLOSED — Alternative B implemented (§16, §25).

**Production boundary verification (git audit, 2026-08-16):** the P4 change
set is `src/lib/p4/**` (new). NO changes to `src/lib/p3/**`, P2 kernel, P2
thresholds, API routes, UI, DB schema, or migrations. The `package-lock.json`
and `tsconfig.tsbuildinfo` working-tree modifications are pre-existing
tooling noise, not part of P4-04-IMPL.

**Known pre-existing P3 test failures (validation caveat):** the full Jest
run (`npx jest`) currently reports **16 failing tests across 7 P3 kernel
suites** (486 passing), e.g. `breadth` availability semantics. These are NOT
caused by P4-04-IMPL (verified: no P4 module is imported by P3 and no P3 file
changed); they are OUT OF SCOPE and were not modified. The repository is NOT
classified as globally green; the P4 suite itself is green.

**Phase status:** P4-01, P4-01A, P4-02, P4-03, P4-04, P4-04-IMPL, P4-05A,
P4-05A, P4-05A-REVIEW, P4-05B, P4-05C (UI), P4-05-DOC **COMPLETE**;
**P4-05 (Decision Support end-to-end) COMPLETE**. P4-06A **COMPLETE**
(foundation); P4-06B-DOC **COMPLETE** (protocol freeze); P4-06B **COMPLETE**
(execution run — all 9 provisional rules INSUFFICIENT EVIDENCE, 0
contradictions); **P4-06 NOT COMPLETE** (requires a separate documented
decision after reviewing the validation report); P4-07, P4-08 NOT STARTED.
P4 remains in **IMPLEMENTATION PHASE**. P4-06 stays OPEN (data accrual,
closure decision recorded — see `P4_06_CLOSURE_DECISION.md`); P4-07-DOC
**COMPLETE** (specification); P4-07 **COMPLETE — PASS WITH LIMITATIONS**
(production validation executed; see `P4_07_PRODUCTION_VALIDATION_REPORT.md`).
Next task: P5 (next phase), which must NOT close P4-06 (OPEN / DATA
ACCRUAL, standing revalidation track per `P4_08_CLOSURE_DECISION.md`).

## 19B. P4-05A Semantic Conflict Resolution (authoritative record)

**Status:** FROZEN v1 (P4-05A-REVIEW). This section is the AUTHORITATIVE
phase-level record of the five P4-03 prose-vs-canonical-scenario
contradictions found by the P4-05A implementation audit. Detailed evidence
for each decision is in `P4_03` §21 (task-level record); this section is the
binding phase contract. Where this section and any other document differ,
this section governs for the resolved items.

**Decision hierarchy applied (§1):** frozen rules > deterministic
mathematical/threshold rules inherited from P3 > detailed prose > canonical
examples. Canonical examples MUST NOT override a frozen deterministic rule.

| ID | Resolution (final v1 rule) | Supersedes | Status |
|---|---|---|---|
| C1 | Material EVIDENCE_CONFLICT = an opposite-sign pair WITHIN the direction core {regimeMove, rotationScoreMove, momentumMove} (core split). Core-vs-breadth, core-vs-RS and corroborator-vs-corroborator conflicts are MINOR. | P4-03 §9.2 "OR core-vs-breadth" | FROZEN* |
| C2 | A material conflict CAPS Confidence at MEDIUM (never HIGH); a minor conflict reduces one level; coverage floors remain. | P4-03 §7/§9 "material ⇒ LOW" | FROZEN* |
| C3 | Canonical Scenario 3 Confidence = HIGH. RS STABLE is NOT a §3.9 directional conflict (no opposing sign); the "RS stable/conflict minor" parenthetical is removed. | P4-03 §16 Scenario 3 parenthetical | FROZEN |
| C4 | Scenario 2 and Scenario 4 signal lists were incomplete. Deterministic §3 rules stand unchanged: S2 += EVIDENCE_CONFLICT (minor), S4 += NARROWING. Signal rules are NOT weakened to preserve scenario text. | P4-03 §16 Scenarios 2/4 signal lists | FROZEN |
| C5 | §5 Scenario S2 is a scenario defect: its deltas (momentum +5Δ, breadth +0.1Δ) exceed the frozen ε and made the stated NEUTRAL unreachable. Frozen ε NOT modified. S2 corrected to within-ε deltas (momentum +0.5Δ, breadth +0.04Δ, rotation +2Δ) ⇒ NEUTRAL. | P4-03 §5 Scenario S2 | FROZEN |

*FROZEN for v1 semantic content; the P4-03 §17 PROVISIONAL marker now
refers only to the future P4 historical-validation review trigger (§11),
not to unresolved semantics. Any future change bumps
`interpretationRuleVersion` (P4-03 §18).

**Superseded-clause registry (annotated in place in P4-03):** §9.2
materiality; §7 combination; §9 Impact on Confidence; §16 Scenario 3
parenthetical; §16 Scenarios 2/4 signal lists; §5 Scenario S2 deltas.

**Implementation match — P4-05A status: A. APPROVED.** The P4-05A
implementation (`src/lib/p4/interpretation.ts` `detectConflict`/
`interpretConfidence` and signal detection) already matches all five final
decisions; no code change is required. Tests already assert the resolved
behavior (S2 EVIDENCE_CONFLICT, S3 Confidence HIGH, S4 NARROWING, S5/S6
minor/material severities, material-cap MEDIUM). No frozen epsilon, rank,
gate, NEUTRAL/MIXED/UNKNOWN semantics, P2 provenance or signal rule was
changed by this resolution.

## 19C. P4-05B Implementation Status (checkpoint)

**Status: COMPLETE** (P4-05B — Decision Support API Integration).

- `GET /api/narratives/[id]` now returns `data.p4DecisionSupport`
  (additive, backward-compatible — P4-02 §10). The route calls
  `getP4DecisionSupport(narrativeId)` from `src/lib/p4/service.ts`; no P4
  interpretation logic lives in the route (P4-05A §6).
- Failure isolation (P4-02 §10): the P4 service degrades to `null` internally
  AND the route wraps the call in the repository's try/catch pattern — a P4
  throw, null, unavailable evidence or internal error never fails the
  endpoint and never affects P3 data.
- Serialization verified: the full `P4DecisionSupportViewModel` (Direction,
  signals + evidenceRefs, Opportunity/Risk/Confidence/Actionability,
  explanation, evidence incl. `artifactIdentity: null` refs, provenance,
  historicalContext, `generatedAt`/`asOf`, version/attribution) survives the
  response JSON round-trip unchanged. No domain-type change was required.
- Verification: `npx tsc --noEmit` 0 errors; `npx jest src/app/api/narratives`
  12/12 (7 new API tests + 5 existing route-resilience); `npx jest src/lib/p4`
  90/90. The known 16 pre-existing P3 kernel failures remain OUT OF SCOPE.
- Boundary: changed only `src/app/api/narratives/[id]/route.ts` +
  `src/app/api/narratives/__tests__/p4-decision-support.test.ts` (new). No
  P3/P2, DB/schema, migration, UI, P4 engine or package-lock changes.

## 19D. P4-05C Implementation Status (checkpoint)

**Status: COMPLETE** (P4-05C — Decision Support UI Integration).

- New `src/components/P4DecisionSupportPanel.tsx` renders
  `data.p4DecisionSupport` on `/narrative/[id]`, placed between
  `P3IntelligencePanel` and `CorrelationHeatmap` (P4-05C §2). It consumes the
  existing `GET /api/narratives/[id]` response — no second network request.
- Presentation-only: Direction rendered exactly as the frozen values
  (POSITIVE / NEGATIVE / MIXED / NEUTRAL / UNKNOWN); Opportunity / Risk /
  Confidence / Actionability rendered as the qualitative values (LOW / MEDIUM
  / HIGH / UNKNOWN); signals, explanation items and evidence references are
  rendered from the ViewModel with their encoded roles/status/provenance — no
  frontend interpretation, no scoring, no buy/sell/allocation language, no
  LLM.
- UNKNOWN / degraded handling: null ViewModel, UNKNOWN Direction, DEGRADED
  status, insufficient history, stale evidence and unavailable P2 each render
  a safe state that explains the reason (when the ViewModel provides one)
  without fabricating values; P3 panels are never hidden or broken.
- Accessibility: headed sections, `aria-expanded` collapsible explanation /
  evidence blocks, non-color status indicators; responsive via existing
  Tailwind conventions.
- Verification: `npx tsc --noEmit` 0 errors; new component suite
  `src/components/__tests__/P4DecisionSupportPanel.test.tsx` 14/14
  (UI-01…UI-14); `npx jest src/lib/p4 src/app/api/narratives` 102/102;
  existing `P3IntelligencePanel` suite 18/18 unaffected. The known 16
  pre-existing P3 kernel failures remain OUT OF SCOPE.
- Boundary: changed only `src/app/narrative/[id]/page.tsx`,
  `src/components/P4DecisionSupportPanel.tsx` (new),
  `src/components/__tests__/P4DecisionSupportPanel.test.tsx` (new) and a
  client-side type in `src/types/index.ts`. No P3/P2, API contract, DB/schema,
  migration, P4 engine/service, package-lock or tsbuildinfo changes.

## 19E. P4-05 Completion Record (formal phase checkpoint)

**Status: COMPLETE** (P4-05 — Decision Support end-to-end). Formal audit
record: `docs/P4_Upgrade/P4_05_DECISION_SUPPORT_IMPLEMENTATION_CHECKPOINT.md`
(P4-05-DOC). This section is the phase-level authoritative status.

| Component | Status | Evidence |
|---|---|---|
| P4-05A Read Service | ✅ COMPLETE | `src/lib/p4/` (service, assembler, mapper, availability, interpretation, errors, types) |
| P4-05A-REVIEW C1–C5 | ✅ FROZEN v1 | P4-03 §21 + §19B above |
| P4-05B API Integration | ✅ COMPLETE | `data.p4DecisionSupport` on `GET /api/narratives/[id]` |
| P4-05C UI Integration | ✅ COMPLETE | `P4DecisionSupportPanel` between P3 Intelligence and CorrelationHeatmap |
| P4-05 End-to-End | ✅ COMPLETE | full chain P3 read models → P4 → API → UI |
| P4-06 Historical Decision Validation | NOT STARTED | next task |

**Audit summary (P4-05-DOC):** the actual repository was inspected against
P4-02/P4-03/P4-04/P4-05A + the C1–C5 resolutions — no semantic drift, no
invented signals, no numeric scoring, no LLM, no P3/P2/DB changes. The full
P4 suite is green (90/90), the P4 API suite is green (12/12), the P4 UI suite
is green (14/14), `npx tsc --noEmit` is 0 errors. The known 16 pre-existing
P3 kernel failures remain OUT OF SCOPE; the repository is NOT classified as
globally green.

**P4-06 gate:** READY_FOR_P4-06, subject to: (a) P4-06 validates the
PROVISIONAL P4-03 rules against historical P3 artifacts; (b) any genuine
contradiction found is recorded + classified per §21, never silently
resolved; (c) the 16 P3 failures stay out of scope.

## 19F. P4-06A Implementation Status (checkpoint)

**Status: COMPLETE** (P4-06A — Historical Validation Dataset & Replay
Framework, foundation only). Specification:
`docs/P4_Upgrade/P4_06A_HISTORICAL_VALIDATION_DATASET_AND_REPLAY_SPEC.md`.

- **Real data inventory (read-only live DB):** 5 narratives, 3 persisted P3
  artifacts (all narrative 1, `p3-orchestrator`/1/observed/7D, all VALID),
  0 P2 event rows, 1 historical-correction row. Eligible replay points: 2
  (prefixes ending at artifacts 9 and 10). Narratives 2/3/4/6 have zero
  artifacts.
- **Replay harness (isolated, pure):** `src/lib/p4/validation/` —
  `replayP4AtWindow` reuses the existing `buildP3IntelligenceHistory` →
  `assembleP4Evidence` → `interpretP4` → `buildExplanation`; `seriesUpTo`
  (no future leakage); `assertSameIdentity` (same identity only, P4-02 §7);
  `deriveOutcomes`/`trendRelation` (narrative-state evolution only — no
  price-return labels, P4 Opportunity ≠ return prediction). No P4 semantic
  change, no P3/P2 change, no API/UI/DB change.
- **Coverage:** every provisional rule is PARTIALLY or NOT YET VALIDATABLE;
  the correct conclusion is INSUFFICIENT EVIDENCE (2 samples, 1 narrative,
  0 conflicts, 0 P2 cases) — no rule is claimed validated, no rule modified.
- **Verification:** `npx tsc --noEmit` 0 errors; `npx jest src/lib/p4/validation`
  11/11; `npx jest src/lib/p4` 101/101 (no regression).
- **P4-06B gate:** the as-of DB loaders (artifacts `windowEnd <= W`, active
  P2 as of W) and the dataset writer are P4-06B implementation items; the
  harness is pure and ready.

## 19G. P4-06B-DOC Implementation Status (checkpoint)

**Status: COMPLETE** (P4-06B-DOC — Historical Validation Execution
Specification, protocol freeze). Specification:
`docs/P4_Upgrade/P4_06B_HISTORICAL_VALIDATION_EXECUTION_SPEC.md`.

- Document-only task: no historical validation executed, no P4-03/P4-04
  semantics modified, no provisional rule claimed validated.
- Freezes the execution protocol for P4-06B-IMPL: validation questions per
  provisional rule, as-of data/loader contracts, replay + outcome-label
  protocols, validation matrix, scenario requirements, qualitative sample
  policy (no invented statistics), independence/duplication controls,
  C1/C2 conflict validation (semantics unchanged), P2 validation (Decision
  Engine thresholds not reused), leakage tests, result schema, Master §21
  contradiction handling, promotion policy, synthetic-data policy, report
  format, gate criteria, P4-07 separation, and the implementation boundary.
- Honest forecast: the current dataset (2 replay points, 1 narrative, 0 P2
  rows, 0 conflicting cases) is insufficient for broad validation; every
  provisional rule remains INSUFFICIENT EVIDENCE; insufficient data is an
  acceptable final result per the gate criteria.
- Boundary: this task changed only the new spec document and this Master
  checkpoint. No production code changed.

## 19H. P4-06B-IMPL Implementation Status (checkpoint)

**Status: COMPLETE** (execution run; NOT a semantic validation conclusion).
Report: `docs/P4_Upgrade/P4_06B_HISTORICAL_VALIDATION_REPORT.md`.

- **Implementation (validation boundary only, `src/lib/p4/validation/`):**
  `loaders.ts` (read-only as-of loaders: artifacts `windowEnd <= W`,
  identity-grouped, P2-as-of per the frozen contract), `execution.ts`
  (sample builder, scenario-class classification, mechanical rule
  evaluation), plus tests (21/21). The production P4 path
  (`buildP3IntelligenceHistory` → `assembleP4Evidence` → `interpretP4` →
  `buildExplanation`) is reused unchanged — no shadow algorithm.
- **Real execution:** 3 replay samples (artifacts 1/9/10, narrative 1); 2
  VALID (NEGATIVE; minor conflict at 08-13 conforming C1/C2; Confidence
  MEDIUM/HIGH; Risk HIGH; Actionability HIGH), 1 DEGRADED
  (INSUFFICIENT_HISTORY). 0 P2 rows; 0 core-split conflicts; 0
  contradictions across all rules.
- **Result: all 9 provisional rules INSUFFICIENT_EVIDENCE** (frozen §10
  policy: every rule has ≥1 unobserved required scenario class). No rule
  promoted; no rule modified; observed conforming classes recorded in the
  report.
- **Verification:** `npx tsc --noEmit` 0 errors; `npx jest
  src/lib/p4/validation` 21/21; `npx jest src/lib/p4` 111/111;
  `npx jest src/app/api/narratives` 12/12. The known 16 pre-existing P3
  kernel failures remain OUT OF SCOPE.
- **Boundary:** changed only `src/lib/p4/validation/**` + this Master
  checkpoint + the report. No P3/P2, API, UI, DB/schema, migration,
  package-lock or tsbuildinfo changes.
- **P4-06 status: NOT COMPLETE.** Completion requires a separate documented
  decision after reviewing the validation report (data accrual → re-run, or
  an explicit phase decision).

## 19I. P4-07-DOC Implementation Status (checkpoint)

**Status: COMPLETE** (P4-07-DOC — Production Validation / Runtime
Operational Validation Specification). Specification:
`docs/P4_Upgrade/P4_07_PRODUCTION_VALIDATION_SPEC.md`.

- Document-only task: no implementation, no semantic change, no P3/P2
  modification, no rule promotion, P4-06 NOT closed (remains OPEN with data
  accrual per `P4_06_CLOSURE_DECISION.md` Option A).
- The spec freezes the P4-07 protocol: production-path invariants (§5),
  input validity matrix (§6), failure isolation (§7), determinism (§8),
  identity/provenance (§9), P2 validation (§10), explanation (§11), API
  (§12), UI (§13), runtime/operational checks (§14 — observation-only; no
  numeric SLOs invented), read-only audit (§15), observability (§16),
  safety matrix (§17), test levels (§18), acceptance criteria (§19),
  severity classification (§20), stop-the-line conditions (§21), rollback/
  disable behavior (§22), known P3 caveat (§23 — 16 failures OUT OF SCOPE),
  provisional-rule relationship (§24 — consistency only, no historical
  validity), P4-06 revalidation trigger preserved (§25), report format
  (§26), promotion/closure policy (§27), Master requirements (§28),
  contradiction protocol Master §21 (§29), implementation boundary
  (§30), verification checklist (§31), next task (§32). Includes a
  17-row traceability matrix (requirement → contract → implementation →
  method → acceptance criterion).
- Boundary: this task changed only the new spec + this Master checkpoint.
  No production code changed.

## 19J. P4-07-IMPL Implementation Status (checkpoint)

**Status: COMPLETE — PASS WITH LIMITATIONS.** Report:
`docs/P4_Upgrade/P4_07_PRODUCTION_VALIDATION_REPORT.md`.

- Validation-only addition: `src/lib/p4/validation/__tests__/production.test.ts`
  (18 tests: failure-isolation drill matrix A–L, determinism, identity
  drills, evidence/provenance contract, explanation limits, STALE/INVALID
  exclusion, no humanValue). Production P4 code, API route, UI, DB, P3/P2:
  untouched.
- Executed live runtime checks: 5× repeated calls to
  `getP4DecisionSupport(1)` — deterministic semantic output (generatedAt
  excluded); concurrent same-narrative ×4 identical; different narratives
  1/2/3/4/6 isolated (narrative 1 OK, others null — no artifacts); read-only
  verified (artifacts 3→3, P2 0→0, constituent snapshots 3→3). Latency
  observed avg 1695 ms (sandbox DB round-trip bound; no SLO exists —
  observation only). Query count: fixed ~10/narrative, no N+1 by series
  length (code audit; live instrumentation unavailable — reported as a
  limitation).
- Verdict: PASS WITH LIMITATIONS — limitations are environmental/data
  availability (0 real P2 rows, single-narrative live data, sandbox-bound
  latency), informational, no blockers.
- Verification: `npx tsc --noEmit` 0 errors; `npx jest src/lib/p4/validation`
  39/39; `npx jest src/lib/p4` 129/129; API 12/12; P4 panel UI 14/14;
  P3 panel UI 18/18. The known 16 pre-existing P3 kernel failures remain OUT
  OF SCOPE.
- **P4-06 status: UNCHANGED — OPEN / DATA ACCRUAL.** No rule promoted, P4-06
  not closed, revalidation trigger preserved.
- Boundary: changed only `src/lib/p4/validation/**` (tests) + this Master
  checkpoint + the report. No P3/P2, API, UI, DB/schema, migration,
  package-lock or tsbuildinfo changes.

## 19K. P4 Final Closure Record (phase closure)

**Status: P4 CLOSED** (decision: OPTION A — close the phase; P4-06 validation
track remains OPEN / DATA ACCRUAL). Decision record:
`docs/P4_Upgrade/P4_08_CLOSURE_DECISION.md`.

- **Final phase status:** P4-01 → P4-07 COMPLETE (all implementation,
  documentation and validation tasks closed); P4-08 COMPLETE (closure
  audit); **P4 = CLOSED**; P5 = NEXT — NOT STARTED; **P4-06 = OPEN / DATA
  ACCRUAL** (NOT closed; NOT promoted).
- **Implementation inventory:** `src/lib/p4/**` (service, assembler, mapper,
  availability, interpretation, explanation, validation) + narrative API
  route (`data.p4DecisionSupport`, additive + failure-safe) + narrative UI
  (`P4DecisionSupportPanel` between P3 Intelligence and CorrelationHeatmap) +
  client types + 12 docs under `docs/P4_Upgrade/`. All verified on disk.
- **Semantic freeze (frozen):** P3/P2 untouched; thresholds/epsilons
  unchanged; UNKNOWN gates; NEUTRAL ≠ MIXED ≠ UNKNOWN; Direction core
  composition; 8 signals; qualitative O/R/C/A; P2 secondary-only + provenance;
  evidence identity/dedup; explanation limits; C1–C5; Alternative B
  (`humanValue` rejected); no buy/sell/allocation semantics.
- **Provisional (retained, NOT promoted):** all 9 P4-03 provisional rules
  remain INSUFFICIENT_EVIDENCE.
- **P4-06 open-track decision:** evidence = 3 real samples, 1 narrative,
  2 transitions, 0 P2 rows, 0 core splits, 0 POSITIVE, 0 STALE/INVALID.
  Standing revalidation trigger preserved (≥10 replay points / ≥3
  narratives, OR any P2 rows, OR core-split conflict, OR STALE/INVALID, OR
  POSITIVE sample). Harness in `src/lib/p4/validation/` is deterministic and
  executable. No P4-06C created.
- **P4-07 limitations retained:** PASS WITH LIMITATIONS (0 real P2 rows,
  single-narrative live data, sandbox-bound latency observation — not an
  SLO, live query-count instrumentation limitation, 16 P3 failures OUT OF
  SCOPE).
- **Test verification (closure re-run):** `npx tsc --noEmit` 0 errors;
  `npx jest src/lib/p4` 129/129; API 12/12; P4 panel UI 14/14; full
  `npx jest` 16 failed / 598 passed — all 16 in `src/lib/p3/__tests__`
  (pre-existing, count unchanged, OUT OF SCOPE). P4 tests GREEN; repository
  NOT globally green.
- **Git boundary:** `git diff -- src/lib/p3` empty; no backend/drizzle/
  migration changes; P4 semantic implementation untouched; only P4-scope
  tracked files modified (route, page, client types, P4 docs).
  `package-lock.json` / `tsconfig.tsbuildinfo` are historical tooling noise,
  not part of the closure, not committed.
- **Known limitations:** P4-06 data insufficiency (by design, standing
  track); P2 unavailable in live data; single-narrative live dataset;
  sandbox latency; P3 kernel failures.
- **P5 handoff:** P5 = NEXT PHASE (action/automation), NOT STARTED; must not
  close P4-06; P4-06 data-accrual/revalidation is a parallel maintenance/
  validation track.

## 21. Document governance

- All P4 documentation belongs under `docs/P4_Upgrade/`.
- Master is phase-level authoritative; task specs provide detailed
  constraints.
- Implementation must not silently create semantic deviations.
- Any semantic change requires: a **versioned amendment**, **documentation
  update**, **impact assessment**, and **affected-task identification** —
  then a bump of `semanticVersion` / `interpretationRuleVersion` as
  appropriate.

## 22. Definition of Done for P4 (phase DoD)

- **Contract:** semantic model frozen; evidence boundary frozen; versioning
  frozen.
- **Interpretation:** deterministic signals; deterministic direction;
  qualitative O/R/C/A; UNKNOWN/conflict rules.
- **Explanation:** evidence-grounded templates; deterministic selection; no
  LLM; failure isolation.
- **Integration:** read path; API; UI.
- **Validation:** historical validation; production validation; regression.
- **Governance:** documentation complete; traceability complete; no P3
  semantic regression.
- **Closure:** P4 closure artifact; release/version recorded; final status
  CLOSED (P4-08).

## 23. Known contradictions (recorded, not silently resolved)

1. **D1 — NEUTRAL:** `docs/P3_Upgrade/P3_DATA_CONTRACT.md` §P3-08 lists Regime
   without NEUTRAL; `src/lib/p3/regime.ts` `P3_REGIMES` includes NEUTRAL and
   production artifact #1 persisted `regime = NEUTRAL`. **Operational truth:
   implementation + persisted artifact.** P3 is not modified.
2. **D2 — Legacy P4 roadmap:** `docs/P3_Upgrade/p3.md` §44/§45 defined P4 as
   "Catalyst & Event Intelligence" and P5 as "Prediction/Backtesting".
   **Reconciled:** current P4 = Decision Support (P4 Core); legacy items are
   P4 Evidence Extensions (Q1). Nothing moved to P5; legacy docs preserved.
3. **D3 — P4-03 prose vs canonical scenarios (five internal contradictions):**
   §9.2 materiality ("OR core-vs-breadth"), §7/§9 Confidence on material
   conflict ("⇒ LOW"), §16 Scenario 3 Confidence ("MEDIUM"), §16 Scenarios
   2/4 signal lists (omitted fired signals), §5 Scenario S2 deltas (exceed
   frozen ε). **Resolved:** P4-05A-REVIEW — the five resolutions are recorded
   authoritatively in §19B and in detail in P4-03 §21; superseded clauses are
   annotated in place. No frozen epsilon, rank, gate, NEUTRAL/MIXED/UNKNOWN
   semantics or signal rule was changed.

## 24. Master freeze criteria

- [x] All P4-01 → P4-04 specs incorporated/referenced (§1, §10, §12, §16).
- [x] No semantic conflict remains unclassified (§23).
- [x] Frozen vs provisional explicit (§11).
- [x] P4 architecture explicit (§6).
- [x] P3/P4/P5 boundary explicit (§2, §4, §5, §7).
- [x] P2/P4 boundary explicit (§7, §10 Q5).
- [x] Read path explicit (§13).
- [x] API/UI contracts explicit (§14, §15).
- [x] Explanation contract explicit (§12, §16).
- [x] Validation strategy explicit (§18).
- [x] Traceability matrix exists (§20).
- [x] humanValue amendment resolved — REJECTED / CLOSED, Alternative B adopted (§16, §25).
- [x] All P4 documents live under `docs/P4_Upgrade/`.
- [x] No production code changed.

## 25. Required decision — humanValue (resolved)

`EvidenceReference.humanValue` was **PROPOSED — NOT FROZEN**. Decision made at
P4-04-IMPL: **Alternative B adopted — `humanValue` NOT ADDED** (REJECTED /
CLOSED). Display values are resolved outside `EvidenceReference` at
template-render time from the in-memory P3 read models, which already carry
deterministic `display`/`scoreDisplay` fields. Implemented by
`src/lib/p4/explanation/resolver.ts`. No future implementation may add
`humanValue` to the frozen contract without a new versioned amendment.

## 26. Verification record

Historical record (Master creation): document-only task — only
`docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md` added; no change under `src/`,
`backend/`, `drizzle/`, configs, API, UI, or tests; P3/P2 untouched;
P4-04-IMPL NOT started at that time.

Current state (2026-08-16): P4-04-IMPL is COMPLETE under `src/lib/p4/` — see
§19A "P4-04-IMPL Implementation Status" (38/38 P4 tests passing, `tsc` → 0
errors, boundary audit clean). This Master was updated by P4-04-DOC.
