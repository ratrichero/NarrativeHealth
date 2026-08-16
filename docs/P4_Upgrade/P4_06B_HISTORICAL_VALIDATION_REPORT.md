# P4-06B — Historical Validation Report

**Phase:** P4 — Intelligence → Decision Support
**Task:** P4-06B-IMPL — Historical Validation Execution
**Status:** EXECUTION COMPLETE — ALL RULES INSUFFICIENT EVIDENCE
**Protocol:** `docs/P4_Upgrade/P4_06B_HISTORICAL_VALIDATION_EXECUTION_SPEC.md` (frozen)
**Authoritative phase document:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md`

This report records what the frozen P4-03 v1 interpretation actually produced
when replayed over the real persisted historical P3 artifacts, and what that
evidence supports. It does NOT claim any rule is validated, and it makes NO
semantic changes.

---

## 1. Executive verdict

**Technical execution: COMPLETE.** The P4-06B protocol was implemented
(as-of loaders, sample builder, mechanical rule evaluation, leakage and
identity controls) and executed against the live database. The production P4
path (`buildP3IntelligenceHistory` → `assembleP4Evidence` → `interpretP4` →
`buildExplanation`) was reused unchanged — no shadow algorithm.

**Semantic validation: NOT ACHIEVED — INSUFFICIENT EVIDENCE for all 9
provisional rules.** The live dataset (3 artifacts, 1 narrative, 2
transitions, 0 P2 rows, 0 conflicting cases, 0 stale/invalid artifacts)
cannot support any rule conclusion. Every rule is classified
INSUFFICIENT_EVIDENCE by the frozen sample policy because at least one
required scenario class is unobserved. Zero contradictions were found in the
observed classes.

**P4-06 phase: NOT COMPLETE.** Completion requires a separate documented
decision after reviewing these results (per the task boundary).

## 2. Dataset inventory (re-queried at execution time)

Re-query of the live DB at execution time confirms the P4-06A inventory is
unchanged:

| Dimension | Actual |
|---|---|
| Narratives | 5 (ids 1, 2, 3, 4, 6 — all active) |
| P3 artifacts | 3 — all narrative 1, `p3-orchestrator`/`1`/`observed`/`7D`, all VALID |
| Artifact ids / windowEnd | 1 (2026-08-11), 9 (2026-08-13), 10 (2026-08-15) |
| P2 event-risk rows | 0 |
| Historical corrections | 1 |
| Narratives with usable history | 1 (narrative 1); narratives 2/3/4/6 have 0 artifacts |
| Duplicate identities | 0 |
| STALE / INVALID artifacts | 0 |

## 3. As-of execution method

Implemented in `src/lib/p4/validation/` (allowed boundary):

- `loaders.ts` — read-only as-of loaders: artifacts `windowEnd <= W`
  (SQL-bounded, leakage-safe), identity-grouped by the latest row ≤ W
  (P4-14 Part C), chronological order, enriched via the production
  `toP3IntelligenceViewModel`; P2 "active as of W" (`createdAt <= W AND not
  expired as of W`; `isActive` deliberately not used — current-state flag).
- `execution.ts` — `buildReplaySamples` (one sample per evaluation window,
  deduplicated by sample identity), `featuresOf`/`classesOf` (scenario-class
  classification from persisted observations only), `evaluateRules`
  (mechanical statuses per the frozen §10 sample policy).
- `replay.ts` / `outcomes.ts` — the P4-06A harness (unchanged).

## 4. Replay samples (real, 3 of 3 eligible windows)

| sampleIdentity | current artifact | seriesLen | status | direction | confidence | risk | opp | act | conflict | p2 | signals |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1\|7D\|p3-orchestrator\|1\|observed\|2026-08-11 | 1 | 1 | DEGRADED | UNKNOWN | LOW | UNKNOWN | UNKNOWN | UNKNOWN | none | none | — |
| 1\|7D\|p3-orchestrator\|1\|observed\|2026-08-13 | 9 | 2 | VALID | NEGATIVE | MEDIUM | HIGH | LOW | HIGH | fired/minor(severity low) | none | NARRATIVE_DETERIORATION, REGIME_CHANGE, ROTATION_CHANGE, LEADERSHIP_CHANGE, EVIDENCE_CONFLICT |
| 1\|7D\|p3-orchestrator\|1\|observed\|2026-08-15 | 10 | 3 | VALID | NEGATIVE | HIGH | HIGH | LOW | HIGH | not fired | none | NARRATIVE_DETERIORATION, NARROWING, ROTATION_CHANGE, LEADERSHIP_CHANGE |

Window 2026-08-13 (moves: regime NEG, rotationScore NEG, momentum NEG,
breadth NEUTRAL, RS POS): NEGATIVE dominant survives an opposing RS
corroborator; minor conflict (breadth/corroborator-only, severity low, not
material — C1 conforming); Confidence MEDIUM (full coverage HIGH − minor −1 —
C2 conforming); Risk HIGH (≥2 NEGATIVE movers); Actionability HIGH
(LOW×HIGH×NEGATIVE×Conf≥MEDIUM §13 override).

Window 2026-08-15 (moves: regime NEUTRAL, rotationScore NEG, momentum NEG,
breadth NEG, RS NEUTRAL): NEGATIVE dominant, no conflict, Confidence HIGH,
Risk HIGH, Actionability HIGH.

Window 2026-08-11: single artifact ⇒ DEGRADED with INSUFFICIENT_HISTORY and
UNKNOWN propagation (§14) — correct frozen behavior.

## 5. Scenario coverage

| Scenario (P4-06B-DOC §9) | Observed? | Sample |
|---|---|---|
| Strong broad improvement | NOT OBSERVED | — |
| Strong concentrated improvement | PARTIALLY (POSITIVE never fires) | — |
| Deterioration | OBSERVED | 08-13, 08-15 |
| Weakening with positive RS | OBSERVED (minor conflict) | 08-13 |
| Neutral/mixed metrics | NOT OBSERVED | — |
| True MIXED (core split) | NOT OBSERVED | — |
| Insufficient history | OBSERVED (degraded) | 08-11 |
| Stale | NOT OBSERVED (no STALE rows) | — |
| P2 high single-coin | NOT OBSERVED (0 P2 rows) | — |
| P2 narrative-wide | NOT OBSERVED (0 P2 rows) | — |
| Current positive / historical deterioration | NOT OBSERVED | — |
| Current negative / historical improvement | NOT OBSERVED | — |

## 6. Rule-by-rule results

All 9 provisional rules: **INSUFFICIENT_EVIDENCE** (0 contradictions, 1
narrative, 3 samples). Observed scenario classes recorded per rule (the
evidence is preserved, not discarded):

| Rule | Observed classes | Status |
|---|---|---|
| R1 Corroborator set / reconciliation | dominant_opposing, no_opposing | INSUFFICIENT_EVIDENCE (tentative_opposing, neutral_split unobserved) |
| R2 Conflict materiality / severity | breadth_only_minor, no_conflict | INSUFFICIENT_EVIDENCE (core_split_1, core_split_2plus unobserved) |
| R3 P2 scope tiers | missing_p2 | INSUFFICIENT_EVIDENCE (all P2 scope classes unobserved) |
| R4 Opportunity suppression ladder | — (no POSITIVE sample) | INSUFFICIENT_EVIDENCE (no ladder case observed) |
| R5 Risk base thresholds | neg_2plus | INSUFFICIENT_EVIDENCE (neg_1, neg_0 unobserved) |
| R6 Confidence combination | cov_full, minor_minus1, insufficient_history | INSUFFICIENT_EVIDENCE (material_cap, divergence_minus1, stale_cap, cov_low, cov_corr1 unobserved) |
| R7 Actionability table | conf_high, conf_medium, matrix_lowxhigh_neg | INSUFFICIENT_EVIDENCE (matrix_highxhigh, material_never_high, p2_never_high unobserved) |
| R8 Opportunity × Risk matrix | lowxhigh | INSUFFICIENT_EVIDENCE (highxhigh, lowxlow, mediumxmedium unobserved) |
| R9 NARRATIVE_* minimums | deteriorating_fires, not_suppressed_breadth_only | INSUFFICIENT_EVIDENCE (improving_fires, suppressed_core_split unobserved) |

## 7. Evidence supporting each result

- **R1:** two real samples exercise dominant-lean reconciliation (W=9:
  NEGATIVE survives opposing RS; W=15: no opposing). Both conform. Too few
  classes, 1 narrative, no recurrence ⇒ not supportable.
- **R2:** one real minor-conflict sample (W=9: EVIDENCE_CONFLICT severity
  low, material false — C1 conforming) and one no-conflict sample. The core
  question (core split ⇒ material) has zero samples.
- **R3:** zero P2 rows; only `missing_p2` observed.
- **R4:** no POSITIVE Direction sample exists; the ladder is untestable.
- **R5:** two samples on the ≥2-NEGATIVE branch, both Risk HIGH (conforming);
  MEDIUM and LOW branches unobserved.
- **R6:** full-coverage HIGH (W=15), minor-conflict MEDIUM (W=9), and
  insufficient-history LOW (W=11) observed conforming; the material-conflict
  cap (C2's central clause) unobserved.
- **R7:** §13 LOW×HIGH×NEGATIVE override observed conforming twice; HIGH×HIGH
  and P2/material caps unobserved.
- **R8:** only the LOW×HIGH cell observed; the HIGH×HIGH cell (the matrix's
  distinctive clause) unobserved.
- **R9:** NARRATIVE_DETERIORATION fired correctly in both VALID samples
  (matching trend + core corroborators, no core split); breadth-only
  opposition at W=9 did NOT suppress it (C4 conforming). The improvement side
  and core-split suppression unobserved.

## 8. Outcome-label availability

Outcomes derived for the real samples (narrative-state evolution only —
no price/return labels):

- W=1 (UNKNOWN): 6 outcome labels; `trendRelation` = NOT_APPLICABLE (UNKNOWN
  direction makes no directional prediction — correct).
- W=9 (NEGATIVE): momentum over the horizon continued deteriorating
  (trend_overall_evolution = DETERIORATING) ⇒ **trendRelation =
  CONTINUATION**; regime WEAKENING → WEAKENING (CONTINUATION); rotation
  INFLOW → STABLE (CHANGE); breadth DETERIORATING (CHANGE); RS STABLE; leader
  22 → 12 (CHANGE).
- W=15: no subsequent artifacts ⇒ 0 outcomes (never fabricated).

Only 1 evaluable horizon exists; outcome evidence is insufficient for any
rule.

## 9. Conflict validation

- Real conflicts observed: 1 (W=9, EVIDENCE_CONFLICT, severity low,
  material=false — a breadth/corroborator-vs-core minor conflict per C1).
- It conformed to the frozen C1 semantics (minor, not material) and the C2
  confidence impact (−1 → MEDIUM, not capped since not material).
- Core-split materiality and MEDIUM-cap-on-material behavior: **zero real
  samples** ⇒ INSUFFICIENT_EVIDENCE. No conflicts were manufactured.

## 10. P2 validation

- Live DB has **0 `event_risks` rows** ⇒ `missing_p2` is the only observed
  class; all P2 scope-tier rules remain INSUFFICIENT_EVIDENCE.
- The as-of P2 loader implements the frozen contract (`createdAt <= W`,
  not-expired-as-of-W, narrative-wide + coin-local split, provenance
  `P2_EVENT_RISK`); it is tested for the empty case and mechanically verified.
- P2 Decision Engine numeric thresholds are NOT reused anywhere.

## 11. Leakage audit

- **PASS.** The as-of loader bounds its query with `windowEnd <= W` in SQL
  (structurally impossible to fetch future rows), `seriesUpTo` truncates
  prefixes, and outcome derivation consumes only caller-supplied
  post-horizon artifacts.
- Test: same historical prefix + different future tail ⇒ identical replay
  record (modulo `generatedAt`). Loader test: `asOfRows` never returns rows
  after W.

## 12. Identity / duplication audit

- **PASS.** Sample identity is the full
  `(narrativeId, window, algorithmKey, algorithmVersion, calculationMode, windowEnd)`;
  all 3 samples have distinct identities; no duplicate sample was produced.
- `selectIdentityGroup` keeps only the latest row's identity group (tested
  with mixed-version rows); `assertSameIdentity` rejects mixed series;
  replay of a mixed-identity series returns null (tested).
- One artifact appears as the current artifact of exactly one sample.
- Narratives 2/3/4/6 produced zero samples (no fabrication).

## 13. Production-path audit

- **PASS.** The replay invokes the production `interpretP4` and
  `buildExplanation` directly (via `replayP4AtWindow`). No interpretation
  logic is duplicated in validation code; `src/lib/p4/interpretation.ts` and
  `src/lib/p4/explanation/**` are untouched.
- No P3/P2 kernel invocation, no writes, no P2 threshold reuse.

## 14. Contradictions

**None.** All observed scenario classes conformed to the frozen rules
(0 contradictions across the 9 rules × 3 samples). The evaluation machinery
detects contradictions (tested with a tampered sample ⇒ CONTRADICTED), so the
"none" result is meaningful. Nothing was silently adapted.

## 15. Data limitations

- 2 real transitions, 1 narrative, 3 samples (1 degraded): far below any
  meaningful sufficiency.
- 0 P2 rows; 0 core-split conflicts; 0 POSITIVE-direction samples; 0
  STALE/INVALID artifacts; no cross-narrative evidence.
- The P3-15 scheduler must accrue more artifacts before re-running; until
  then every rule conclusion stays INSUFFICIENT_EVIDENCE.

## 16. Promotion decision for every provisional rule

| Rule | Promotion | Decision |
|---|---|---|
| R1 | none | INSUFFICIENT_EVIDENCE (no promotion) |
| R2 | none | INSUFFICIENT_EVIDENCE (no promotion) |
| R3 | none | INSUFFICIENT_EVIDENCE (no promotion) |
| R4 | none | INSUFFICIENT_EVIDENCE (no promotion) |
| R5 | none | INSUFFICIENT_EVIDENCE (no promotion) |
| R6 | none | INSUFFICIENT_EVIDENCE (no promotion) |
| R7 | none | INSUFFICIENT_EVIDENCE (no promotion) |
| R8 | none | INSUFFICIENT_EVIDENCE (no promotion) |
| R9 | none | INSUFFICIENT_EVIDENCE (no promotion) |

No rule is VALIDATED, PARTIALLY_SUPPORTED, or CONTRADICTED. No rule is
modified.

## 17. Remaining gaps

- More same-identity artifacts per narrative (≥10 windows) with scenario
  variety (POSITIVE, core splits, stale/invalid states).
- P2 event-risk history (any rows).
- Cross-narrative coverage (narratives 2/3/4/6 need artifacts).
- A separate synthetic-validation track, only if explicitly approved, for
  mechanics (never for promotion).

## 18. Recommendation for P4-06

- **Do not close P4-06.** Re-run this execution as artifacts accrue
  (the harness is deterministic and ready: `executeHistoricalValidation`
  path via the loaders + `evaluateRules`).
- No P4-03/P4-04 semantic change is indicated by this evidence.
- Keep the observed conforming classes (R1 dominant-reconciliation, R2
  minor-conflict, R5 HIGH branch, R6 coverage/minor, R7 §13 override, R9
  deterioration + C4 non-suppression) as the early, weak signal to confirm as
  data grows — none of it is promotable today.

## 19. Test / verification results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx jest src/lib/p4/validation` | 21/21 (11 harness + 10 execution/loader) |
| `npx jest src/lib/p4` | 111/111 (no regression) |
| `npx jest src/app/api/narratives` | 12/12 (no regression) |

The known 16 pre-existing P3 kernel failures remain OUT OF SCOPE and
untouched.

---

*End of P4-06B validation report. Phase status: see
P4_MASTER_SPECIFICATION.md. P4-06 completion requires a separate documented
decision.*
