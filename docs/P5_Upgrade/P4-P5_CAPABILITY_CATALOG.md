# P4-P5 Capability Catalog

## Status Classification Key

| Status | Meaning |
|---|---|
| **AVAILABLE NOW** | Implemented, frozen, verified, visible in production UI |
| **PRODUCT ENHANCEMENT** | Exists but could be improved; not a completion blocker |
| **FUTURE / P6** | Not implemented; requires new phase |
| **PROVISIONAL** | Implemented but incomplete; works but has known limitation |
| **ENVIRONMENT BLOCKER** | Cannot be verified in current sandbox environment |

---

## User-Visible Capabilities

### AVAILABLE NOW

| # | Capability | Source | UI Location | User Value |
|---|---|---|---|---|
| U1 | **Decision outcome** (SELECTED/NO_ACTION/NOT_DETERMINED/BLOCKED) | P5-03 frozen evaluator | Badge + headline | User knows what the system decided |
| U2 | **Action type** (MONITOR/REVIEW/INVESTIGATE/etc.) | P5-03 frozen evaluator | Bold posture label | User knows what action is recommended |
| U3 | **Why this decision** (plain-language rationale) | P5-05 frozen evaluator + presentation model | "Why?" section | User understands the reasoning |
| U4 | **Confidence level** (HIGH/MEDIUM/LOW) with meaning | Presentation model (re-derived from outcome+status) | Confidence badge + meaning text | User calibrates trust |
| U5 | **What should I do?** (recommended posture) | Presentation model (derived from outcome+actionType) | "What should I do?" section | User knows next step |
| U6 | **Structured facts** (data snapshot, safety, approval, etc.) | P5-03/04/05 frozen evaluators | "How the system decided" bullet list | User sees the reasoning chain |
| U7 | **Decision history** (current + previous decisions) | Persisted P5-09 artifacts via PgHistoricalArtifactStore | "Decision history" section | User sees stability/change |
| U8 | **NO_DECISION_RECORD vs NO_ACTION distinction** | P5-06A read service + display-state derivation | Explicit availability messaging | User distinguishes "not evaluated" from "evaluated, nothing to do" |
| U9 | **Read-only / Advisory boundary** | P5 panel header + footer | Badges + disclaimer text | User knows system doesn't take action |
| U10 | **Technical details** (decisionId, provenance, audit, etc.) | P5DecisionRecord fields | Collapsible "Technical details" section | Auditor/debugger can inspect full record |

### PRODUCT ENHANCEMENT

| # | Capability | Current State | Enhancement Needed |
|---|---|---|---|
| E1 | **P4 confidence pass-through** | P4 confidence re-derived from outcome+status in presentation layer | Pass through P4's actual confidence value instead of re-deriving |
| E2 | **P4 direction surfacing** | Direction consumed by P5-03 but not shown in P5 UI | Show POSITIVE/NEGATIVE/MIXED/NEUTRAL badge in P5 panel |
| E3 | **MONITOR guidance differentiation** | All MONITOR outcomes show identical guidance text | Differentiate guidance by direction/confidence |

### FUTURE / P6

| # | Capability | Description |
|---|---|---|
| F1 | **P4 signals surfacing** | Show fired signals (NARRATIVE_IMPROVEMENT, EVIDENCE_CONFLICT, etc.) in P5 panel |
| F2 | **P4 opportunity/risk surfacing** | Show opportunity and risk qualitative values in P5 panel |
| F3 | **Trend intelligence in history** | Show decision trend/stability analysis in history section |
| F4 | **Additional action types** | REVIEW, INVESTIGATE, REDUCE_EXPOSURE, INCREASE_EXPOSURE, REBALANCE guidance refinement |
| F5 | **Execution semantics** | BUY/SELL/ORDER/TRADE execution (requires P6 action model) |
| F6 | **RBAC / authority** | Role-based access control for decision actions |

### PROVISIONAL

| # | Capability | Limitation |
|---|---|---|
| P1 | **contentHash** | Always null in V1. decisionId derived from AD-013/AD-018 identity tuple, NOT from contentHash. Works correctly without it. |
| P2 | **Permission artifact** | V1 by-design: permission = NOT_APPLICABLE. No permission artifact persisted. Will be needed when execution semantics are added. |

### ENVIRONMENT BLOCKER

| # | Capability | Blocker |
|---|---|---|
| B1 | **Real PostgreSQL E2E verification** | Sandbox blocks direct DATABASE_URL access. Source-verified from code: all contracts, provenance chain, idempotency, and read-back verified from source inspection + 481 passing tests. |

---

## Backend Capabilities (Not Directly Visible)

| # | Capability | Status | Notes |
|---|---|---|---|
| C1 | P4 Decision Support interpretation | AVAILABLE NOW | Frozen, 150/150 tests pass |
| C2 | P5 policy evaluation | AVAILABLE NOW | Frozen, 338/338 tests pass |
| C3 | P5 safety/approval/permission evaluation | AVAILABLE NOW | Frozen |
| C4 | P5 explanation/audit generation | AVAILABLE NOW | Frozen |
| C5 | P5 decision assembly + commit | AVAILABLE NOW | Frozen, idempotent |
| C6 | P5 historical artifact persistence | AVAILABLE NOW | Frozen, 7 p5_* tables |
| C7 | P5 historical-over-live replay | AVAILABLE NOW | Frozen |
| C8 | P5 presentation transformation | AVAILABLE NOW | Pure function, deterministic |
| C9 | P5 runtime integration adapter | AVAILABLE NOW | Orchestration only, no evaluation |
