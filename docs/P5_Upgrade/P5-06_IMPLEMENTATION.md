# P5-06 IMPLEMENTATION — Action Read Service / API / UI

Document: `docs/P5_Upgrade/P5-06_IMPLEMENTATION.md`
Phase: P5 — "What action, if any, should be executed?"
Task: P5-06 (P5-06A Action Read Service · P5-06B API · P5-06C UI)
Status: **IMPLEMENTED — READ-ONLY / ADVISORY-ONLY V1**

Authoritative chain (all FROZEN / APPROVED):
P5-00 Master → P5-01 Audit → P5-02 Action Model → P5-03 Policy Engine → P5-04 Safety/Approval → P5-05 Explanation & Audit.

---

## 1. Purpose

P5-06 exposes **existing** P5 decision/action information to consumers.

P5-06 answers: *"What action decision exists, what is its current state, why
was it produced, what evidence/policy/safety/approval context supports it,
and what is its execution/permission status?"*

P5-06 does **NOT** answer: *"What action should we invent now?"*

- Decision creation belongs upstream (P5-03).
- Safety / approval / permission belongs P5-04.
- Explanation / audit semantics belong P5-05.
- P5-06 is read / integration / presentation only.

## 2. Architecture

```
P5 Decision / Audit records (P5-03/04/05 outputs)
        ↓
P5-06A  Action Read Service        (src/lib/p5/read/action-read.service.ts)
        ↓
P5-06B  Read-only API              (src/app/api/actions/[decisionId]/route.ts,
                                     src/app/api/narratives/[id]/action-decision/route.ts)
        ↓
P5-06C  UI panel                   (src/components/P5ActionDecisionPanel.tsx)
```

No layer bypasses the read service. The UI never touches storage directly.

## 3. P5-06A — Action Read Service

Files:

- `src/lib/p5/types.ts` — read model types (frozen vocabulary only)
- `src/lib/p5/read/display-state.ts` — presentation classification
- `src/lib/p5/read/action-read.service.ts` — `ActionReadService`,
  `P5DecisionStore` boundary, `NoP5DecisionStore` (absence adapter)

### 3.1 Read-only boundary

The service and its types contain **no write/mutation method**. It cannot:

- create decisions · evaluate policy · run safety rules
- grant approval · grant execution permission · execute actions
- retry commands · mutate audit history

### 3.2 Store boundary

`P5DecisionStore` is a read-only lookup interface:

- `findByDecisionId(decisionId)` — stable identity (P5-02 AD-013)
- `findBySubject({ narrativeId })` — subject-scoped lookup

The repository has **no P5 decision persistence yet** (P5-05 §16: audit
persistence model PROVISIONAL; P5-03/04/05 engines are contract-only).
The default `NoP5DecisionStore` is an explicit read-only absence adapter.
Tests inject an in-memory store. No production schema was invented to make
the UI work (P5-06 §22).

### 3.3 Supported reads (P5-06 §3 A–O)

| # | Capability | Implementation |
|---|---|---|
| A | Decision lookup by decisionId | `getDecisionByDecisionId` |
| B | Candidate/action lookup where identity exists | `decision.candidateId` / `decision.actionId` |
| C | Current decision state | `decision.decisionState` (orthogonal) |
| D | Approval state | `decision.approvalState` + `approvalRecord` |
| E | Execution state | `decision.executionState` (orthogonal) |
| F | Policy outcome | `decision.outcome` + `blockerReport` + `provenance.policy` |
| G | Safety/guardrail outcome | `decision.safetyResult` (aggregate + per-guardrail) |
| H | Execution permission result | `decision.permissionResult` |
| I | Explanation | `decision.explanation` (P5-05 §6 slots) |
| J | Provenance | `decision.provenance` (P5-05 §10) |
| K | Audit history | `decision.auditEvents` (read-only) |
| L | P4 snapshot reference | `provenance.p4SnapshotRef` (record) / `context.p4SnapshotRef` (live, labeled) |
| M | Version information | `provenance.versions` + per-dimension refs |
| N | Failure/unavailable state | `availability` + `error` |
| O | Timestamps | `provenance.timestamps` |

