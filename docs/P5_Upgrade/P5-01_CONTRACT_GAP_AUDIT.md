# P5-01 CONTRACT & GAP AUDIT

**Phase:** P5 — What action, if any, should be executed?
**Task:** P5-01 — Contract & Gap Audit
**Status:** AUDIT COMPLETE — READY FOR P5-02 (pending owner review)
**Authoritative reference:** `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md`
**Audit date:** P5-01 (repository state at audit time)

This is an **audit record only**. It does not resolve conflicts, does not
design P5 implementation, and does not freeze or promote any CANDIDATE or
PROVISIONAL semantic. Findings are classified per §6 of the task brief and
cited to actual repository files/symbols/tests.

---

## 1. Executive Summary

- The **P4 → P5 input contract EXISTS and is complete**: a frozen,
  read-time-derived `P4DecisionSupportViewModel` (`src/lib/p4/types.ts`)
  exposed additively and failure-safe via `data.p4DecisionSupport`
  (`src/app/api/narratives/[id]/route.ts`). P5 can consume it without
  changing P4.
- The repository contains a **P3-era recommendation + alert + rule
  infrastructure** (recommendations, recommendation rules with numeric
  thresholds, rule versioning, alert rules/history with acknowledgement,
  a numeric decision-signal engine, P3 write-side idempotency gates).
  These are **REUSABLE AS PRECEDENT / PARTIAL**, but their numeric-score
  semantics must NOT be imported into P5 (P5 Master §14: policy references
  P4 qualitative states as-is, never re-derived numbers).
- **No P5 action layer exists** (no action taxonomy, state machine,
  eligibility, policy, guardrail, approval, execution, or P5 audit).
  These are MISSING by design and belong to P5-02 → P5-08.
- **No `P4 Direction → BUY/SELL` or equivalent shortcut was found** in the
  audited paths. P4 even ships a banned-phrase denylist that forbids
  "buy now"/"sell now" in explanations (`src/lib/p4/explanation/templates.ts`).
- **No approval/authorization/automation mechanism exists.** The only
  look-alike is post-hoc alert **acknowledgement** (`alert_history.
  acknowledged_at/acknowledged_by`) and the word "approved" used for P2
  evidence status inside P4 — vocabulary collisions to resolve in P5-02,
  not code conflicts.
- **No P5 dependency on P4-06 was found.** P4-06 remains OPEN / DATA
  ACCRUAL; the 9 provisional rules remain INSUFFICIENT_EVIDENCE.
- **No CRITICAL/HIGH conflicts** with the frozen P5 Master or P4 contract
  were discovered. Two LOW vocabulary-collision cautions are recorded in
  the Conflict Register; one LOW documentation observation is recorded in
  the Contradiction Register.

---

## 2. Audit Scope

Audited (read-only, no modifications):

- `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md` (frozen authority)
- Frozen P4 contract: `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md`,
  P4-02/03/04 specs, P4-05/06/07 checkpoints/reports
- P4 implementation: `src/lib/p4/**` (types, service, assembler,
  availability, interpretation, explanation, mapper, validation harness)
- API: `src/app/api/narratives/[id]/route.ts`,
  `src/app/api/coins/[id]/decision/route.ts`, admin alerts / rules /
  rule-versions routes, refresh routes
- UI: `src/app/narrative/[id]/page.tsx`, `src/app/coin/[id]/page.tsx`,
  `src/components/P4DecisionSupportPanel.tsx`, admin page
- Services: `src/lib/services/*` (decision-engine, rule-engine,
  rule-version, alert, event-risk, momentum, snapshot, correlation)
- P3 kernel: `src/lib/p3/**` (execution-loop, persistence, rotation) —
  boundary only
- Schema: `src/db/schema.ts` (table inventory + relevant columns)
- Legacy docs: `docs/MDD_Plan.md`, `Upgrade.md` (informational only)

NOT in scope: P3/P2 semantic modification, P4 modification, P4-06,
any implementation.

---

## 3. Repository Baseline

| Item | Evidence |
|---|---|
| Stack | Next.js app + FastAPI service, PostgreSQL via Drizzle (`src/db/schema.ts`), React UI |
| P4 phase | CLOSED (Master §19K) |
| P4-06 | OPEN / DATA ACCRUAL (parallel track) |
| P5 | NOT STARTED (Master §3) |
| P4 input contract | `P4DecisionSupportViewModel` — `src/lib/p4/types.ts:280` |
| P4 service | `getP4DecisionSupport(narrativeId)` — `src/lib/p4/service.ts:133` |
| P4 API | `data.p4DecisionSupport` additive — `src/app/api/narratives/[id]/route.ts:150,152,180` |
| P4 UI | `P4DecisionSupportPanel` — `src/components/P4DecisionSupportPanel.tsx`; mounted `src/app/narrative/[id]/page.tsx:150` |
| Legacy action-adjacent infra | `recommendations`/`recommendation_rules`/`rule_versions`/`alert_rules`/`alert_history`/`decision_signals` tables; `rule-engine.service.ts`, `alert.service.ts`, `decision-engine.service.ts` |

