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
| EvidenceReference | P4 | Traceable evidence pointer | P4-02 §5 fields | FROZEN (amendment pending, §12) |
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
| Conflict materiality + severity | PROVISIONAL | P4-03 §9 | P4 historical validation |
| P2 scope tiers (multi-coin ≥2; narrative-wide +1 cap HIGH) | PROVISIONAL | P4-03 §10/§11 | P4 historical validation |
| Opportunity suppression ladder | PROVISIONAL | P4-03 §12 | P4 historical validation |
| Risk base thresholds (≥2 DET HIGH / 1 MEDIUM / 0 LOW) | PROVISIONAL | P4-03 §12 | P4 historical validation |
| Confidence combination rubric + caps | PROVISIONAL | P4-03 §7 | P4 historical validation |
| Actionability table | PROVISIONAL | P4-03 §8 | P4 historical validation |
| Opportunity × Risk explanation matrix | PROVISIONAL | P4-03 §13 | P4 historical validation |
| NARRATIVE_* corroboration minimums | PROVISIONAL | P4-03 §3.10 | P4 historical validation |

**PROVISIONAL does not mean optional.** It means approved for implementation
but requires empirical validation in P4 historical validation (§13 Master).
PROVISIONAL rules are not hidden; they are auditable via
`interpretationRuleVersion` (P4-03 §17).

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

**Pending amendment — `EvidenceReference.humanValue`:**
**Status: PROPOSED CONTRACT AMENDMENT — NOT YET FROZEN.**
Alternatives: **A.** add `humanValue` to EvidenceReference; **B.** resolve the
display value outside EvidenceReference at template-render time.

**Recommendation (this Master): Alternative B.** The P3 read models already
carry deterministic human-readable display fields for every stage
(`regime.display`, `rotation.scoreDisplay`, `breadth.display`,
`momentum.display`, `relativeStrength.display`, `leadership.scoreDisplay`),
and P4-04 consumes those read models in memory. Given an EvidenceReference's
`artifactIdentity + field`, the template engine can deterministically resolve
the display value from the same read model the reference was derived from —
no contract extension required. Amendment A is therefore unnecessary and
would add redundancy to the frozen reference contract.

**Gating decision:** P4-04-IMPL may NOT start until this humanValue contract
decision is resolved, or explicitly deferred without blocking implementation
(§25 Master).

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
| P4-04-IMPL | Explanation Engine | ⏳ PENDING (gated on humanValue decision or explicit deferral) |
| P4-05 | Decision Support UI | FUTURE |
| P4-06 | Historical Decision Validation | FUTURE |
| P4-07 | Production Validation | FUTURE |
| P4-08 | P4 Closure | FUTURE |

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
- [x] humanValue amendment explicitly pending (§16, §25).
- [x] All P4 documents live under `docs/P4_Upgrade/`.
- [x] No production code changed.

## 25. Required decision — humanValue (gating)

`EvidenceReference.humanValue` is **PROPOSED — NOT FROZEN**. This Master
recommends **Alternative B** (resolve display values outside
EvidenceReference at template-render time from the in-memory P3 read models,
which already carry deterministic `display`/`scoreDisplay` fields). The
decision must be resolved, or explicitly deferred without blocking
implementation, before P4-04-IMPL can start.

## 26. Verification record

Document-only task: only `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md` added;
no change under `src/`, `backend/`, `drizzle/`, configs, API, UI, or tests.
P3/P2 untouched; no implementation started; P4-04-IMPL NOT started.