### 3.4 State semantics

The orthogonal dimensions (P5-02 AD-009) are never collapsed:

```
decisionState  ≠  approvalState  ≠  executionState
ELIGIBLE ≠ APPROVED ≠ SAFE ≠ EXECUTABLE ≠ EXECUTED
```

A response always distinguishes decision outcome / approval state / safety
result / execution permission / execution result.

### 3.5 Outcome semantics

The read layer keeps distinct: `NO_ACTION`, `POLICY-BLOCKED`,
`NOT_DETERMINED`, `SUPPRESSED`, `SELECTED`, `SAFETY-BLOCKED`,
`APPROVAL-DENIED`, `ABSENT / UNAVAILABLE`.

Never implemented:

```
UNKNOWN   → NO_ACTION
DEGRADED  → NO_ACTION
FAILURE   → NO_ACTION
BLOCKED   → NO_ACTION
SUPPRESSED → NO_ACTION
```

`deriveDisplayState` precedence (presentation-only, never replaces the
orthogonal fields):

1. `SERVICE_ERROR` / `P4_CONTEXT_UNAVAILABLE` → `UNAVAILABLE`
2. record absent → `ABSENT`
3. `suppressed` → `SUPPRESSED`
4. recorded `NO_ACTION` → `NO_ACTION`
5. recorded `NOT_DETERMINED` → `NOT_DETERMINED`
6. recorded `BLOCKED` (policy-origin, PD-018) → `POLICY_BLOCKED`
7. `SELECTED` + safety aggregate BLOCK → `SAFETY_BLOCKED`
8. `SELECTED` + approvalState DENIED → `APPROVAL_DENIED`
9. `SELECTED` → `SELECTED`

### 3.6 UNKNOWN / DEGRADED

P4 condition is preserved verbatim via `context.p4SnapshotRef.status` /
`versionTuple` / `asOf`. No confident action narrative is manufactured.
P4 unavailable (null) → `P4_CONTEXT_UNAVAILABLE` → `UNAVAILABLE`, never
NO_ACTION and never a silent ok.

### 3.7 Anti-drift (P5-05 §11)

- A decision record's snapshot is exposed **only** via record provenance
  (`context.source = "DECISION_RECORD"`).
- When **no** decision record exists, live P4 context may be shown under
  `context.source = "LIVE_P4_CONTEXT"` — explicitly **not** a decision basis.
- Historical snapshots are never silently replaced with current live data.

## 4. P5-06B — API

Two additive GET-only routes (repository conventions: Next.js App Router,
`NextResponse.json`, `data.*` envelope; the existing narrative/P3/P4 route is
untouched).

### 4.1 `GET /api/actions/:decisionId`

Decision lookup by stable identity (P5-02 AD-013).

- `200` — `{ success: true, data: { p5ActionDecision: view } }`
- `400` — invalid/empty decisionId
- `404` — `{ success: false, error: "Decision not found", availability: "DECISION_NOT_FOUND" }`
  (a lookup miss — never a domain NO_ACTION, never a silent substitute)
- `500` — service failure (`SERVICE_ERROR` availability is in the body only
  on 200 paths; infrastructure failure is never converted to NO_ACTION)

### 4.2 `GET /api/narratives/:id/action-decision`

Narrative-scoped view (P5-06C input). Additive — existing P3/P4 narrative
route data flow is unchanged.

- `200` — `{ success: true, data: { p5ActionDecision: view } }`
- `400` — invalid narrative id
- `404` — unknown narrative subject (repo convention; not a domain NO_ACTION)
- `500` — service failure

### 4.3 API safety

- Read-only: **no** POST / execute / approve / reject / retry / order endpoint.
- No interpretation such as `Direction = POSITIVE → INCREASE_EXPOSURE`.
- No BUY/SELL/LONG/SHORT semantics; no implicit execution semantics.
- No hidden score / threshold; no policy / safety / approval evaluation
  inside the API.

## 5. P5-06C — UI

