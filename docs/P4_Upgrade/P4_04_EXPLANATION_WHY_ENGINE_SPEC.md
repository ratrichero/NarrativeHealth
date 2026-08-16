# P4-04 — Explanation / Why Engine Specification

**Status:** SPECIFICATION + IMPLEMENTATION-BOUNDARY only. No production code,
no P3/P2 modification, no new scoring semantics, no API/UI implementation, no
database change.

**Baseline (frozen, mandatory):**
- `docs/P4_Upgrade/P4_01_DECISION_SUPPORT_CONTRACT_AND_GAP_AUDIT.md` (+ P4-01A Q1–Q5)
- `docs/P4_Upgrade/P4_02_SEMANTIC_CONTRACT_AND_READ_PATH_SPEC.md` (EvidenceReference, ViewModel)
- `docs/P4_Upgrade/P4_03_DECISION_INTERPRETATION_AND_QUALITATIVE_SCORING_SPEC.md` (interpretation rules)

**Core rule:** P4-03 decides WHAT the decision-support result is; P4-04
explains WHY it was produced. The Explanation Engine consumes P4-03 typed
output + its evidence references. It never independently reinterprets P3
evidence into a different decision and never recalculates P3 metrics.

---

## 1. Core design principle

Deterministic · template-based · evidence-grounded · traceable ·
human-readable · reproducible · versionable · **non-LLM**.

Banned: LLM generation, free-form hallucinated text, hidden inference,
unsupported adjectives, new scoring, new thresholds, new P3 calculations.

Every material statement must be traceable to one or more `EvidenceReference`
objects (P4-02 §5 contract, reused verbatim — §3 below).

## 2. Explanation architecture

```text
P3 persisted evidence
+
P2 secondary evidence
        ↓
P4-03 interpretation          (decision logic — decides WHAT)
        ↓
P4-04 explanation selection   (explanation logic — decides WHY)
        ↓
Explanation items
        ↓
P4DecisionSupportViewModel.explanation
```

**Separation:** P4-03 = decision logic; P4-04 = explanation logic. P4-04 must
NOT directly recalculate P3 metrics; it only selects and renders evidence that
P4-03 already used.

## 3. Explanation object contract

### 3.1 `ExplanationItem`

| Field | Type | Required | Meaning |
|---|---|---|---|
| id | `string` | ✅ | Stable item id within the explanation, e.g. `exp:direction:1` |
| statement | `string` | ✅ | Template-derived, human-readable sentence (§12) |
| role | `"primary" \| "conflicting" \| "contextual" \| "caveat"` | ✅ | Item role in the composition (§19) |
| supportingEvidence | `EvidenceReference[]` | ✅ (≥1 unless structural UI label) | Evidence that supports the statement |
| conflictingEvidence | `EvidenceReference[]` | ⬜ (default []) | Evidence that argues against the statement (kept visible) |
| contextualEvidence | `EvidenceReference[]` | ⬜ (default []) | Historical/secondary context |
| severity | `"low" \| "medium" \| "high"` | ⬜ | Only when justified by the P4-03 conflict severity (§9 P4-03); presentation-only |
| sourceReferences | `string[]` | ✅ | Artifact ids / event ids referenced |
| semanticVersion / algorithmVersion / explanationVersion | `string` | ✅ | §24 versioning (attribution) |
| generatedAt | ISO UTC | ✅ | Read-time derivation timestamp |

Every explanation item must have **at least one evidence reference** unless it
is a purely structural UI label (e.g., section heading). No field is invented
without a consumer: all fields above are consumed by the ViewModel/UI or the
audit metadata.

### 3.2 EvidenceReference (reused from P4-02 — NOT redefined)

```text
sourceLayer | sourceType | sourceId | artifactIdentity | narrativeIdentity
  | windowOrDate | field | status | interpretationRole
```