---

## 4. P5 Master Contract Reference

P5-01 audits against the frozen Master requirements:

- **Boundary:** P5 = "what action, if any, is eligible under policy and
  safety constraints"; P5 MUST NOT reinterpret P3/P4 (Master §5).
- **No BUY/SELL shortcut** (Master §1, §5, §8, §31).
- **NO_ACTION first-class** (Master §1, §4).
- **Action type ≠ action state ≠ approval ≠ execution** (Master §12, §16).
- **UNKNOWN/DEGRADED/null never silently becomes a consequential action;
  fail closed** (Master §8.3, §15, §21, §31).
- **No hidden score, no invented threshold** (Master §8.5, §14, §31).
- **Separation of concerns frozen; detailed thresholds CANDIDATE**
  (Master §9, §31).
- **P4-06 independent; provisional rules untouched** (Master §34).

---

## 5. P4 → P5 Input Contract Audit

Status: **EXISTS** (complete; P5 can consume without changing P4).

| P4 Master requirement | Repository evidence | Status |
|---|---|---|
| ViewModel | `P4DecisionSupportViewModel` — `src/lib/p4/types.ts:280` (status, version, narrativeIdentity, generatedAt, asOf, direction, signals, opportunity, risk, confidence, actionability, explanation, evidence, historicalContext, provenance, degradation) | EXISTS |
| Direction (5-state) | `P4DirectionState` — `types.ts:30` (POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN) | EXISTS |
| Signals (8 catalog) | `P4SignalId` — `types.ts:39`; firing in `src/lib/p4/interpretation.ts` | EXISTS |
| Opportunity / Risk / Confidence / Actionability | `P4QualitativeValue = LOW/MEDIUM/HIGH/UNKNOWN` — `types.ts:37` (qualitative only; no numeric scores) | EXISTS |
| Evidence | `P4EvidenceReference` — `types.ts:75` (identity, provenance, role, sourceLayer, sourceType, field, status) | EXISTS |
| Explanation | `P4ExplanationResult` — `types.ts:232`; deterministic templates (`src/lib/p4/explanation/`) | EXISTS |
| Provenance | `provenance.derivedFrom`, `p2EventRisk`, `sourceLayer` — `types.ts:317`+ | EXISTS |
| Degradation | `P4DegradationCode` + `P4DegradationReason[]` — `types.ts:143,153` | EXISTS |
| Version tuple | `P4_ALGORITHM_VERSION`/`P4_SEMANTIC_VERSION`/`P4_INTERPRETATION_RULE_VERSION` — `types.ts:21-24`; consumed, never modified by P5 | EXISTS |
| Identity | `narrativeIdentity {narrativeId, window, algorithmKey, algorithmVersion, calculationMode}` — `types.ts:293`; validated in `src/lib/p4/assembler.ts` (rejects mixed/mismatched identity) | EXISTS |
| Timestamps | `generatedAt` (metadata only), `asOf` (latest artifact window end) | EXISTS |
| UNKNOWN semantics | UNKNOWN propagation (Direction/O/R/C/A), identity ambiguity → DEGRADED IDENTITY_AMBIGUOUS (`src/lib/p4/availability.ts`, interpretation tests) | EXISTS |
| DEGRADED semantics | status DEGRADED + degradation reasons; STALE caps (interpretation); no silent conversion to any action | EXISTS |
| null/error behavior | `getP4DecisionSupport` returns `null` on no-evidence/identity-rejection/failure; route degrades `p4DecisionSupport` to null (route.ts:150-152) | EXISTS |

**Conclusion:** the input contract is fully consumable. The contract
contains no action semantics (as designed) — the action layer is P5's
responsibility, not a gap in P4.

---

## 6. Action Infrastructure Audit

Status: **PARTIAL** (legacy recommendation/alert infra exists; no action
taxonomy).

| Finding | Evidence | Classification |
|---|---|---|
| P3-era recommendation signals | `recommendations.signal` = STRONG_WATCH / WATCH / OBSERVE / WEAK — `src/db/schema.ts:202` | EXISTS (legacy) |
| Numeric score → signal tier | `getRecommendationSignal(healthScore, {strong_watch:90, watch:80, observe:65})` — `src/lib/features/engine.ts:158` | EXISTS (legacy, numeric) |
| Recommendation rule engine | `RuleEngineService.evaluate(scores, versionId)` — priority-ordered, AND/OR conditions, first-match — `src/lib/services/rule-engine.service.ts:10-60` | EXISTS (legacy) |
| Alert rules + history | `alertRules` (scope/triggerType/triggerValue/isActive) + `alertHistory` (triggeredAt/triggerDetail/acknowledgedAt/acknowledgedBy) — `src/db/schema.ts:687-724`; `AlertService` — `src/lib/services/alert.service.ts` | EXISTS |
| Alert acknowledgement workflow | `acknowledgeAlert(historyId, acknowledgedBy)` — `alert.service.ts:60`; admin route `src/app/api/admin/alerts/[id]/acknowledge/route.ts` | EXISTS (post-hoc ack, NOT pre-execution approval) |
| Numeric decision signal engine | `DecisionEngineService.calculateAdjustedScore` — health score + event-risk/correlation penalties — `src/lib/services/decision-engine.service.ts:13-40`; persists to `decisionSignals` (upsert) | EXISTS (legacy, numeric, write-side) |
| Action taxonomy (P5) | none | MISSING (P5-02) |
| Exposure-change semantics | none | MISSING |
| Escalation mechanism | none | MISSING |
| Trade suggestions / BUY-SELL semantics in P4 path | none (see §14) | MISSING (good) |
| Technical-analysis trading tooling | `src/lib/technical-analysis/risk.ts` (entry/sl/tp, rrRatio, position sizing); "Risk Management" panel on coin page `src/app/coin/[id]/page.tsx:1243-1300` | CANDIDATE / LEGACY — P5 v1 execution OUT_OF_SCOPE; review in P5-02 whether any vocabulary is reused |