File: `src/components/P5ActionDecisionPanel.tsx`
Mounted on: `src/app/narrative/[id]/page.tsx` (below the existing P4 panel,
additive).

The panel is informational and clearly distinguishes:

1. What was decided (outcome badge + decision/candidate/action ids)
2. Why (P5-05 explanation slots, derived from recorded facts)
3. Evidence/provenance (p4SnapshotRef + full provenance JSON)
4. Policy (policyId/version + rule refs)
5. Safety/guardrail (aggregate + per-guardrail results)
6. Approval (explicit authorization event; ack ≠ approval note)
7. Execution permission (result; "permission is not execution" note)
8. Execution result (NOT_APPLICABLE in v1)
9. Audit history (read-only events)
10. What did NOT happen (footer: no creation/approval/rejection/execution)

### 5.1 Never implies execution

- `EXECUTION_PERMISSION_GRANTED` is never rendered as "EXECUTED".
- `APPROVED` never means "EXECUTED"; `SELECTED` never means "EXECUTED".
- v1 advisory-only: no Execute/Buy/Sell/Order/Rebalance surface, no buttons.

### 5.2 No-action UI

The 8 situations stay distinct — never collapsed into "No action":
`NO_ACTION` (completed evaluation, nothing selected), `POLICY_BLOCKED`,
`NOT_DETERMINED`, `SUPPRESSED`, `SELECTED`, `SAFETY_BLOCKED`,
`APPROVAL_DENIED`, `ABSENT / UNAVAILABLE`.

### 5.3 UNKNOWN / DEGRADED UI

P4 UNKNOWN / DEGRADED / NULL / STALE conditions are preserved with their
label ("P4 context (live — not a decision basis)"). The panel renders
"NO ACTION" only when the recorded outcome is NO_ACTION.

## 6. Error / Availability Semantics

`availability` (P5-06A) separates:

| Availability | Meaning |
|---|---|
| `OK` | decision record present and readable |
| `NO_DECISION_RECORD` | subject has no P5 decision record |
| `DECISION_NOT_FOUND` | lookup by decisionId found nothing |
| `P4_CONTEXT_UNAVAILABLE` | P4 context could not be derived |
| `SERVICE_ERROR` | read-layer infrastructure failure |

Never mapped to NO_ACTION: 404 → NO_ACTION, DB failure → NO_ACTION, missing
P4 snapshot → NO_ACTION, service failure → NO_ACTION.

## 7. Provenance / Audit

- `provenance` exposes decisionId, candidateId, actionId, p4SnapshotRef,
  policy (id/version/effectiveAt/evaluationAt/ruleRefs), safety
  (guardrailVersion), approval (approvalPolicyVersion/authorityRef),
  automationMode, versions (actionModelVersion, p4VersionTuple), timestamps.
- No provenance is invented; the read layer never claims stronger provenance
  than the underlying record provides.
- `auditEvents` are exposed read-only; the service has no method that
  creates, rewrites, or compensates audit history (P5-05 §17 immutability).

## 8. Security / Read-only Boundary

- P5-06 introduces no RBAC, no approval roles, no authority hierarchy, no
  admin bypass, no emergency override (authority remains a conceptual P5-04
  contract — SG-007).
- The API surface is GET-only; the service is read-only; the UI has no
  mutation controls.
- No execution mechanism exists anywhere in P5-06 (v1 advisory-only, P5-04
  SG-010).

## 9. Tests

Test files (repo convention: vitest-style `describe/it` via `@jest/globals`,
`renderToStaticMarkup` for components):

- `src/lib/p5/__tests__/action-read.test.ts` — service semantics (A–T)
- `src/app/api/actions/__tests__/route.test.ts` — decisionId route
- `src/app/api/narratives/__tests__/p5-action-decision.test.ts` — narrative route
- `src/components/__tests__/P5ActionDecisionPanel.test.tsx` — UI semantics