**Resolved contract amendment (P4-04-IMPL):** the proposed `humanValue`
amendment (`humanValue: string | null` on EvidenceReference) is
**REJECTED / CLOSED** by the P4 Master decision (§16/§25 Master). Display
values are resolved **outside** EvidenceReference at template-render time
(Alternative B — implemented in `src/lib/p4/explanation/resolver.ts`) from
the in-memory P3 read models' deterministic display fields
(`display`/`scoreDisplay`). `humanValue` is NOT added to any contract.

## 4. Evidence selection rules (deterministic, presentation limits)

- **Maximums (frozen):** primary ≤ 3; conflicting ≤ 2; contextual ≤ 2.
- **Ranking:** ordered precedence tiers (§5) — no arithmetic weights.
- **Tie-breaking:** windowOrDate desc (most recent first); then sourceLayer
  (P3 before P2); then sourceType; then sourceId asc.
- **Deduplication:** an EvidenceReference is deduplicated by full identity
  (all fields); a deduped reference appears once per item.
- **Identity compatibility:** only references belonging to the same
  `narrativeIdentity` (+ same algorithm/mode/window for P3) are eligible.
- **Current-vs-historical preference:** current artifact evidence ranks above
  historical step evidence for current-state statements; step evidence ranks
  above current for movement statements (per P4-03 conclusion type).
- **Structural-vs-event preference:** P3 structural evidence ranks above P2
  event evidence in every role except caveat/context where P2 is discussed.
- **Provenance quality:** VALID status ranks above STALE/PARTIAL;
  STALE/INVALID evidence is excluded from `supportingEvidence` (it may appear
  only in `contextualEvidence`/`caveat` with its status shown).
- **Conflict preference:** when a P4-03 conclusion carries a conflict, the
  strongest opposing evidence is kept for the `conflicting` slot even if a
  stronger supporting item exists (conflict is never hidden).
- **Limit enforcement:** selection order is deterministic; exceeding limits
  truncates from the lowest-ranked items. Limits never change P4-03
  interpretation.

## 5. Evidence ranking (precedence, not arithmetic)

Tiered ordered rules (highest tier wins; within tier, §4 tie-breaks):

```text
Tier 1 — direct driver: evidence that P4-03 recorded as the deciding
         evidence for this conclusion (role primary in the P4-03 trace).
Tier 2 — corroborator: evidence that P4-03 used as confirmation.
Tier 3 — current relevance: latest-window evidence over older evidence.
Tier 4 — explanatory value: the evidence whose value differs most from a
         neutral reading (largest |delta| over frozen ε) — ordinal, not a
         weight; computed only among Tier-1/2 candidates.
Tier 5 — provenance: VALID > STALE/PARTIAL (STALE only contextual).
```

No numeric scoring is introduced; ties use the §4 deterministic tie-breaks.

## 6. Primary evidence rules (per signal, deterministic)

| P4-03 signal | Preferred primary evidence (Tier-1 order) |
|---|---|
| NARRATIVE_IMPROVEMENT | trend.overall = IMPROVING; then first corroborator in {regimeMove, rotationScoreMove, momentumMove} = POSITIVE |
| NARRATIVE_DETERIORATION | trend.overall = DETERIORATING; then first corroborator in {regimeMove, rotationScoreMove, momentumMove} = NEGATIVE |
| BROADENING | breadthMove = POSITIVE (latest step breadth delta) |
| NARROWING | breadthMove = NEGATIVE |
| LEADERSHIP_CHANGE | previous leader reference; current leader reference |
| REGIME_CHANGE | previous regime; current regime |
| ROTATION_CHANGE | previous rotation; current rotation (+ rotationScore delta) |
| EVIDENCE_CONFLICT | strongest POSITIVE move; strongest NEGATIVE move (both Tier-1) |

These preferred orders do not override P4-03 — they only choose which of the
evidence P4-03 already used gets rendered first.

## 7. Conflicting evidence rules

- For EVIDENCE_CONFLICT, the explanation must expose both sides explicitly:
  "Momentum is improving, while breadth is narrowing." Each side must carry
  its own EvidenceReference(s) (supporting vs conflicting).
