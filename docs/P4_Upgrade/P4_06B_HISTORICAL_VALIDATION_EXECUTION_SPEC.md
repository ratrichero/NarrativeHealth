# P4-06B — Historical Validation Execution Specification (Protocol Freeze)

**Phase:** P4 — Intelligence → Decision Support
**Task:** P4-06B-DOC — Historical Validation Execution Specification
**Status:** SPECIFICATION COMPLETE — EXECUTION NOT STARTED
**Authoritative phase document:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md`

This document FREEZES the execution protocol that the later implementation /
execution agent (P4-06B-IMPL) must follow. It is DOCUMENT-ONLY: no historical
validation has been executed, no P4-03/P4-04 semantics are modified, and no
provisional rule is claimed validated.

---

## 1. Purpose and scope

P4-06B executes historical decision validation: it replays the frozen P4-03
v1 interpretation over persisted historical P3 artifacts (via the P4-06A
replay harness), derives narrative-state-evolution outcomes, and produces a
rule-by-rule validation result — with the explicit, honest possibility that
the conclusion for any rule is INSUFFICIENT EVIDENCE.

Scope of this document:
- the validation questions per provisional rule;
- the as-of data and loader contracts;
- the replay and outcome protocols;
- the validation matrix, scenario requirements, sample policy, and
  independence controls;
- contradiction handling, promotion policy, and gate criteria;
- the exact boundary for P4-06B-IMPL.

Out of scope: executing validation, changing semantics, synthetic-data
promotion, price-return labels, API/UI/DB changes, P4-07.

## 2. Relationship to P4-06A (and whether P4-06C exists)

| Task | Role | Status |
|---|---|---|
| P4-06A | Framework / dataset inventory / pure replay harness + outcome derivation | ✅ COMPLETE |
| P4-06B | Actual historical validation execution (this protocol) | SPECIFIED — NOT STARTED |
| P4-06C | NOT PROPOSED. Only introduced if the execution evidence demonstrates a genuinely separate required phase (e.g. a dedicated synthetic-validation track approved separately). No such phase is invented pre-emptively. | — |

P4-06A and P4-06B are two phases of the same validation effort: A defines
*how*, B executes *what*. P4-06B consumes the P4-06A harness
(`src/lib/p4/validation/replay.ts`, `outcomes.ts`, `types.ts`) unchanged.

## 3. Validation questions (per provisional rule)

For every rule below: **hypothesis → required historical evidence → expected
observable behavior → pass criteria → fail criteria → insufficient-evidence
criteria**. No numerical statistical thresholds are invented here; sample
policy (§10) defines sufficiency in qualitative terms.

### 3.1 Corroborator set / reconciliation (P4-03 §4)
- **Hypothesis:** breadth and relative-strength corroborators reconcile a
  Direction lean exactly as §4 Step 3 prescribes (dominant lean survives
  opposing corroborators; tentative lean flips to MIXED; split corroborators
  over a NEUTRAL base → MIXED).
- **Required evidence:** snapshots with (a) dominant lean + opposing
  corroborator, (b) tentative lean + opposing corroborator, (c) NEUTRAL base
  + split corroborators, (d) no opposing corroborators.
- **Expected behavior:** Direction matches the §4.3 decision table for the
  observed move set.
- **Pass:** all observed scenario classes conform.
- **Fail:** any class violates the decision table.
- **Insufficient:** any required scenario class has no sample.

### 3.2 Conflict materiality / severity (P4-03 §9 + C1)
- **Hypothesis:** material = opposite-sign pair inside the direction core
  `{regimeMove, rotationScoreMove, momentumMove}`; core-vs-breadth and
  corroborator-vs-corroborator are MINOR; severity = ≥2 core pairs HIGH /
  1 core pair MEDIUM / minor LOW.
- **Required evidence:** snapshots with (a) core split (1 pair), (b) core
  split (≥2 pairs), (c) breadth-vs-core only, (d) no conflict.
- **Expected behavior:** `EVIDENCE_CONFLICT` fires with the correct severity;
  materiality flags per C1.
- **Pass / Fail / Insufficient:** as above; (c) must NOT be material.

### 3.3 P2 scope tiers (P4-03 §10)
- **Hypothesis:** scope classifies narrative-wide / multi-coin (≥2
  constituents) / coin-local / none; only narrative-wide or multi-coin
  HIGH/CRITICAL raises Risk +1 (cap HIGH, never sole HIGH).
- **Required evidence:** P2 rows with each scope kind + HIGH/CRITICAL and
  LOW/MEDIUM; missing-P2 snapshots.
- **Expected behavior:** scope + Risk tier per §10/§11.
- **Pass / Fail / Insufficient:** as above.

### 3.4 Opportunity suppression ladder (P4-03 §12.3)
- **Hypothesis:** POSITIVE Direction starts HIGH; each adverse mover /
  material conflict / deteriorating trend / narrative-wide HIGH P2 lowers one
  tier, floor LOW; stale caps MEDIUM.
- **Required evidence:** POSITIVE snapshots with 0..N adverse conditions.
- **Expected behavior:** tier = HIGH − (#adverse), floors and caps per §12.3.

### 3.5 Risk base thresholds (P4-03 §11)
- **Hypothesis:** ≥2 NEGATIVE movers or (NEGATIVE + deteriorating trend) ⇒
  HIGH; 1 NEGATIVE mover ⇒ MEDIUM; else LOW; P2 +1 cap HIGH; POSITIVE +
  deteriorating trend +1.
- **Required evidence:** snapshots spanning the threshold boundaries.

### 3.6 Confidence combination (P4-03 §7 + C2)
- **Hypothesis:** base from coverage (core 3 + corroborators 2 ⇒ HIGH;
  core 3 + corroborators 1 ⇒ MEDIUM; else LOW); material conflict caps MEDIUM
  (never HIGH); minor conflict −1; historical divergence −1; stale cap MEDIUM;
  insufficient history ⇒ LOW.
- **Required evidence:** coverage/consistency variation + each cap/floor case.

### 3.7 Actionability table (P4-03 §8/§13)
- **Hypothesis:** the §8 base + §13 matrix overrides (LOW-Opp × HIGH-Risk ×
  NEGATIVE × Conf ≥ MEDIUM ⇒ HIGH; HIGH-Opp × HIGH-Risk ⇒ MEDIUM; material
  conflict ⇒ never HIGH; narrative-wide HIGH P2 ⇒ never HIGH).
- **Required evidence:** the O/R/C/A combinations in the table.

### 3.8 Opportunity × Risk matrix
- **Hypothesis:** the frozen matrix combinations hold (notably HIGH×HIGH ⇒
  MEDIUM actionability; LOW×HIGH ⇒ HIGH under NEGATIVE + Conf ≥ MEDIUM).
- **Required evidence:** the specific matrix cells.

### 3.9 NARRATIVE_* corroboration minimums (P4-03 §3.2/§3.3)
- **Hypothesis:** NARRATIVE_IMPROVEMENT fires only on IMPROVING trend + ≥1
  POSITIVE core corroborator + no core split; NARRATIVE_DETERIORATION
  symmetric.
- **Required evidence:** trend × corroborator combinations incl. suppression
  by core split and non-suppression by breadth-vs-core (C4).

## 4. Historical as-of data contract

For a replay at evaluation window **W** (a persisted `windowEnd`):

- **Horizon W** — the evaluation point; the current artifact is the latest
  persisted artifact with `windowEnd = W` (or the latest with `windowEnd <= W`
  when a gap exists — documented as such, never inferred).
- **Available P3 artifacts at W** — all persisted rows in
  `p3_narrative_intelligence` with `windowEnd <= W`.
- **Series prefix** — the same-identity subset of those rows, ascending by
  (`windowEnd`, `id`), truncated by `seriesUpTo(series, W)`.
- **Current artifact** — the last element of the series prefix.
- **Historical artifact context** — the remainder of the prefix (preceding
  artifacts); the frozen trend/steps are derived by `buildP3IntelligenceHistory`.
- **Post-horizon outcome observation window** — same-identity artifacts with
  `windowEnd > W`, ascending, truncated at the caller-chosen horizon W+k
  (k = number of subsequent windows evaluated); outcomes are derived ONLY from
  these.
- **Identity requirements** — full identity
  `(narrativeId, window, algorithmKey, algorithmVersion, calculationMode)`
  identical across the series prefix and the outcome window (P4-02 §7;
  `assertSameIdentity`).
- **Artifact validity requirements** — artifacts with
  `availabilityState = VALID`; STALE/INVALID/MISSING artifacts are eligible
  as *degradation cases* and must be replayed as-is (never coerced), with the
  resulting DEGRADED/UNKNOWN record kept and flagged.
- **Algorithm identity / calculation mode requirements** — only
  `p3-orchestrator`/`1`/`observed` artifacts are replayed in P4-06B v1 (the
  only persisted mode); any other identity is recorded as an inventory note,
  not replayed.
- **No future leakage** — interpretation input must never include artifacts
  with `windowEnd > W` (§17).

## 5. As-of loader contract (P4-06B-IMPL)

Read-only loaders under `src/lib/p4/validation/` (or a sibling module). Each
loader:

| Loader | Input | Output | Ordering | Filtering | Identity / validity constraints | Missing data | Ambiguous data |
|---|---|---|---|---|---|---|---|
| `loadArtifactSeriesAsOf(narrativeId, W)` | narrativeId, ISO window W | `P3IntelligenceViewModel[]` (ascending) | `windowEnd` asc, `id` asc | `windowEnd <= W`; same identity group (algorithm/version/mode/window) as the latest row ≤ W | full identity; VALID rows primary, STALE/INVALID/MISSING retained as degradation cases with their persisted state | no rows ⇒ `[]` (not an error; replay yields no record) | multiple identities present ⇒ group by the latest row's identity, record the others as inventory notes |
| `loadConstituentsByArtifactAsOf(artifactIds)` | artifact ids | `Record<id, number[] \| null>` | n/a | per `p3_constituent_snapshots` + members | none beyond FK integrity | missing snapshot ⇒ `null` (trend state UNKNOWN) | n/a |
| `loadP2AsOf(narrativeId, W)` | narrativeId, ISO date W | `{narrativeWideEvents, coinLocalEvents}` | `eventDate` asc | active-as-of: `createdAt <= W` AND (`expiresAt IS NULL OR expiresAt >= W`) — the historical analogue of the production active filter | P2 rows only; scope classified by `classifyP2` | 0 rows ⇒ `{[],[]}` (scope `none`) | events with null dates/expiry ⇒ excluded and recorded |

All loaders reuse existing pure transforms (`toP3IntelligenceViewModel`,
`buildP3IntelligenceHistory`, `classifyP2`) and the P4-06A harness. They must
never write, never invoke the P3/P2 kernels, and never reuse P2 Decision
Engine numeric thresholds.

## 6. Replay protocol (exact pipeline)

```
as-of loader (narrativeId, W)
  → P3 historical evidence (same-identity series prefix + constituents + P2-as-of)
  → buildP3IntelligenceHistory          (P3-18, existing)
  → classifyP2 + assembleP4Evidence     (P4-05A, existing)
  → interpretP4                         (P4-03 v1, existing — THE interpretation)
  → buildExplanation                    (P4-04, existing)
  → ReplayRecord                        (P4-06A types)