Coverage (P5-06 §19 A–T): decision lookup · missing decision · NO_ACTION ·
POLICY-BLOCKED · NOT_DETERMINED · SUPPRESSED · SELECTED · SAFETY-BLOCKED ·
APPROVAL-DENIED · ABSENT/UNAVAILABLE · UNKNOWN P4 · DEGRADED P4 ·
acknowledgement ≠ approval · permission ≠ execution · no BUY/SELL mapping ·
no hidden score · provenance preservation · audit read-only/immutability ·
API failure ≠ NO_ACTION · P4-06 independence.

Results at implementation time: **48/48 P5 tests pass**; regression suite
(P4 service/API + components): **184/184 pass**; `tsc --noEmit` clean.

## 10. P4-06 Independence

P4-06 remains **OPEN / DATA ACCRUAL**. Its 9 provisional rules remain
INSUFFICIENT_EVIDENCE. P5-06 does not consume, promote, modify, wait for, or
depend on P4-06 — it operates against the frozen P4 contract only.

## 11. Legacy Compatibility

- C-001: acknowledgement ≠ approval — legacy `AlertAcknowledged` events
  never produce an approval state.
- C-002: P2 evidence "approved" ≠ P5 approval — the approval record is an
  explicit P5 authorization event.
- C-003: legacy STRONG_WATCH / WATCH / OBSERVE / WEAK recommendations are
  never migrated to P5 ActionTypes.

## 12. Known Limitations (PROVISIONAL / OPEN)

- **No P5 decision persistence** — production store is the absence adapter;
  the UI shows ABSENT until a P5-03/04/05 storage contract lands (P5-05
  §16 persistence model remains PROVISIONAL).
- `p4SnapshotRef.contentHash` — PROVISIONAL (P5-02 AD-014), always null.
- `EXECUTE` / `ESCALATE` — CANDIDATE (P5-02 AD-006/007), not v1 ActionTypes.
- Approval validity / permission expiry durations — OPEN (not invented).
- Authority implementation — PROVISIONAL conceptual contract (P5-04 SG-007).
- ASSISTED / AUTONOMOUS automation — CANDIDATE / FUTURE, not implemented.

## 13. Future Execution Boundary

Execution mechanics remain **OUT OF SCOPE** for P5-06 and for P5 as a whole
until a separately frozen downstream contract authorizes them. P5-06 grants
no execution; it can only ever *display* recorded permission/execution
results. v1 is advisory-only; execution permission for consequential actions
is NOT_GRANTED (P5-04 SG-010).

## 14. Implementation Discipline

Production changes in this task:

- `src/lib/p5/types.ts` (new)
- `src/lib/p5/read/display-state.ts` (new)
- `src/lib/p5/read/action-read.service.ts` (new)
- `src/app/api/actions/[decisionId]/route.ts` (new)
- `src/app/api/narratives/[id]/action-decision/route.ts` (new)
- `src/components/P5ActionDecisionPanel.tsx` (new)
- `src/app/narrative/[id]/page.tsx` (edited — additive panel mount)
- Tests: 4 new test files

No changes: P3, P4, P4-06, DB schema, migrations, package files, existing
P4/API/UI routes (verified by regression).

---

# P5-06 FINAL REVISION / FREEZE REPORT

Status: **FROZEN / APPROVED FOR DOWNSTREAM** (freeze-gate task).
P5-07 is **NOT STARTED**.

## 1. Revision Summary

No code changes were required in this freeze check. The P5-06
implementation as delivered already satisfies every freeze gate; this
revision only appends the final freeze record and verification evidence.
The implementation surface (P5-06A service + P5-06B GET routes + P5-06C
read-only panel) is unchanged.

## 2. Files Audited

- `src/lib/p5/types.ts`, `src/lib/p5/read/display-state.ts`,
  `src/lib/p5/read/action-read.service.ts`
- `src/app/api/actions/[decisionId]/route.ts`,
  `src/app/api/narratives/[id]/action-decision/route.ts`
- `src/components/P5ActionDecisionPanel.tsx`,
  `src/app/narrative/[id]/page.tsx`
