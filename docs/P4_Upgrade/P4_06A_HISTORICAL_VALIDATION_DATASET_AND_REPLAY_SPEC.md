# P4-06A — Historical Decision Validation: Dataset & Replay Framework (Spec)

**Phase:** P4 — Intelligence → Decision Support
**Task:** P4-06A — Historical Decision Validation Dataset & Replay Framework
**Status:** COMPLETE — PASS WITH DATA LIMITATIONS
**Authoritative phase document:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md`

This document is a **SPECIFICATION / FRAMEWORK** record. It defines how the
frozen P4-03 v1 rules will be validated against historical P3 artifacts in
P4-06B. It does NOT decide whether any provisional rule should change, does
NOT optimize thresholds, and does NOT claim that any P4 rule is validated.

---

## 1. Objective

Establish a reproducible historical validation framework that replays the
frozen P4-03 v1 interpretation rules against historical P3 artifacts, using
the EXISTING P4 interpretation implementation, and records observation /
interpretation / outcome per snapshot with full provenance.

The ONLY goal of P4-06A is a trustworthy foundation for P4-06B.

## 2. Scope

In scope:
- Historical data inventory (actual persisted rows).
- Validation-unit and identity contract.
- Deterministic replay design (reuses `interpretP4`).
- Machine-readable dataset schema (observation / interpretation / outcome /
  human review).
- Outcome-label policy (narrative-state evolution only).
- Provisional-rule coverage matrix and data-sufficiency rules.
- Leakage and safety controls.

Out of scope (P4-06B or later):
- Running the final validation conclusions.
- Any P4-03 rule change, threshold/epsilon change, or new scoring.
- Price-return prediction labels.
- API / UI / DB / schema changes.

## 3. Historical data inventory (actual, from the live read-only DB)

Inventory was produced by read-only queries over the persisted tables
(`p3_narrative_intelligence`, `event_risks`, `p3_historical_corrections`,
`narratives`). No data was invented.

| Dimension | Actual |
|---|---|
| Narratives | **5** (id 1 AI, 2 RWA, 3 TOPMC, 4 FAVORITE, 6 RESTAKING — all active) |
| P3 artifacts | **3** — all narrative 1 |
| Artifact identity | `p3-orchestrator` / version `1` / `observed` / window `7D` (from persisted `provenance.context.window`) |
| Artifact availability | all `VALID` |
| Duplicate identities | **0** (identity unique constraint: narrativeId, windowEnd, algorithmKey, algorithmVersion, calculationMode) |
| Historical corrections | **1** row in `p3_historical_corrections` (registry exists; immutability/backfill audit point) |
| P2 event-risk rows | **0** (`event_risks` empty) |
| Insufficient-history cases | 0 replay points are blocked by history size; see §13 |
| Invalid/stale artifacts | 0 |

Persisted artifacts (narrative 1, 7D):

| id | windowEnd | regime | rotation | breadth | momentum7d | rs7d | leaderCoin | leaderScore |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-08-11 | NEUTRAL | ACCELERATING | 0.142857 | +14.03 | −0.011 | 10 | 89.29 |
| 9 | 2026-08-13 | WEAKENING | INFLOW | 0.142857 | −0.98 | +0.048 | 22 | 61.35 |
| 10 | 2026-08-15 | WEAKENING | STABLE | 0.000000 | −2.40 | +0.040 | 12 | 55.98 |

Transitions: 1→9 (regime DETERIORATING, rotation DETERIORATING, momentum
DETERIORATING, breadth STABLE) and 9→10 (regime STABLE, rotation
DETERIORATING, momentum DETERIORATING, breadth DETERIORATING).

**Eligible replay points: 2** — the series prefix ending at artifact 9
(`[1, 9]`) and ending at artifact 10 (`[1, 9, 10]`).

Data gaps:
- Narratives 2, 3, 4, 6 have **zero** artifacts (no P3 history to replay).
- **No P2 event-risk history** at all (0 rows) → P2-scope rules have no
  samples.
- Only 1 narrative → no cross-narrative sample diversity.
- No conflicting-case artifacts in the current window set.

## 4. Validation unit

The canonical replay unit (recommended and adopted):

```
(narrativeId, windowEnd, algorithmKey, algorithmVersion, calculationMode)
```

A replay snapshot = the same-identity ascending series of persisted artifacts
with `windowEnd <= W` (the evaluation window) plus the P2 events relevant as
of W. A replay must NEVER mix artifacts from different identities.

Replay unit contents:
- **current artifact** — the last series artifact (window W).
- **preceding historical artifacts** — the same-identity prefix.
- **frozen trend state** — derived by `buildP3IntelligenceHistory` (P3-14
  D.1/D.2; already frozen).
- **P4 input evidence** — refs/values produced by the P4 mapper/assembler.
- **P4 interpretation version** — `p4-03/v1` (frozen).
- **P4 explanation version** — `1` (frozen).

## 5. Identity rules

- Full identity = `(narrativeId, window, algorithmKey, algorithmVersion,
  calculationMode)`.
- The replay harness (`assertSameIdentity`) REJECTS any series that mixes
  identities (returns `null`, never silently re-groups) — P4-02 §7.
- Historical evidence must be identity-compatible with the current artifact
  (the P4 assembler's `validateIdentity` is reused).
- Artifacts with empty identity fields are never guessed (P4-02 §7
  IDENTITY_AMBIGUOUS).

## 6. Replay model

The replay REUSES the production interpretation path — it is not a second P4
algorithm:

```
series (same identity, windowEnd <= W)
  → buildP3IntelligenceHistory        (existing P3-18 pure function)
  → classifyP2 + assembleP4Evidence   (existing P4-05A pure assembly)
  → interpretP4                       (existing P4-03 engine)
  → buildExplanation                  (existing P4-04 engine)
  → ReplayRecord                      (dataset schema, below)