---

## 7. State / Lifecycle Audit

Status: **PARTIAL** (several status vocabularies exist; none implement the
P5 state machine).

| Concept | Evidence | Status |
|---|---|---|
| P3 artifact availability | VALID / MISSING / INVALID / STALE / INSUFFICIENT_HISTORY / NOT_APPLICABLE / AMBIGUOUS (`src/lib/p3/**`, `P4AvailabilityState`) | EXISTS (input semantics) |
| Alert rule active flag | `alertRules.isActive`; deactivate API | EXISTS |
| Alert acknowledgement state | `alert_history.acknowledged_at` (nullable = unacknowledged) | EXISTS — different semantics than P5 "approved" |
| P2 event expiry | `eventRisks.isActive` + `expiresAt` — `src/db/schema.ts:442`; query filter `expiresAt >= today` — `event-risk.service.ts:77` | EXISTS |
| Scheduler/source status | `schedulerLogs`, `sourceStatus` tables | EXISTS (operational, not action state) |
| P5 lifecycle (CANDIDATE → ELIGIBLE → BLOCKED → REQUIRES_APPROVAL → APPROVED → EXECUTABLE → EXECUTED / FAILED / CANCELLED) | none | MISSING (P5-02/P5-03) |
| Action type ≠ action state separation | no action layer exists; no state implies execution | N/A — preserved by absence; must be enforced at P5-02 |

**Caution:** existing "acknowledged" and "approved" words carry different
meaning than P5 approval semantics. See Conflict Register C-001/C-002.

---

## 8. Policy / Rule Audit

Status: **PARTIAL — EXISTS as legacy numeric rule infra; MUST NOT be
imported into P5 semantics.**

| Finding | Evidence | Classification |
|---|---|---|
| Deterministic rule engine | `RuleEngineService` (priority, AND/OR conditions, first-match) — `rule-engine.service.ts` | EXISTS (legacy) |
| Rule versioning | `ruleVersions` table (weights, thresholds, isActive, activatedAt) — `src/db/schema.ts:265`; `RuleVersionService`; activate API `src/app/api/admin/rule-versions/[id]/activate/route.ts` | EXISTS |
| Numeric thresholds (legacy) | recommendation thresholds 90/80/65 (`features/engine.ts:158`); decision-signal penalties ≥80→−25, ≥60→−15, ≥40→−8, correlation ≥80→−10 (`decision-engine.service.ts:14-31`); health/confidence weights (`rule-version.ts`) | EXISTS — LEGACY numeric; P5 must not reuse as P5 thresholds |
| Cooldown | none | MISSING (P5-03) |
| Duplicate suppression | `recommendations` unique(coinId, date); `decisionSignals` upsert (onConflictDoUpdate) | EXISTS (write-side dedup; P5 needs decision-side idempotency per Master §22) |
| P5 policy engine | none | MISSING (P5-03) |
| Hidden scores in P5 | none (no P5 code) | N/A — see §15 |

---

## 9. Safety / Guardrail Audit

Status: **PARTIAL** (P4 provides guarded input; P5 guardrail layer MISSING).

| Finding | Evidence | Classification |
|---|---|---|
| P4 degradation codes + reasons | `P4DegradationCode` / `P4DegradationReason[]` — `types.ts:143,153`; STALE caps; identity ambiguity handling | EXISTS (input guardrails) |
| Identity validation | P4 assembler rejects mixed/mismatched identity; P4-02 §7 | EXISTS |
| Missing/invalid evidence checks | availability mapping (MISSING/INVALID/STALE...) | EXISTS |
| Conflict handling | EVIDENCE_CONFLICT signal; material vs minor (C1/C2) | EXISTS (interpretation-level) |
| P2 event risk (expiry, level) | `event-risk.service.ts` (riskLevel, expiresAt) | EXISTS |
| Legacy risk adjustments | decision-engine penalties; technical-analysis risk levels (sl/tp/rr) | LEGACY — numeric; not P5 guardrails |
| P5 fail-closed guardrail layer | none | MISSING (P5-04) |
| Action-specific risk / exposure checks | none | MISSING (P5-04) |
| Execution-environment checks | n/a (no execution in v1) | OUT_OF_SCOPE (P5 v1) |