```

Rules:
- The validation path MUST call the production `interpretP4` / `buildExplanation`
  — no duplicate/shadow algorithm (§16).
- Every replayed window W with ≥1 artifact produces a record (VALID, DEGRADED,
  or null when the P4 service contract says unavailable).
- Deterministic ordering: iterate narratives, then windows ascending; identical
  input ⇒ identical record (modulo metadata `generatedAt`).

## 7. Outcome-label protocol

**Allowed labels** (from P4-06A §9, all narrative-state evolution):
`trend_overall_evolution`, `regime_evolution`, `rotation_evolution`,
`breadth_evolution`, `relative_strength_evolution`, `leadership_persistence`.
Plus any other explicitly persisted P3-state evolution the repository already
supports (e.g. constituents membership change) — never invented ones.

**Forbidden labels:**
- price return as a P4 opportunity label;
- profit/loss / investment return;
- fabricated ground truth;
- manually assigned labels (human review is a separate, clearly-labeled
  channel and never merged with objective outcome).

**Distinctions:**
- **Observed outcome** = persisted P3 state at horizon W+k (classifications,
  values, leader identity).
- **Validation target** = the P4-03 v1 output at W (Direction, O/R/C/A,
  signals, conflict, degradation).
- **Unsupported outcome** = anything not derivable from persisted P3 fields
  (e.g. "correct market call"); such questions are not asked.

## 8. Validation matrix

| Rule | Required scenario | Min. evidence (qualitative) | Available historical cases (P4-06A) | Target sample | Outcome label | Evaluation method | Status |
|---|---|---|---|---|---|---|---|
| Corroborator reconciliation (§4) | dominant/tentative/neutral × corroborator | each scenario class ≥1 | 2 transitions (deteriorating-lean only) | ≥3 narratives, all classes | regime/trend evolution | decision-table conformance | INSUFFICIENT EVIDENCE |
| Conflict materiality/severity (C1) | core split 1-pair, ≥2-pair, breadth-only | each class ≥1 | 0 conflicting cases | ≥1 per class | conflict flag | severity/materiality conformance | INSUFFICIENT EVIDENCE |
| P2 scope tiers (§10) | 4 scopes × risk levels | each scope ≥1 | 0 P2 rows | ≥1 per scope | risk tier delta | scope + tier conformance | INSUFFICIENT EVIDENCE |
| Opportunity ladder (§12.3) | POSITIVE × N adverse | 0..N ladder cases | 1 POSITIVE (W=9) | ≥3 per ladder step | trend/regime evolution | tier conformance | INSUFFICIENT EVIDENCE |
| Risk base thresholds (§11) | NEGATIVE mover counts | threshold boundaries | 2 NEGATIVE-leaning | ≥3 per boundary | trend/regime evolution | tier conformance | INSUFFICIENT EVIDENCE |
| Confidence combination (§7/C2) | coverage × consistency caps | each cap case ≥1 | 2 (no conflict caps) | ≥3 per cap case | trend/regime evolution | cap/floor conformance | INSUFFICIENT EVIDENCE |
| Actionability table (§8/§13) | matrix cells | each cell ≥1 | 2 | ≥1 per cell | n/a (conformance) | table conformance | INSUFFICIENT EVIDENCE |
| Opportunity × Risk matrix | HIGH×HIGH etc. | each cell ≥1 | 0 HIGH×HIGH | ≥1 per cell | n/a (conformance) | matrix conformance | INSUFFICIENT EVIDENCE |
| NARRATIVE_* minimums (§3.2/3.3) | trend × corroborator | each combo ≥1 | 2 (IMPROVING 1, DETERIORATING 1) | ≥3 per combo | signal presence | signal-rule conformance | INSUFFICIENT EVIDENCE |

Statuses are per P4-06A and MUST remain INSUFFICIENT EVIDENCE until the
sample policy (§10) is satisfied.

## 9. Scenario requirements

Required historical scenarios (with observation status from P4-06A; missing
scenarios are NEVER fabricated):

| Scenario | Description | Observed? |
|---|---|---|
| Strong broad improvement | POSITIVE core + POSITIVE breadth/RS | NOT YET OBSERVED |
| Strong concentrated improvement | POSITIVE core, opposing/narrow breadth | PARTIALLY OBSERVED (W=9 POSITIVE lean w/ DETERIORATING breadth) |
| Deterioration | NEGATIVE core across movers | OBSERVED (1→9, 9→10) |
| Weakening with positive RS | NEGATIVE core + POSITIVE RS | PARTIALLY OBSERVED (9→10 RS positive) |
| Neutral/mixed metrics | STABLE moves | NOT YET OBSERVED |
| True MIXED | core split (opposite core signs) | NOT YET OBSERVED |
| Insufficient history | single-artifact prefix | OBSERVED (synthetic harness case only — see §22) |
| Stale | STALE current artifact | NOT YET OBSERVED (no STALE rows) |
| P2 high single-coin | coin-local HIGH P2 | NOT YET OBSERVED (0 P2 rows) |
| P2 narrative-wide | narrative-wide HIGH P2 | NOT YET OBSERVED (0 P2 rows) |
| Current positive / historical deterioration | POSITIVE at W, DETERIORATING trend | NOT YET OBSERVED |
| Current negative / historical improvement | NEGATIVE at W, IMPROVING trend | NOT YET OBSERVED |

## 10. Minimum sample policy (no invented statistics)

A rule's classification is chosen from the four categories below using
qualitative sufficiency criteria — scenario coverage, independence (§11),
recurrence, presence of contradictory cases, data quality, provenance, and
identity consistency. No arbitrary confidence numbers are used; if a numeric
threshold ever becomes necessary, it is marked PROVISIONAL with explicit
justification in the validation report.

- **VALIDATED** — every required scenario class observed across ≥3
  independent narratives with ≥10 independent samples, recurring over time,
  zero unexplained contradictions, full provenance, single identity per sample.
- **PARTIALLY SUPPORTED** — some required classes observed with no
  contradiction, but narrative/sample coverage below VALIDATED.
- **CONTRADICTED** — one or more observed samples violate the frozen rule with
  no spec-level explanation (⇒ contradiction protocol §14 of this document and
  Master §21).
- **INSUFFICIENT EVIDENCE** — any required scenario class unobserved, or
  coverage/independence/recurrence below PARTIALLY SUPPORTED. This is the
  DEFAULT for every rule under the current dataset.

## 11. Independence and duplication controls

- **Sample identity:** `(narrativeId, windowEnd, algorithmKey,
  algorithmVersion, calculationMode)` — a replay sample is exactly one
  evaluation window of one narrative identity.
- One artifact may appear in multiple *prefixes* but only as the **current
  artifact** of exactly ONE sample; a window replayed twice (e.g. via two
  loaders) must be deduplicated by sample identity.
- Overlapping windows are NOT independent: two samples whose prefixes overlap
  by more than half their length are treated as a single independent
  observation for coverage counting.
- The same narrative/day combination is counted once per window.
- Duplicated identity rows are impossible by the DB unique constraint; the
  loader still asserts no duplicates (defense in depth).
- Repeated replay of identical evidence never yields additional independent
  samples.

## 12. Conflict validation (C1/C2 — semantics NOT altered)

Validation verifies the implementation *conforms* to the frozen decisions:

- core split (`regimeMove`×`rotationScoreMove`×`momentumMove` opposite-sign
  pair) ⇒ material;
- core-vs-breadth and corroborator-vs-corroborator ⇒ minor;
- material conflict caps Confidence at MEDIUM (never HIGH);
- minor conflict reduces Confidence one level per the frozen §7 combination.

The validation harness must record, per conflicting sample: `conflict`
`{fired, material, severity}` (from the `EVIDENCE_CONFLICT` signal) and the
resulting Confidence — and compare to the frozen expectations. Any mismatch is
a CONTRADICTED rule, handled by §21 (this document §14).

## 13. P2 validation

- Provenance must be `sourceLayer: "P2"`, `sourceType: "P2_EVENT_RISK"`,
  `artifactIdentity: null`, with scope `{kind, symbols, riskLevel}` preserved
  (P4-03 §10).
- Scenario coverage: narrative-wide, multi-coin (≥2 constituents), coin-local,
  missing P2, partial P2 (single coin-local).
- **P2 Decision Engine numeric thresholds are NOT reused** — only the P2
  qualitative riskLevel and scope classification enter P4.
- With 0 P2 rows in the live DB, all P2 rules remain **unvalidated**
  (INSUFFICIENT EVIDENCE). Fixture-based mechanical checks (§22) may run but
  never promote a rule.

## 14. Qualitative-rule evaluation (O/R/C/A)

- Opportunity, Risk, Confidence, Actionability are evaluated as QUALITATIVE
  tiers (LOW/MEDIUM/HIGH/UNKNOWN) against the frozen decision tables only.
- No conversion to numeric scores, percentages, or rankings.
- Expected vs actual tier is recorded per sample; UNKNOWN propagation and
  degraded caps are part of the expected behavior.

## 15. Explanation validation

P4-04 explanations are validated only for mechanical properties:
- evidence grounding (every statement maps to evidence refs; no invented
  values);
- deterministic reconstruction (same input ⇒ same explanation modulo
  `generatedAt`);
- correct provenance (refs carry the right artifact identity / P2 provenance);
- correct conflict representation (severity/materiality present when fired);
- correct degraded-state explanation (UNKNOWN/degradation codes explain the
  state).
Explanation quality is NOT evaluated as an LLM task.

## 16. Regression / production-path requirement

Historical validation MUST use the same `interpretP4` and `buildExplanation`
implementations as production. No shadow algorithm, no fork, no re-derivation.
The replay harness imports the production modules directly; P4-06B-IMPL must
not copy or inline interpretation logic.

## 17. Leakage tests (mandatory)

Every validation run must pass, and the framework tests must already cover:

- same historical prefix + different future tail ⇒ identical decision output;
- replay input truncated to `windowEnd <= W` before assembly;
- outcome derivation consumes only artifacts with `windowEnd > W`;
- deterministic ordering of samples.

The P4-06A suite already contains these tests
(`src/lib/p4/validation/__tests__/validation.test.ts`); P4-06B-IMPL must keep
them green and add any loader-level leakage tests (e.g. as-of loader never
returns rows after W).

## 18. Validation result schema

Per sample (in-memory; persisted only as a validation report artifact, never
into production tables):

| Field | Source |
|---|---|
| sampleIdentity `(narrativeId, windowEnd, algo, ver, mode)` | OBSERVATION |
| narrativeIdentity | OBSERVATION |
| horizon W, current artifact id, preceding artifact ids | OBSERVATION |
| evidence snapshot identity (refs' identity keys) | OBSERVATION |
| P4 version tuple (semantic, interpretationRule, explanation) | INTERPRETATION |
| P4 output (direction, signals, O/R/C/A, conflict, degradation, status) | INTERPRETATION |
| observed outcome(s) (labels + relations + sourceArtifactIds) | OUTCOME |
| expected behavior (per rule) | SPEC REFERENCE |
| actual behavior (P4 output vs expected) | EVALUATION |
| rule-level result (VALIDATED / PARTIALLY SUPPORTED / CONTRADICTED / INSUFFICIENT) | EVALUATION |
| evidence references | OBSERVATION |
| data sufficiency (comparableArtifacts, requiredMinimum, sufficient) | OBSERVATION |
| contradiction status (none / recorded → §14) | EVALUATION |
| provenance (loaders, artifact rows, query bounds) | METADATA |
| evaluator notes | METADATA |

Production P4 Decision Support data is NOT persisted merely for validation.

## 19. Contradiction handling (Master §21)

Any contradiction must be:
1. recorded;
2. classified (implementation / spec / example / data contradiction);
3. linked to the exact source clauses (document + section + line);
4. assessed for impact;
5. resolved ONLY through an explicit documented decision (spec update →
   decision → implementation review → tests).

Never silently adapt code to historical data. If a contradiction cannot be
classified or requires a semantic change, the execution agent must STOP and
report (per P4-06A §15 and this protocol) rather than patch P4.

## 20. Promotion policy

A PROVISIONAL rule moves categories ONLY through:

```
evidence → evaluation → report → explicit decision → spec update → implementation review → tests
```

- PROVISIONAL → VALIDATED/FROZEN: requires the §10 VALIDATED criteria and an
  explicit recorded decision (Master §21 amendment process).
- PROVISIONAL → PARTIALLY SUPPORTED: documented in the validation report only.
- PROVISIONAL → REQUIRES REVISION: only via the contradiction protocol (§19) —
  never a silent code change.
- PROVISIONAL → INSUFFICIENT EVIDENCE: the default; no decision needed.

**P4-06B itself must NOT silently freeze or rewrite any rule.**

## 21. Current-data execution forecast

From P4-06A's actual inventory:
- current live dataset (2 eligible replay points, 1 narrative) is
  **insufficient for broad validation**;
- P2 rules **cannot be validated** (0 P2 rows);
- conflict materiality **cannot be validated** (0 conflicting cases);
- STALE/INVALID handling **cannot be empirically validated** (no such
  artifacts);
- one narrative is **insufficient for cross-narrative validation**.

No compensation by synthetic data unless a separate, explicitly approved
synthetic-validation track is created (§22).

## 22. Synthetic-data policy

- Synthetic fixtures (the existing P4 test fixtures) MAY validate
  implementation mechanics (determinism, leakage, identity guards, engine
  behavior on crafted inputs).
- Synthetic fixtures MUST NOT be presented as historical validation.
- Synthetic fixtures MUST NOT promote any rule to VALIDATED.
- Provenance must identify synthetic samples as `synthetic` (a distinct
  channel in the report).
- Real historical evidence is preferred for all semantic validation.

## 23. Reporting format (final validation report)

```
1. Executive verdict
2. Dataset (sources, identity groups, windows, counts)
3. Coverage (scenarios observed / partially observed / not observed)
4. Rule-by-rule results (validation matrix with statuses)
5. Scenario coverage
6. Contradictions (recorded + classified per §19)
7. Evidence quality (provenance, validity, gaps)
8. Leakage audit (test results + loader checks)
9. Regression audit (production P4 path reused; full P4 suite result)
10. Decision on each provisional rule (VALIDATED / PARTIALLY SUPPORTED /
    CONTRADICTED / INSUFFICIENT EVIDENCE)