- Conflict is never hidden to make the explanation cleaner.
- A conflicting item may be attached to any statement when P4-03 recorded a
  conflict for that conclusion (§9 P4-03 materiality governs severity).

## 8. Contextual evidence

- Historical/context evidence appears when it is representable and relevant:
  - Current POSITIVE + historical DETERIORATING ⇒ "Current conditions are
    positive, although historical trend remains deteriorating." (Direction
    unchanged.)
  - Current NEGATIVE + historical IMPROVING ⇒ "Current conditions are
    negative, although historical trend has been improving."
- Contextual items must be framed as historical/secondary; they never mutate
  P4-03 outputs.

## 9. Human-language templates

Template families — every sentence must be reconstructible from actual
evidence values (placeholders filled from resolved display values per
Alternative B, §3.2 — values keyed by evidence identity and resolved outside
EvidenceReference; no free prose).

### 9.1 Direction

| State | Template (exact families) |
|---|---|
| POSITIVE | "Direction is positive: {evidence summary}." |
| NEGATIVE | "Direction is negative: {evidence summary}." |
| MIXED | "Direction is mixed: {supporting} while {conflicting}." |
| NEUTRAL | "Direction is neutral: evidence shows no material change." |
| UNKNOWN | "Direction is unavailable: {reason}." (reason from §10) |

### 9.2 Opportunity

| State | Template |
|---|---|
| HIGH | "Opportunity context is favorable: {supporting evidence}." |
| MEDIUM | "Opportunity context is moderately favorable: {supporting}; {suppression note}." |
| LOW | "Opportunity context is limited: {reason}." |
| UNKNOWN | "Opportunity cannot be assessed: {reason}." |

### 9.3 Risk

| State | Template |
|---|---|
| HIGH | "Risk is elevated: {deterioration evidence}." |
| MEDIUM | "Risk is moderate: {evidence}." |
| LOW | "Risk is low: {evidence}." |
| UNKNOWN | "Risk cannot be assessed: {reason}." |

### 9.4 Confidence

| State | Template |
|---|---|
| HIGH | "Confidence is high: evidence is {coverage/consistency description}." |
| MEDIUM | "Confidence is moderate: {limitation}." |
| LOW | "Confidence is limited: {limitation}." |
| UNKNOWN | "Confidence is unavailable: {reason}." |

### 9.5 Actionability

| State | Template |
|---|---|
| HIGH | "This warrants attention: {decision context}." |
| MEDIUM | "Worth watching: {decision context}." |
| LOW | "No decision-relevant change right now." |
| UNKNOWN | "Actionability cannot be assessed: {reason}." |

## 10. Signal explanations (all 8)

For every signal: `title`, human statement template, required evidence
placeholders, conflicting-evidence handling, absent-data behavior. **No signal
may emit a statement when its P4-03 firing rule was not satisfied.**

| Signal | Title | Statement template | Conflicting | Absent data |
|---|---|---|---|---|
| NARRATIVE_IMPROVEMENT | Narrative improving | "Narrative is improving: overall trend is improving with {corroborator}." | opposing corroborator appended: "despite {metric} weakening" | no statement (signal not fired) |
| NARRATIVE_DETERIORATION | Narrative weakening | "Narrative is weakening: overall trend is deteriorating with {corroborator}." | opposing corroborator appended | no statement |
| BROADENING | Participation broadening | "Participation is broadening: breadth increased." | — | no statement |
| NARROWING | Participation narrowing | "Participation is narrowing: breadth declined." | — | no statement |
| LEADERSHIP_CHANGE | Leadership change | "Narrative leader changed from {prev.symbol} to {curr.symbol}." | — | no statement when either side unavailable |
| REGIME_CHANGE | Regime change | "Regime moved from {prev} to {curr}." | — | no statement when unranked |
| ROTATION_CHANGE | Rotation change | "Rotation moved from {prev} to {curr} (score {delta})." | — | no statement when unranked |
| EVIDENCE_CONFLICT | Conflicting evidence | "{supporting metric} is improving, while {conflicting metric} is {direction}." | both sides rendered, each with references | fires only per P4-03 rule |