No existing code silently converts UNKNOWN/DEGRADED/null into a
consequential action (no action layer exists at all).

---

## 10. Approval / Automation Audit

Status: **MISSING** (no approval, authorization, roles, or automation).

| Finding | Evidence | Classification |
|---|---|---|
| Approval workflow | none (searched: approval/approve/authoriz/human-in-the-loop/execution permission — no state/type/service) | MISSING (P5-04) |
| Authorization / roles / permissions | none | MISSING |
| Human-in-the-loop | none | MISSING (P5-04) |
| Automation modes (ADVISORY/ASSISTED/AUTONOMOUS) | none | MISSING (P5-04/P5-02) |
| Alert acknowledgement | `alert_history.acknowledged_by` — post-hoc ack after trigger, not pre-execution approval | PARTIAL — vocabulary collision only (C-001) |
| "approved" P2 evidence | P4 mapper refs "approved P2 event risk" (source = P2_EVENT_RISK) — `src/lib/p4/mapper.ts:612` — P2 evidence status, NOT a human approval workflow | PARTIAL — vocabulary collision only (C-002) |
| Execution permission / external side effects | none | MISSING / OUT_OF_SCOPE (v1) |

Master principle (§16) — "any consequential action must be subject to an
explicit approval and authority policy before execution" — is therefore
**unimplemented and uncontradicted** in the current repository.

---

## 11. Audit / Provenance / Idempotency / Retry Audit

Status: **PARTIAL** (provenance + write-side idempotency exist; no P5
action audit; no retry layer).

| Finding | Evidence | Classification |
|---|---|---|
| P4 evidence provenance | `P4EvidenceReference.provenance` (sourceLayer P2/P3, sourceType, field, status, role) — `types.ts:75` | EXISTS |
| P4 derived provenance | `provenance.derivedFrom`, `p2EventRisk`, `semanticVersion` — `types.ts:317` | EXISTS |
| P3 artifact provenance | jsonb provenance on P3 artifacts (`p3_narrative_intelligence`) | EXISTS |
| Event log with idempotency | `narrative_membership_events`: `idempotencyKey` unique, `provenance` jsonb, `actor`, `source`, `sourceRef`, `recordedAt` — `src/db/schema.ts:493-514` | EXISTS (P3-era; closest audit-log precedent) |
| P3 write idempotency | `execution-loop.ts:218` "Idempotency gate: never re-execute a persisted identity"; append-only persistence (`src/lib/p3/persistence.ts`) | EXISTS |
| Scheduler log | `schedulerLogs` table | EXISTS |
| P5 action audit trail | none | MISSING (P5-05) |
| Retry infrastructure | none found | MISSING (Master §23 models semantics only) |
| Decision/request/execution IDs | none | MISSING (Master §22 contract requirement) |

---

## 12. API / Read / UI Audit

Status: **PARTIAL** — integration points exist; P5 read/API/UI MISSING.

| Finding | Evidence | Classification |
|---|---|---|
| P4 narrative API | `GET /api/narratives/[id]` → `data.p4DecisionSupport` (additive, try/catch → null) — `route.ts:150-180` | EXISTS (P5-06 integration point) |
| Read services | `src/lib/services/*` (p3-intelligence, momentum, correlation, health-timeline, snapshot, event-risk) | EXISTS |
| Admin alerts API | rules CRUD + history + acknowledge routes | EXISTS |
| Admin rules API | recommendation-rules + rule-versions + activate | EXISTS |
| Decision API | `GET /api/coins/[id]/decision` (adjusted score + reason) | EXISTS (legacy, numeric) |
| UI panels | `P4DecisionSupportPanel` (narrative page), "Risk Management" panel (coin page), admin page, dashboard route | EXISTS (P5-06 integration points) |
| P5 action read model / API / UI | none | MISSING (P5-06) |

---

## 13. UNKNOWN / DEGRADED Audit

Status: **COMPATIBLE** — no silent mapping to consequential action found.

- P4 propagates UNKNOWN (Direction/O/R/C/A) and degrades with explicit
  codes + reasons; `getP4DecisionSupport` returns null on no-evidence/
  identity-rejection/failure (`src/lib/p4/service.ts:133`).
- Route degrades `p4DecisionSupport` → null on any P4 failure — the
  narrative endpoint stays functional (P4-07 drills A–L, all PASS).
- Legacy paths: `decision/route.ts` 404s when the health score is missing
  (no action conversion); alert/rule engines never reference P4.
- **No code path converts UNKNOWN/DEGRADED/null/stale/invalid/
  insufficient-history/low-confidence into BUY/SELL/EXECUTE/REDUCE/
  INCREASE.** Verified by search (§Appendix C) and by P4-07 production
  validation (degraded samples yield UNKNOWN/blocked, never action
  language).
- P5 fail-closed layer for consequential actions: MISSING (P5-04) — the
  Master invariant (§21) is currently satisfied by the absence of any
  action layer.