```

Implemented as the pure harness `src/lib/p4/validation/replay.ts`
(`replayP4AtWindow`, `seriesUpTo`). Determinism is guaranteed: identical
input ⇒ identical record, modulo the metadata-only `generatedAt` (verified
by test). The DB-side "as-of" loaders (SELECT artifacts with `windowEnd <= W`,
enrich leaders/constituents, active P2 as of W) are P4-06B implementation
items — the harness is pure and receives already-loaded persisted rows.

## 7. Dataset schema (machine-readable)

Every replay record (`ReplayRecord` in `src/lib/p4/validation/types.ts`):

| Field | Kind | Notes |
|---|---|---|
| identity {narrativeId, window, algorithmKey, algorithmVersion, calculationMode} | OBSERVATION | persisted artifact identity |
| windowEnd / artifactId / precedingArtifactIds | OBSERVATION | persisted rows |
| semanticVersion / interpretationRuleVersion / explanationVersion | INTERPRETATION | frozen v1 tuple |
| status (VALID/DEGRADED/UNAVAILABLE) | INTERPRETATION | |
| direction, opportunity, risk, confidence, actionability | INTERPRETATION | P4-03 v1 outputs |
| signals[] (with evidenceKeys) | INTERPRETATION | fired signals |
| conflict {fired, material, severity} | INTERPRETATION | derived from the EVIDENCE_CONFLICT signal (C1 materiality) |
| degradation[] | INTERPRETATION | P4-03 §14 codes |
| evidence[] (EvidenceReference) | OBSERVATION + role | persisted rows with P4 roles |
| p2Scope | OBSERVATION | P4-03 §10 classification of persisted P2 rows |
| generatedAt | METADATA | excluded from semantic equality |

Outcome labels (`OutcomeLabel`): id, interpretation (P4 v1 value), observation
(persisted state at horizon), relation, sourceArtifactIds, horizonWindows.
Human review is NEVER stored in the same structure as objective outcome; it
is an optional, clearly-labeled separate field set (P4-06B), never merged.

## 8. Observation vs interpretation vs outcome

- **A. OBSERVATION** — what P3 actually persisted: artifact rows, values,
  classifications, identity, availability states.
- **B. INTERPRETATION** — what P4-03 v1 concluded from those observations
  (Direction, signals, O/R/C/A, conflict, degradation).
- **C. OUTCOME** — what the persisted record subsequently said (narrative-state
  evolution at horizon W+k), derived ONLY from artifacts at/after W+k with
  full provenance (source artifact ids, horizon windows).
- **D. HUMAN REVIEW** — optional expert judgement, clearly separated, never
  confused with objective outcome.

## 9. Outcome-label policy

Defined outcome labels (narrative-state evolution ONLY):

- `trend_overall_evolution` — momentum evolution over the horizon (P3-14 D.2
  classification of persisted deltas) vs the interpretation; relation via
  `trendRelation` (CONTINUATION / REVERSAL / CHANGE / NOT_APPLICABLE).
- `regime_evolution`, `rotation_evolution` — classification continuation/change.
- `breadth_evolution`, `relative_strength_evolution` — descriptive epsilon
  classification of persisted deltas.
- `leadership_persistence` — same leader identity at the horizon.

**No price-return prediction labels.** The repository does persist
`market_price_daily`, but P4 Opportunity is NOT a return prediction and P4
Risk is NOT loss probability; the P4 contract does not permit price-based
validation. The validation question is exclusively: *"Does the P4
interpretation correctly describe subsequent narrative-state evolution?"*

No outcome is fabricated: no subsequent artifacts ⇒ empty outcome set.

## 10. Provenance requirements

Every dataset field carries provenance:
- Interpretation fields reference the exact artifact ids used.
- Outcome fields reference `sourceArtifactIds` (current → horizon, inclusive)
  and `horizonWindows`.
- Evidence references carry the P4 `EvidenceReference` identity contract
  (sourceLayer, sourceType, sourceId, artifactIdentity, field, status, role).
- P2 evidence carries its P2 scope/provenance (never inflated, never
  overwriting P3 evidence).

## 11. Future-leakage prevention

- Replay input is truncated to `windowEnd <= W` (`seriesUpTo`); the harness
  returns a record only for evidence up to W.
- Verified by test: the same prefix replayed from two series with different
  tails yields byte-identical records (modulo `generatedAt`).
- Outcome derivation consumes ONLY artifacts with `windowEnd > W` supplied
  explicitly by the caller, truncated at the chosen horizon.
- No peeking beyond the evaluation horizon; deterministic ordering (ascending
  `windowEnd`, then artifact id).

## 12. Provisional-rule coverage matrix (P4-06A, v1)

| Provisional rule | Required historical evidence | Available samples | Eligible samples | Validation status |
|---|---|---|---|---|
| Corroborator set / reconciliation (§4) | ≥2-step series with corroborator variation | 2 steps | 2 | PARTIALLY VALIDATABLE |
| Conflict materiality (§9 / C1) | a conflicting-case snapshot | 0 | 0 | NOT YET VALIDATABLE |
| P2 scope tiers (§10) | P2 event rows as of W | 0 | 0 | NOT YET VALIDATABLE |
| Opportunity suppression ladder (§12.3) | POSITIVE snapshots with adverse movers | 2 (both deteriorating) | 1 (POSITIVE at W=9) | PARTIALLY VALIDATABLE |
| Risk base thresholds (§11) | NEGATIVE snapshots + P2 | 2 NEGATIVE-leaning | 2 | PARTIALLY VALIDATABLE |
| Confidence combination (§7) | coverage/consistency variation | 2 steps | 2 | PARTIALLY VALIDATABLE |
| Actionability table (§8/§13) | O/R/C/A combinations | 2 | 2 | PARTIALLY VALIDATABLE |
| Opportunity × Risk matrix | HIGH O × HIGH R | 0 | 0 | NOT YET VALIDATABLE |
| NARRATIVE signal corroboration minimums (§3.2/§3.3) | trend + corroborator snapshots | 2 | 2 | PARTIALLY VALIDATABLE |

Classification meaning:
- VALIDATABLE — enough eligible samples to support a meaningful conclusion.
- PARTIALLY VALIDATABLE — samples exist but are too few / single-narrative to
  be conclusive.
- NOT YET VALIDATABLE — zero eligible samples (conflicts, P2, HIGH×HIGH).

**No rule is classified VALIDATABLE at this time.** No rule is modified based
on sample size.

## 13. Data sufficiency rules

Documented counts (no invented statistical thresholds):

| Metric | Count |
|---|---|
| Sample count (eligible replay points) | 2 |
| Narratives with artifacts | 1 (of 5) |
| Historical transitions | 2 |
| Applicable cases | 2 |
| Degraded cases | 0 |
| Conflicting cases | 0 |
| P2 cases | 0 |

Sufficiency rule: a rule is flagged **INSUFFICIENT EVIDENCE** unless it has
≥3 narratives AND ≥10 eligible samples AND ≥1 conflicting case for the
conflict-dependent rules. Under this rule, **every provisional rule is
currently INSUFFICIENT EVIDENCE** — the correct conclusion is INSUFFICIENT
EVIDENCE, never a forced PASS/FAIL. This status must be re-evaluated as the
P3-15 scheduler persists more artifacts.

## 14. Known data gaps

1. Narratives 2/3/4/6 have zero artifacts.
2. Zero P2 event-risk rows → no P2 evidence history.
3. Single narrative → no cross-narrative diversity.
4. No conflicting-case snapshots → materiality rules unobservable.
5. No invalid/stale artifacts in the current set → STALE/INVALID handling
   cannot be validated from live data (fixture tests cover semantics only).
6. Window coverage: only 7D artifacts; no 1D/3D/14D replay points.

## 15. Validation limitations

- The dataset is far too small to validate provisional rules; P4-06B must
  treat conclusions as INSUFFICIENT EVIDENCE until more artifacts accrue.
- Outcome labels describe narrative-state evolution, not market outcomes —
  by contract.
- P2 "as of W" reconstruction is constrained by `event_risks` (eventDate,
  createdAt, expiresAt, isActive); the historical approval-time semantics
  need explicit P4-06B definition (currently 0 rows, so no impact yet).
- Human review (P4-06C if ever) must be kept separate from objective outcome.

## 16. Acceptance criteria

- [x] Historical data inventory from actual persisted rows (no invention).
- [x] Validation unit + identity contract defined.
- [x] Replay reuses the existing `interpretP4` (no second algorithm).
- [x] Deterministic replay verified by tests (modulo metadata `generatedAt`).
- [x] Dataset schema distinguishes observation / interpretation / outcome /
      human review with provenance.
- [x] Outcome-label policy excludes price-return prediction.
- [x] Provisional-rule coverage matrix with honest VALIDATABLE statuses.
- [x] Data sufficiency documented; INSUFFICIENT EVIDENCE is the conclusion.
- [x] Leakage controls implemented and tested (no future leakage).
- [x] No P4 semantic change, no P3/P2 change, no API/UI/DB change.

## 17. Explicit non-goals

- Deciding whether any provisional rule should change.
- Optimizing thresholds/epsilons against historical results.
- ML / prediction models.
- Price-return labels or backtesting.
- Human review implementation.
- API/UI exposure of validation data.
- Persisting the replay dataset to the database (P4-06B output may be an
  artifact/report, not a schema change).

---

## Implementation record (P4-06A)

A minimal isolated harness was implemented to make the framework concrete and
verifiable. It lives under `src/lib/p4/validation/` and touches no production
path:

- `types.ts` — replay dataset contract (ReplayIdentity, ReplayRecord,
  OutcomeLabel).
- `replay.ts` — pure `replayP4AtWindow` (reuses `buildP3IntelligenceHistory`
  → `assembleP4Evidence` → `interpretP4` → `buildExplanation`), `seriesUpTo`
  (leakage-safe prefix), `assertSameIdentity` (identity guard).
- `outcomes.ts` — pure `deriveOutcomes` + `trendRelation`
  (narrative-state evolution only, frozen P3 epsilons used descriptively).
- `__tests__/validation.test.ts` — 11 tests: latest-window replay, determinism,
  no future leakage, mixed-identity rejection, empty series, insufficient
  history degradation, P2 scope + provenance, outcome derivation,
  continuation/reversal relations, no-outcome-when-empty, UNKNOWN→NOT_APPLICABLE.

Verification: `npx tsc --noEmit` 0 errors; `npx jest src/lib/p4/validation`
11/11; full `npx jest src/lib/p4` 101/101 (no regression).

*End of P4-06A spec. See P4_MASTER_SPECIFICATION.md for phase-level status.*