## 11. UNKNOWN / degraded explanations (mandatory)

The engine never returns "Nothing to explain." Every degraded item identifies
the actual reason from available evidence/status:

- Insufficient history: "Direction is unavailable because historical evidence
  is insufficient to support the required interpretation."
- No valid current artifact: "No valid P3 intelligence artifact is available
  for this narrative."
- Stale evidence: "Confidence is limited because required evidence is stale."
- Invalid/ambiguous load-bearing evidence: "Interpretation is unavailable
  because {field} evidence is {INVALID|AMBIGUOUS}."
- Unavailable P2 (only when P2 was expected): "Event-risk evidence is
  unavailable; structural narrative evidence remains available."
- Insufficient history + stale combination: the most load-bearing reason is
  stated first; the second is listed as a caveat item.

Reasons are drawn from the normalized evidence states (§2 P4-03) — never
fabricated.

## 12. P2 Event Risk explanation

- Provenance preserved: any P2-derived statement carries
  `sourceLayer = P2`, `source = P2_EVENT_RISK` in its evidence references.
- Scope preserved: a coin-local event keeps its coin scope — "a high
  event-risk signal affects one tracked constituent ({symbol})"; never "the
  narrative is high risk" unless P4-03 assigned narrative Risk HIGH.
- Narrative-wide events: "a narrative-wide event-risk signal is active" with
  the event reference.
- Conflict framing: P2 evidence that opposes a P3 conclusion appears in
  `conflictingEvidence`/`caveat`, never silently merged into P3 structural
  evidence.

## 13. Provisional-rule transparency

- **User-visible explanation:** never exposes internal terms like
  "PROVISIONAL", "tier", "epsilon", or rule ids.
- **Internal audit metadata:** `explanation[].semanticVersion`,
  `algorithmVersion`, `explanationVersion`, plus per-item source references —
  sufficient to identify the exact rule-set version that produced the
  explanation.
- Auditability is never lost: user text is generated from the same evidence
  refs that internal metadata carries.

## 14. Explanation consistency rules

1. Direction = NEGATIVE ⇒ no statement says "conditions are improving" unless
   explicitly framed as historical/contextual evidence.
2. Risk = LOW ⇒ no language implying HIGH risk.
3. Opportunity = UNKNOWN ⇒ no "opportunity is limited" unless another
   independent P4 field supports it (then it is a caveat, framed as such).
4. Every sentence must be semantically compatible with the P4-03 outputs it
   explains; contradictions between sentences require an explicit
   `conflictingEvidence` framing.

## 15. No unsupported language (banned)

"likely to pump", "will rise", "guaranteed", "safe trade", "buy now",
"sell now", "strong investment", "high return", "probability of profit",
and any prediction/trading-execution phrasing. P4 explanation is decision
support, not prediction or trading execution.

## 16. Explanation composition (standard structure)

```text
Summary        — one sentence: "What is happening and what does it mean?"
Supporting     — up to 3 primary reasons.
Conflicts      — up to 2 conflicting reasons where applicable.
Context        — up to 2 historical/secondary contextual reasons.
Data caveat    — optional when degraded/partial/stale/unknown.
```

Example (matching the P4-04 objective):

```text
What is happening?        Narrative is weakening.
Why?                      • Breadth is narrowing.
                          • Momentum is deteriorating.
                          • Historical trend is deteriorating.
What counters it?         • Relative strength remains positive.
Data caveat?              • Event-risk evidence is unavailable.
```

Every bullet maps to an ExplanationItem with evidence references.

## 17. Explanation length

Deterministic bounds (suitable for the current narrative page UI):
- Summary ≤ 20 words.
- Each item statement ≤ 15 words.
- Total items ≤ 6 (3 primary + 2 conflicting + 2 contextual, plus optional
  caveat, with primary/conflict/context caps from §4).
- The explanation answers "WHY should the user care?", not "what are all the
  current metrics?" — it never restates the P3 panel wholesale.