---

## 14. BUY/SELL Shortcut Audit

Status: **NO CONFLICT FOUND** in the P4 → P5 path.

| Finding | Evidence | Classification |
|---|---|---|
| P4 Direction → BUY/SELL | not present | COMPATIBLE (absent) |
| P4 explanation banned phrases | `BANNED_PHRASES` incl. "buy now", "sell now", "likely to pump" — `src/lib/p4/explanation/templates.ts:243-253` | COMPATIBLE (P4 explicitly forbids) |
| Numeric score → watchlist tier with bullish language | `generateRecommendationReason` — "Strong bullish signals across all metrics" — `src/lib/features/engine.ts:186-197`; maps health-score tiers, NOT P4 Direction; produces STRONG_WATCH/WATCH/OBSERVE/WEAK, not buy/sell | LEGACY / PARTIAL — directional language in a legacy tier mapper; P5-02 must not inherit it as action semantics |
| Exchange market-data fields | Buy%/Sell% from Binance (descriptive), long-short-ratio API, funding references in `docs/MDD_Plan.md` | OUT_OF_SCOPE (market data, not decisions) |
| Trading risk tooling | `technical-analysis/risk.ts` entry/sl/tp/position sizing + coin-page panel | OUT_OF_SCOPE for P5 v1 execution; CANDIDATE for P5-02 vocabulary review |

**Conclusion:** no indirect variant (positive→buy, negative→sell,
bullish→long, high opportunity→buy, high risk→sell) exists in the P4
decision path.

---

## 15. Hidden Score / Threshold Audit

Status: **COMPATIBLE** — legacy numeric scores are P3-era semantics, not
P5 hidden scores; none may be reused as P5 thresholds without an explicit
frozen decision.

| Finding | Evidence | Classification |
|---|---|---|
| P4 qualitative O/R/C/A | LOW/MEDIUM/HIGH/UNKNOWN — no numeric scores | COMPATIBLE |
| P3-era health score + weights | `src/lib/scoring/narrative-health.ts`, `features/engine.ts`, `ruleVersions.healthWeights` | LEGACY — legitimate P3 semantics |
| Decision-signal adjusted score | `decision-engine.service.ts` penalties (80/60/40 → 25/15/8) | LEGACY numeric |
| Technical-analysis risk math | `MIN_RR_RATIO = 1.0`, 1% risk rule, MAX_SL_PCT — `technical-analysis/risk.ts:9,52` | LEGACY numeric |
| Legacy design-doc scoring ideas | `docs/MDD_Plan.md` (whale net buy ±15, funding, overleveraged long −10, ...) | LEGACY — design doc only; NOT authoritative |
| P5 hidden action/risk/priority/execution score | none (no P5 code) | MISSING (by design) |

No existing value is mislabeled; no new score is introduced by this audit.

---

## 16. P4-06 Dependency Audit

Status: **NO BLOCKING DEPENDENCY.**

- No P5 code exists to import provisional P4 rules.
- P5 Master §34 explicitly keeps P4-06 OPEN / DATA ACCRUAL and prohibits
  promotion/modification; P5 consumes the frozen P4 contract.
- The 9 provisional rules (corroborator set/reconciliation, conflict
  materiality, P2 scope tiers, Opportunity suppression ladder, Risk base
  thresholds, Confidence combination, Actionability table, Opportunity ×
  Risk matrix, NARRATIVE_* corroboration minimums) remain
  INSUFFICIENT_EVIDENCE — none referenced as validated by any P5 artifact
  (none exists).
- Verdict: **"No blocking P5 dependency on P4-06 identified."**

---

## 17. Reuse Matrix

| Capability | Existing Component | Status | Semantic Compatibility | Reuse Potential | Notes |
|---|---|---|---|---|---|
| P4 input | `P4DecisionSupportViewModel` + `getP4DecisionSupport` + route field | EXISTS | FULL (frozen contract) | HIGH | Consume as-is; never re-derive |
| Action infra | `recommendations`/`recommendationRules` + `rule-engine.service.ts` | PARTIAL | Numeric legacy; not P5 action semantics | MEDIUM (as precedent for deterministic rule pattern; NONE for thresholds) | P5-03 may mirror the deterministic rule shape, not the score semantics |
| Alert infra | `alertRules`/`alertHistory` + `AlertService` | PARTIAL | Ack ≠ approval; trigger/rule shape reusable | MEDIUM | P5-04 approval is a new, distinct concept |
| Rule engine | `RuleEngineService` (priority, AND/OR, versioned) | EXISTS | Deterministic pattern compatible | MEDIUM | Re-architect under P5-03 policy contract; do not reuse numeric conditions |
| Rule versioning | `ruleVersions` + activate API | EXISTS | Compatible pattern | MEDIUM | P5-03 policyVersion / P5-04 guardrailVersion precedent |
| Risk checks | P4 degradation + identity validation | EXISTS | Full | HIGH | P5-04 consumes degradation codes directly |
| Approval | none | MISSING | — | NONE | P5-04 |
| Audit/provenance | P4 evidence provenance + `narrative_membership_events` (idempotencyKey, provenance, actor) | PARTIAL | Write-side pattern reusable | MEDIUM | P5-05 audit model precedent |
| Idempotency | P3 execution-loop gate, unique keys, upserts | EXISTS | Write-side only | MEDIUM | P5-22 (Master §22) needs decision-side keys |
| Retry | none | MISSING | — | NONE | P5-03/05 semantics only |
| API/UI | narrative route + panels | EXISTS | Full for P4 | HIGH | P5-06 mounts additively like `data.p4DecisionSupport` |
| Legacy docs | `MDD_Plan.md` scoring ideas | LEGACY | Not authoritative | LOW | Do not reuse blindly (Master hierarchy §2) |