- Tests: `src/lib/p5/__tests__/action-read.test.ts`,
  `src/app/api/actions/__tests__/route.test.ts`,
  `src/app/api/narratives/__tests__/p5-action-decision.test.ts`,
  `src/components/__tests__/P5ActionDecisionPanel.test.tsx`
- Upstream contracts P5-00 → P5-05 (cross-checked, not modified)

## 3. Code Changes

NONE in this task (freeze-gate only).

## 4. Contract Verification

- P5-02: outcome vocabulary (SELECTED / NO_ACTION / BLOCKED /
  NOT_DETERMINED), 3 orthogonal state dimensions, candidateId → decisionId
  → actionId, p4SnapshotRef (AD-014), AD-008 no BUY/SELL — all preserved.
- P5-03: NO_ACTION only as recorded completed-evaluation outcome;
  POLICY-BLOCKED / NOT_DETERMINED / SUPPRESSED / SELECTED distinct;
  rule refs are technical references, never priority (AD-024).
- P5-04: SAFETY-BLOCKED / APPROVAL-DENIED distinct with provenance;
  permission ≠ execution (SG-011); ELIGIBLE ≠ APPROVED ≠ SAFE ≠ EXECUTABLE
  ≠ EXECUTED; v1 advisory-only (SG-010).
- P5-05: explanation read from records only; audit read-only; provenance
  never fabricated; live P4 never substituted for a recorded snapshot
  (anti-drift).

## 5. 22 Freeze Gates

| Gate | Result | Evidence |
|---|---|---|
| G1 P4→P5 boundary | **PASS** | P5-06 consumes P4 ViewModel as declared input only; Direction/O/R/C/A never re-derived; `P4DirectionState` re-exported for verbatim display only |
| G2 P5-02 compatibility | **PASS** | Outcomes + orthogonal states + identity chain + snapshot ref preserved in `types.ts` |
| G3 P5-03 compatibility | **PASS** | No eligibility/policy/selection/blocking/suppression logic; `displayState` is projection only (`display-state.ts`) |
| G4 P5-04 compatibility | **PASS** | Safety/approval/permission only read+displayed; no decision logic; §5.1 never implies execution |
| G5 P5-05 compatibility | **PASS** | Explanation from records; audit events read-only; no invented claims |
| G6 Read-only boundary | **PASS** | GET-only routes; service has no mutation method; UI has no controls |
| G7 No hidden decision engine | **PASS** | Forbidden-term scan clean (only prohibition comments + P4 type import) |
| G8 NO_ACTION semantics | **PASS** | `deriveDisplayState` returns NO_ACTION only for recorded NO_ACTION; ABSENT/UNAVAILABLE/SUPPRESSED/BLOCKED never map to it |
| G9 BLOCKED provenance | **PASS** | 3-way classification (POLICY / SAFETY / APPROVAL) with `P5BlockerReport` refs |
| G10 Approval semantics | **PASS** | Approval = explicit record; panel renders ack ≠ approval note; no inferred approval |
| G11 Permission ≠ execution | **PASS** | `P5PermissionResult` = authorization result; `executionState` separate; UI footnote |
| G12 UNKNOWN/DEGRADED visibility | **PASS** | Cause preserved; record snapshot authoritative; live context labeled `LIVE_P4_CONTEXT` only when no record |
| G13 Provenance | **PASS** | All provenance fields 1:1 from record; unavailable → null, never fabricated |
| G14 Audit read-only | **PASS** | `auditEvents` displayed verbatim; no mutation path |
| G15 API contract | **PASS** | 404 = DECISION_NOT_FOUND (never NO_ACTION); 400/500 explicit; additive narrative payload; P4 routes untouched (141 P4 tests pass) |
| G16 UI boundary | **PASS** | Informational only; no buttons (asserted by test: rendered HTML contains no `<button>`) |
| G17 Display ≠ domain | **PASS** | Presentation precedence documented in `display-state.ts`; never converts a blocked state to NO_ACTION |
| G18 P4-06 independence | **PASS** | No import/consume/wait of P4-06; §10 of this doc |
| G19 Regression | **PASS** | tsc clean; 36 P5 tests + 141 P4 tests + 32 component tests pass; 7 P3 suite failures pre-existing (untouched files, assertion drift) |
| G20 Implementation discipline | **PASS** | Only P5-06 files + additive page.tsx mount; no P3/P4/DB/migration/package/config changes |
| G21 No scope creep | **PASS** | No persistence, policy, safety, approval, execution, replay, retry, automation, or RBAC implementation |
| G22 Cross-document consistency | **PASS** | §4 matrix below; no silent semantic override |