## 18. Example library (10 canonical examples)

For each: P4-03 result · selected EvidenceReferences · final user-visible
explanation · selection rationale · excluded evidence.

**E1 — Strong broad narrative.** P4-03: Direction POSITIVE, Opportunity HIGH,
Risk LOW, Confidence HIGH, Actionability HIGH; signals NARRATIVE_IMPROVEMENT,
REGIME_CHANGE, BROADENING. Selected: trend.overall (primary), momentumMove +
breadthMove (primary), regime move (primary). Explanation: "Narrative is
improving: overall trend is improving with positive momentum and broadening
breadth; regime moved to STRONG." Excluded: RS (already corroborated; tier
order). 

**E2 — Strong but concentrated.** P4-03: Direction POSITIVE, Opportunity
MEDIUM, Risk MEDIUM, Confidence MEDIUM, Actionability MEDIUM; signals
NARRATIVE_IMPROVEMENT, NARROWING. Selected: trend (primary), breadth NARROWING
(conflicting). Explanation: "Narrative is improving, although participation
is narrowing: breadth declined while momentum remains positive." Excluded:
leadership detail.

**E3 — Clear deterioration.** P4-03: NEGATIVE, Opportunity LOW, Risk HIGH,
Confidence MEDIUM, Actionability HIGH; NARRATIVE_DETERIORATION, REGIME_CHANGE,
NARROWING. Explanation: "Narrative is weakening: overall trend is
deteriorating with negative momentum; breadth is narrowing; regime moved to
WEAKENING." Conflicts: none. 

**E4 — Weakening with positive RS.** P4-03: NEGATIVE, Risk HIGH, Opportunity
LOW, Confidence MEDIUM (conflict), Actionability HIGH; NARRATIVE_DETERIORATION
+ EVIDENCE_CONFLICT (minor). Explanation: "Narrative is weakening: momentum
and rotation are deteriorating, while relative strength remains positive."
Conflicts item: "Relative strength is improving." (both sides referenced).

**E5 — Neutral.** P4-03: Direction NEUTRAL, Opportunity LOW, Risk LOW,
Confidence HIGH, Actionability LOW. Explanation: "Direction is neutral:
evidence shows no material change." Context: "Historical trend is stable."

**E6 — Mixed evidence.** P4-03: Direction MIXED, Opportunity LOW, Risk MEDIUM,
Confidence MEDIUM, Actionability MEDIUM; EVIDENCE_CONFLICT (material).
Explanation: "Direction is mixed: momentum is improving while rotation is
deteriorating." Conflicts rendered explicitly with both references.

**E7 — UNKNOWN (insufficient history).** P4-03: Direction UNKNOWN, Confidence
LOW. Explanation: "Direction is unavailable because historical evidence is
insufficient to support the required interpretation." Caveat: "Only one
same-identity artifact is available."

**E8 — Stale data.** P4-03: Confidence MEDIUM (stale cap), Direction
determinable. Explanation: "Confidence is limited because required evidence
is stale." Caveat references the stale windowEnd.

**E9 — Coin-local P2 event risk.** P4-03: Risk LOW (P2 not projected),
Opportunity HIGH, Confidence HIGH. Explanation: "Narrative conditions remain
positive, while a high event-risk signal affects one tracked constituent
({symbol})." P2 reference carries source = P2_EVENT_RISK and coin scope; Risk
stays LOW (never "narrative is high risk").

**E10 — Narrative-wide P2 event risk.** P4-03: Risk MEDIUM (structural LOW +1),
Opportunity MEDIUM. Explanation: "A narrative-wide event-risk signal is
active; structural conditions remain positive, so risk is moderate." P2
reference with narrative scope; explicit that P2 alone does not set HIGH.

## 19. Read-time implementation boundary (P4-04-IMPL)

```text
P4 read service                 (existing P3 read services, read-only)
        ↓
P4-03 interpretation result     (typed P4-03 output + evidence refs)
        ↓
P4 explanation engine           (P4-04: selection + templates)
        ↓
P4DecisionSupportViewModel.explanation
```