---

## 18. Contract Gap Matrix

| P5 Master Requirement | Repository Evidence | Status | Gap | Conflict | Future Owner |
|---|---|---|---|---|---|
| Consume frozen P4 contract | `types.ts` ViewModel + route field | EXISTS | none | none | — |
| Action taxonomy | none | MISSING | taxonomy + intent/evidence/approval semantics | none | P5-02 |
| Action state machine | partial status vocabularies only | MISSING | P5 lifecycle + type≠state | C-001/C-002 (vocabulary) | P5-02 |
| Eligibility | rule-engine pattern only | MISSING | P5 eligibility rules over ViewModel | none | P5-03 |
| Policy engine | legacy numeric rules | MISSING | deterministic policy over qualitative states | none (legacy not reused) | P5-03 |
| Safety/guardrails | P4 degradation + identity checks | PARTIAL | fail-closed layer for consequential actions | none | P5-04 |
| Approval | none | MISSING | approval + authority policy | none | P5-04 |
| Automation modes | none | MISSING | ADVISORY-only v1 default | none | P5-04/P5-02 |
| Execution boundary | technical-analysis tooling (legacy) | PARTIAL | explicit boundary contract | none (out of scope v1) | P5-02/P5-03 |
| Evidence/provenance | P4 refs + event log | PARTIAL | action-decision provenance + snapshot identity | none | P5-05 |
| Explanation | P4-04 exists | PARTIAL | P5 policy explanation (why action/non-action) | none | P5-05 |
| UNKNOWN/DEGRADED safety | P4 semantics compatible | PARTIAL | P5 policy evaluation of degraded conditions | none | P5-04 |
| Idempotency | write-side precedent | PARTIAL | decision/request/execution IDs + keys | none | P5-03/P5-05 |
| Failure/retry | none | MISSING | decision vs execution failure semantics | none | P5-03/P5-05 |
| Audit trail | partial event log | MISSING | full action lifecycle audit | none | P5-05 |
| API/UI | narrative route + panels | PARTIAL | P5 read model + additive API/UI | none | P5-06 |
| Historical validation | P4-06 harness exists | PARTIAL | P5 replay over P4 snapshots | none | P5-07 |
| Production validation | P4-07 precedent | PARTIAL | P5 runtime validation | none | P5-08 |

---

## 19. Conflict Register

No CRITICAL or HIGH conflicts were found. Recorded conflicts are
vocabulary/classification cautions — P5-01 does NOT resolve them.

| ID | Existing Behavior | Evidence | Conflicts With | Severity | Required Decision |
|---|---|---|---|---|---|
| C-001 | `alert_history.acknowledged_at/acknowledged_by` — post-hoc alert acknowledgement | `src/db/schema.ts:712-713`; `alert.service.ts:60` | P5 Master §16 vocabulary: "acknowledged" must not be conflated with pre-execution "approval" | LOW | P5-02: define approval vocabulary explicitly distinct from alert acknowledgement |
| C-002 | Word "approved" used for P2 event-risk evidence status inside P4 mapper | `src/lib/p4/mapper.ts:612` (refs to approved P2 event risk; source=P2_EVENT_RISK) | P5 Master §16: "approved" is reserved for human approval state | LOW | P5-02/P5-04: name P5 approval states distinctly (e.g. APPROVED by actor X, bound to candidate version) |
| C-003 | Legacy bullish language in recommendation reason text | `src/lib/features/engine.ts:186-197` ("Strong bullish signals...") | P5 Master §5/§8 spirit: P5 must not inherit directional tier language as action semantics | LOW | P5-02: explicitly exclude legacy recommendation semantics from P5 taxonomy inheritance |

No example of "existing state implies execution", "UNKNOWN → action",
or "Direction → BUY/SELL" was found.

---

## 20. Contradiction Register

| ID | Source A | Source B | Contradiction | Authority | Resolution Owner |
|---|---|---|---|---|---|
| CTR-001 | P5 Master header/§3: "MASTER READY FOR FREEZE (pending explicit owner approval)" | P5-01 task statement: "P5-00 Master Specification has been formally APPROVED and FROZEN" | Documentation status-line vs task grant: the Master's own status line still says freeze is pending | P5 Master (as amended by the owner's approval grant in the P5-01 task) | P5-01 report records it; P5-02 owner review may update the Master status line to FROZEN |
| CTR-002 | P5 Master §34 (P4-06 OPEN) | P4-06 closure decision docs (Option A — keep open) | none — consistent | — | none (consistency confirmed) |