## 6. Cross-Document Consistency Matrix

| Semantic | P5-02 | P5-03 | P5-04 | P5-05 | P5-06 treatment |
|---|---|---|---|---|---|
| NO_ACTION | DecisionOutcome | completed eval, no selection | — | explained as such | displayed only when recorded |
| POLICY-BLOCKED | BLOCKED outcome | + blocker source POLICY | distinct | explained with policy refs | displayState POLICY_BLOCKED |
| NOT_DETERMINED | DecisionOutcome | distinct | — | cause preserved | displayed distinctly |
| SUPPRESSED | — (layer result) | PD-019 | — | never NO_ACTION | displayed as SUPPRESSED |
| SELECTED | DecisionOutcome | selection result | downstream safety eval | explained | displayed as SELECTED |
| ELIGIBLE | evaluation result | PD-002 | ≠ SAFE | — | not rendered as approval/execution |
| APPROVED | approval state | — | SG-005/006 | traceable | shown as approval state only |
| SAFE | — | — | safety result | — | shown as safety result only |
| EXECUTION_PERMISSION_GRANTED | — | — | SG-011 | ≠ executed | authorization result only |
| EXECUTED | execution state | — | execution layer | — | executionState field only |
| FAILED / CANCELLED / REVOKED / EXPIRED / STALE | state vocab | — | — | preserved | rendered from records |
| ABSENT | — | — | — | P5-05 §8 | availability fact, never NO_ACTION |

## 7. API Verification

- `GET /api/actions/:decisionId` — 200 (record), 404 + `availability:
  "DECISION_NOT_FOUND"` (miss, never NO_ACTION), 400 (invalid id), 500
  (service failure).
- `GET /api/narratives/:id/action-decision` — 200 with
  `data.p5ActionDecision` (including explicit `availability`), 400, 404
  (unknown narrative), 500. Additive; P4 narrative payload untouched.

## 8. UI Verification

P5ActionDecisionPanel renders: outcome badge, availability, orthogonal
state dimensions, identity, explanation slots, policy, safety/guardrail,
approval (ack ≠ approval), execution permission (≠ execution), execution
result (v1 NOT_APPLICABLE), audit history, provenance JSON, read-only
footer. All 8 situations (NO_ACTION … ABSENT/UNAVAILABLE) distinct.

## 9. Read-only / Safety Boundary

- Zero mutation methods in the service; GET-only routes; no interactive
  controls in the panel (test asserts no `<button>`).
- No execution mechanism, no approval mutation, no policy/safety
  evaluation anywhere in P5-06.

## 10. Absence Adapter Verification

`NoP5DecisionStore` is an explicit read-only absence adapter. It:
- does **not** create a DB schema or persistence contract;
- never converts ABSENT into NO_ACTION (availability field is
  infrastructure-level);
- is **not** production persistence — P5 decision persistence remains
  unimplemented (P5-05 §16 PROVISIONAL), correctly documented as such.

## 11. Live P4 Context Anti-Drift Verification

- Record present → `context.source = "DECISION_RECORD"`, snapshot from
  record provenance only; current P4 is never consulted.
- No record → live P4 context only under `context.source =
  "LIVE_P4_CONTEXT"` with `decisionPresence: "ABSENT"`; never a pseudo
  decision. P4 unavailable → `P4_CONTEXT_UNAVAILABLE` / UNAVAILABLE, never
  NO_ACTION.

## 12. Test Results

- P5 suites: **36/36 pass** (4 suites: service, 2 route, panel).
- TypeScript: `tsc --noEmit` clean.