Constraints: read-only · deterministic · stateless where possible · no
database writes · no P3 recalculation · no P2 mutation · **must NOT import
`src/lib/p3/*`** · may consume P3 read-service output and P4-03 typed output
only.

## 20. Failure isolation

- If explanation generation fails, the P4 result is still returned:
  `p4DecisionSupport.explanation = []` plus `status` degraded marker
  (`EXPLANATION_UNAVAILABLE`) in provenance if the ViewModel contract allows.
- An explanation failure must never crash `GET /api/narratives/[id]`; P3 data
  remains unaffected (same try/catch degrade pattern as P3 fields in the
  route).
- Fallback: `explanation = []` (defined degraded representation).

## 21. Versioning

```text
explanationVersion = "1"
relationship:  result attribution = { algorithmVersion "p4-decision-support",
                                      semanticVersion "1",
                                      interpretationRuleVersion "p4-03/v1",
                                      explanationVersion "1" }
reproducibility:  given (algorithmVersion, semanticVersion,
                         explanationVersion, evidence snapshot) →
                         identical explanation text.
```

No persistence implied; explanation is derived at read time.

## 22. Test specification (semantic, not implementation)

Cover: correct evidence selected; correct evidence omitted; primary limit ≤3;
conflict limit ≤2; contextual limit ≤2; deduplication; conflicting evidence
visible; UNKNOWN explanation; stale explanation; P2 scope preserved;
explanation/P4-03 result consistency; no unsupported claims; deterministic
output (same input ⇒ same explanation).

## 23. P4-04 implementation readiness

P4-04 specification is complete when:
- [x] Explanation object contract frozen (§3).
- [x] Evidence selection rules frozen (§4).
- [x] Evidence ranking precedence frozen (§5).
- [x] All 8 signal templates defined (§10).
- [x] Direction templates defined (§9.1).
- [x] Opportunity/Risk/Confidence/Actionability templates defined (§9.2–9.5).
- [x] UNKNOWN/degraded explanations defined (§11).
- [x] P2 Event Risk explanation boundary defined (§12).
- [x] Explanation consistency rules defined (§14).
- [x] 10 canonical examples defined (§18).
- [x] Failure isolation defined (§20).
- [x] Versioning defined (§21).
- [x] No new scoring semantics introduced.

The implementation task is identified separately:
**P4-04-IMPL — Explanation / Why Engine Implementation** (read-only engine,
templates, selection/ranking, failure isolation, tests). **Implemented —
COMPLETE** (see `P4_MASTER_SPECIFICATION.md` §19A "P4-04-IMPL Implementation
Status"; 38/38 P4 tests passing, `npx tsc --noEmit` → 0 errors).

## 24. Strict non-goals

No P3 modification; no P2 modification; no P4-03 rule changes; no database
tables; no migrations; no API implementation; no UI implementation; no LLM;
no ML; no price prediction; no trading recommendation; no new P4 scoring
dimensions.

## 25. Verification record

Specification task record (historical):
- Baseline contracts P4-01/P4-01A/P4-02/P4-03 read and honored verbatim;
  EvidenceReference reused; the proposed `humanValue` amendment (§3.2) is now
  **RESOLVED — REJECTED / CLOSED** per the P4 Master decision (Alternative B).
- Document-only task at the time: only this spec file added; no change under
  `src/`, `backend/`, `drizzle/`, configs, API, UI, or tests.

P4-04-IMPL implementation record (see `P4_MASTER_SPECIFICATION.md` §19A):
- Implementation COMPLETE under `src/lib/p4/` (types, evidence
  selection/ranking, resolver, templates, engine) with semantic tests
  (`npx jest src/lib/p4` → 38/38 passing; `npx tsc --noEmit` → 0 errors).
- Determinism: same (interpretation, evidence snapshot, version tuple) ⇒
  identical semantic output; `generatedAt` is metadata excluded from
  semantic equality.
- P3/P2 untouched; no scoring introduced; no semantic deviation reported.