No contradiction between the P5 Master and the frozen P4 contract was
found (P5-01 verified ViewModel, versions, degradation, provenance,
C1–C5 in implementation and docs).

---

## 21. Deferred Semantic Decisions

Recorded for later tasks; NOT decided here.

**P5-02 (Action Semantic Contract):**
- exact `ActionCandidate` / `ActionDecision` contract shape;
- exact `ActionState` semantics + action type ≠ action state;
- taxonomy finalization (NO_ACTION/MONITOR/REVIEW/INVESTIGATE/... —
  currently CANDIDATE/ILLUSTRATIVE per Master §11);
- action identity + snapshot identity;
- lifecycle (CANDIDATE → … → EXECUTED/FAILED/CANCELLED);
- vocabulary resolution for C-001/C-002 (acknowledgement, "approved").

**P5-03 (Action Decision / Policy Engine):**
- eligibility rule shape;
- policy evaluation over qualitative P4 states (no numeric reuse);
- policy priority, cooldown, duplicate suppression;
- deterministic evaluation + decision-side idempotency keys (Master §22);
- decision failure vs execution failure semantics.

**P5-04 (Safety / Guardrail / Approval):**
- fail-closed behavior for consequential actions on UNKNOWN/DEGRADED/null;
- guardrail consumption of P4 degradation codes;
- approval semantics + authority policy + approval record;
- automation authority (ADVISORY-only v1 default);
- execution permission model (v1 boundary only).

**P5-05 … P5-09:** explanation/audit (P5-05), read/API/UI (P5-06),
historical validation (P5-07), production validation (P5-08), closure
(P5-09) — deferred as in Master §32.

---

## 22. P4-06 Parallel Track / P5 Handoff

- **P4-06 remains OPEN / DATA ACCRUAL** (parallel maintenance/validation
  track; revalidation trigger defined in the P4-06 closure decision).
- The **9 provisional P4 rules remain INSUFFICIENT_EVIDENCE**.
- P5-01 does **not** promote, modify, close, or reinterpret those rules.
- **"No blocking P5 dependency on P4-06 identified."** P5 proceeds against
  the frozen P4 contract as it currently exists.

---

## 23. P5-02 → P5-09 Readiness Assessment

| Task | Readiness | Basis |
|---|---|---|
| P5-02 Action Semantic Contract | READY | P4 input contract fully audited (EXISTS); taxonomy/state candidates documented in Master §11-12; no blocking conflict |
| P5-03 Action Decision / Policy Engine | READY (after P5-02) | deterministic rule pattern precedent exists (legacy); qualitative-only policy requirement clear |
| P5-04 Safety / Guardrail / Approval | READY (after P5-03) | P4 degradation codes consumable; no approval precedent to preserve |
| P5-05 Explanation & Audit | READY (after P5-03/04) | P4-04 + event-log precedent |
| P5-06 Read/API/UI | READY (after P5-03-05) | additive-route precedent (`data.p4DecisionSupport`) |
| P5-07 Historical Validation | READY (after P5-03) | P4-06 replay harness reusable as precedent; P5 must not fabricate P4 samples |
| P5-08 Production Validation | READY (after P5-06) | P4-07 drill structure precedent |
| P5-09 Closure | READY (after P5-01-08) | Master §33 criteria |

---

## 24. Acceptance / Exit Criteria

P5-01 exit criteria — all met:

- [x] P5 Master treated as frozen authority
- [x] P4 → P5 boundary audited (§5, §14)
- [x] P4 input contract audited (§5)
- [x] Action/recommendation/alert infrastructure audited (§6)
- [x] Lifecycle/state mechanisms audited (§7)
- [x] Policy/rule mechanisms audited (§8)
- [x] Safety/guardrail mechanisms audited (§9)
- [x] Approval/automation mechanisms audited (§10)
- [x] Audit/provenance/idempotency/retry audited (§11)
- [x] API/read/UI integration points audited (§12)
- [x] BUY/SELL shortcut search completed (§14)
- [x] UNKNOWN/DEGRADED/null handling audited (§13)
- [x] Hidden score/threshold search completed (§15)
- [x] P4-06 dependency audited (§16)
- [x] Reuse matrix completed (§17)
- [x] Contract gap matrix completed (§18)
- [x] Conflict register completed (§19)
- [x] Contradiction register completed (§20)
- [x] Deferred semantic decisions identified (§21)
- [x] P4-06 handoff documented (§22)
- [x] No P5 semantic silently frozen
- [x] No production code changed
- [x] Exactly one master audit document created

---

## Appendix A — Repository Evidence Index