## 13. Regression Results

- P4 + narrative API: **141/141 pass**.
- Components (excluding P5 panel): **32/32 pass**.
- P3: 7 suites fail — **pre-existing** (assertion drift in untouched P3
  files, e.g. `bullishRatio` null vs expected value; `db.select is not a
  function` in membership mocks). No P3 file is modified by P5-06; git
  diff confirms.

## 14. P4-06 Independence

P4-06 remains **OPEN / DATA ACCRUAL**. No import, promotion, modification,
or dependency. The 9 provisional rules remain untouched.

## 15. Git Diff Boundary

Task changes: new `src/lib/p5/**`, `src/app/api/actions/**`,
`src/app/api/narratives/[id]/action-decision/**`, `src/components/
P5ActionDecisionPanel.tsx`, 4 test files, `docs/P5_Upgrade/
P5-06_IMPLEMENTATION.md`, and the +4-line additive page.tsx mount.
Pre-existing dirty files NOT touched by this task: `P5_MASTER_
SPECIFICATION.md`, `package-lock.json`, `tsconfig.tsbuildinfo`, and the
P5-01→P5-05 docs from earlier phases.

## 16. Remaining Limitations

- No P5 decision persistence exists — read surface operates on the
  absence adapter until P5-03/04/05 storage exists.
- `contentHash` always null (P5-02 AD-014 PROVISIONAL).
- Live P4 context is display-only context, never a decision basis.

## 17. Provisional / Open / Candidate / Deferred

- **PROVISIONAL:** audit persistence model (P5-05 §16), contentHash
  (AD-014), authority contract (SG-007), material-change criteria (SG-012),
  taxonomy membership (AD-005).
- **OPEN:** cooldown duration, expiry/validity durations (P5-03/05).
- **CANDIDATE / FUTURE:** ASSISTED, AUTONOMOUS, ESCALATE, EXECUTE
  (execution layer).
- **DEFERRED:** ESCALATE policy details (P5-04/06).
- **OUT OF SCOPE:** execution mechanics, trading integration, persistence
  schema, RBAC, emergency override.

## 18. Freeze Matrix

| Semantic | Owner | Status | Downstream |
|---|---|---|---|
| Read-only boundary | P5-06 | FROZEN | P5-07, consumers |
| Outcome/state distinction | P5-02/03/04 | FROZEN (preserved) | all |
| NO_ACTION semantics | P5-03 | FROZEN | P5-06 display |
| Blocker provenance | P5-03/04 | FROZEN | P5-06 display |
| Permission ≠ execution | P5-04 | FROZEN | P5-06 display |
| Absence adapter | P5-06 | FROZEN (explicit) | future storage |
| Audit read-only | P5-05 | FROZEN | P5-06 display |
| P4-06 independence | P5-06 | FROZEN | all |
| Persistence model | P5-05 | PROVISIONAL | P5-05-IMPL |
| Authority implementation | P5-04 | PROVISIONAL | P5-04-IMPL |
| Automation modes | P5-04 | CANDIDATE / FUTURE | P5-06-future |
| Execution mechanics | — | OUT OF SCOPE | future |

## 19. Final Freeze Statement

P5-06 is **FROZEN / APPROVED FOR DOWNSTREAM** for the read/integration/
presentation contract it defines. This freeze applies only to FROZEN
semantics; PROVISIONAL / CANDIDATE / OPEN / DEFERRED / OUT OF SCOPE items
remain unchanged. P5-06 is a read-only layer: it exposes what P5-03/04/05
produced and never creates decisions, policy, safety, approval, or
execution. P5-07 is **NOT STARTED**.

## 20. Verification Record

- Freeze check performed: 2026-08-17 (agent audit).
- `tsc --noEmit`: PASS. P5 tests: 36/36. P4/API regression: 141/141.
  Component regression: 32/32. P3 failures pre-existing (verified).
- Forbidden-term scan: clean (no BUY/SELL mapping, no score/threshold, no
  hidden decision logic).
- Git boundary: verified — only P5-06 task files + additive page mount.