11. Remaining gaps
12. Recommendation (next phase / more data accrual / P4-07 readiness)
```

## 24. Gate criteria (P4-06B COMPLETE)

All of:
- every reachable historical sample replayed (all narratives with artifacts,
  all windows);
- no leakage (tests green, loader checks pass);
- no identity violations (sample dedupe asserted);
- all provisional rules assessed (matrix complete);
- unsupported rules explicitly marked INSUFFICIENT EVIDENCE;
- contradictions documented and classified;
- no silent semantic changes;
- production P4 path reused (no shadow algorithm);
- validation framework + P4 test suites green.

Insufficient data is an ACCEPTABLE final result — rules are not required to
become VALIDATED.

## 25. Relationship to P4-07

- **P4-06** = historical semantic validation (rules behave sensibly over
  historical artifacts).
- **P4-07** = production validation / runtime operational validation (live
  deployment, API/UI behavior, scheduler cadence, operational health).
They must not be mixed: P4-06B's report feeds rule status; P4-07 is a
separate operational task.

## 26. Implementation boundary (P4-06B-IMPL)

**May modify:** historical/as-of loaders, validation execution,
validation-result generation, tests, P4 validation docs/checkpoints.

**Must NOT modify:** P3 kernel, P2 kernel, P4 semantic interpretation
(`src/lib/p4/interpretation.ts`), P4 explanation semantics
(`src/lib/p4/explanation/**`), API, UI, production DB schema (unless an
explicit gap is discovered AND separately approved), `vite.config.ts`,
package-lock, tsbuildinfo.

## 27. Master update

This section is informational: the Master is updated separately (checkpoint/
roadmap only) by this task — no semantic section is rewritten, and P4-06 is
NOT marked complete.

---

## Verification record (this task)

- `git diff --stat` / `git status`: this task changed only
  `docs/P4_Upgrade/P4_06B_HISTORICAL_VALIDATION_EXECUTION_SPEC.md` (new) and
  `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md` (checkpoint only).
- No production code changed; no P4-03/P4-04 semantics touched; no
  P3/P2/DB/API/UI changes.

*End of P4-06B execution specification. Execution agent (P4-06B-IMPL) may
proceed only after this protocol is accepted.*