| # | Evidence | File |
|---|---|---|
| E1 | `P4DecisionSupportViewModel` | `src/lib/p4/types.ts:280` |
| E2 | `getP4DecisionSupport` (returns ViewModel \| null) | `src/lib/p4/service.ts:133` |
| E3 | Additive route field + try/catch degradation | `src/app/api/narratives/[id]/route.ts:150-152,180` |
| E4 | P4 banned phrases (buy now/sell now) | `src/lib/p4/explanation/templates.ts:243-253` |
| E5 | Recommendations table (signals + unique(coin,date)) | `src/db/schema.ts:202` |
| E6 | Rule versions (weights + thresholds + activation) | `src/db/schema.ts:265`; `src/lib/services/rule-version.service.ts` |
| E7 | Recommendation rules + engine | `src/db/schema.ts:331`; `src/lib/services/rule-engine.service.ts:10-60` |
| E8 | Alert rules + history + ack | `src/db/schema.ts:687-724`; `src/lib/services/alert.service.ts` |
| E9 | Decision-signal engine (numeric penalties) | `src/lib/services/decision-engine.service.ts:13-40` |
| E10 | Score→signal tier mapper + bullish language | `src/lib/features/engine.ts:158,186-197` |
| E11 | Event risk (P2) expiry + level | `src/db/schema.ts:442`; `src/lib/services/event-risk.service.ts:77` |
| E12 | Event log with idempotencyKey + provenance + actor | `src/db/schema.ts:493-514` |
| E13 | P3 idempotency gate | `src/lib/p3/execution-loop.ts:218`; `src/lib/p3/persistence.ts:172` |
| E14 | Technical-analysis risk tooling | `src/lib/technical-analysis/risk.ts:9,52`; coin page `1243-1300` |
| E15 | P4 UI placement | `src/app/narrative/[id]/page.tsx:143-153` |
| E16 | P4 version tuple constants | `src/lib/p4/types.ts:21-24` |
| E17 | Legacy design-doc scoring ideas | `docs/MDD_Plan.md` (whale net buy ±15 etc.) |

## Appendix B — Files / Symbols Audited

- `src/lib/p4/types.ts`, `service.ts`, `assembler.ts`, `availability.ts`,
  `interpretation.ts`, `mapper.ts`, `errors.ts`, `explanation/*`,
  `validation/*`
- `src/lib/services/{decision-engine,rule-engine,rule-version,alert,
  event-risk,momentum,snapshot,correlation,health-timeline,p3-intelligence,
  p3-intelligence-history}.service.ts`
- `src/lib/features/engine.ts`, `src/lib/scoring/narrative-health.ts`,
  `src/lib/technical-analysis/{engine,risk,scoring,types}.ts`
- `src/lib/p3/{execution-loop,persistence,rotation}.ts`
- `src/db/schema.ts`
- API: narrative/[id], coins/[id]/decision, admin/alerts/*,
  admin/recommendation-rules/*, admin/rule-versions/*, admin/analytics/*,
  refresh/*
- UI: `src/app/narrative/[id]/page.tsx`, `src/app/coin/[id]/page.tsx`,
  `src/components/P4DecisionSupportPanel.tsx`, `src/app/admin/page.tsx`
- Docs: `docs/P4_Upgrade/**`, `docs/P5_Upgrade/P5_MASTER_SPECIFICATION.md`,
  `docs/MDD_Plan.md`, `Upgrade.md`

## Appendix C — Search Terms / Audit Coverage

- `buy|sell|hold|long|short` (case-insensitive) across `src` — hits limited
  to market-data fields, technical-analysis math, P4 banned-phrase list;
  no P4→action mapping.
- `approval|approve|authoriz|human.in.the.loop|idempoten|audit.trail|
  execution.permission` across `src` — hits limited to alert
  acknowledgement, P2 evidence status, P3 idempotency gates.
- `STRONG_WATCH|recommendationRule(s)|ruleVersion|alertService|decisionSignals`
  to locate legacy action-adjacent infra.
- `threshold|riskLevel|expiresAt|isActive` to locate legacy numeric/
  lifecycle semantics.
- P4-07 production-validation report and P4-06 execution report re-verified
  for UNKNOWN/degraded handling and identity guarantees.

## Appendix D — Known Limitations

- Audit is a static + targeted-search review of the audited paths; some
  legacy behavior may exist outside the searched surface
  (marked NOT VERIFIED where relevant; none found material).
- `docs/MDD_Plan.md` contains numeric scoring ideas (whale net buy,
  funding, etc.) — classified LEGACY; its relationship to any live
  implementation was NOT verified (no code reference found in the P4/P5
  paths).
- The P5 Master's own status line reads "READY FOR FREEZE" while the
  P5-01 task statement declares the Master approved/frozen — recorded as
  CTR-001; the audit treated the Master as authoritative per the task
  grant.
- No P2 event-risk rows exist in the live dataset (0 rows) — P2-related
  audit conclusions are structural only.
- Performance/operational characteristics are out of scope for P5-01
  (deferred to P5-08).

---

*End of P5-01 Contract & Gap Audit. Audit only — no implementation, no
semantic freeze, no conflict resolution. P5-02 may begin only after owner
review and approval of this document.*
