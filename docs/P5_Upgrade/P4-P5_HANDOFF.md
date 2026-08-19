# P4-P5 Handoff Document

## Purpose

This document defines the frozen semantic contracts that P6 and future phases must NOT violate, and provides the acceptance gate audit for baseline closure.

---

## 1. Frozen Semantic Contracts

These invariants are established by P4-P5 and must be preserved in all future phases.

### Outcome Independence

| Contract | Source | Violation Example |
|---|---|---|
| `outcome ≠ safety` | P5-02 AD-009 | SELECTED can coexist with safety=BLOCK. NO_ACTION is not "unsafe". |
| `outcome ≠ approval` | P5-02 AD-009 | SELECTED can coexist with approval=DENIED. |
| `outcome ≠ permission` | P5-02 AD-009 | SELECTED can coexist with permission=NOT_GRANTED. |
| `outcome ≠ execution` | P5-02 AD-009 | SELECTED is a selection, NOT an execution. executionState=NOT_APPLICABLE in V1. |

### Safety/Approval/Permission Independence

| Contract | Source | Violation Example |
|---|---|---|
| `safety ≠ approval` | P5-02 AD-009 | safety=PASS does not imply approval=APPROVED. |
| `approval ≠ permission` | P5-02 AD-009 | approval=APPROVED does not imply permission=GRANTED. |
| `permission ≠ execution` | P5-02 AD-009 | permission=GRANTED does not imply execution=EXECUTED. |

### Selection vs Execution

| Contract | Source | Violation Example |
|---|---|---|
| `selection ≠ execution` | P5-02 AD-008 | MONITOR is an advisory selection. It must never trigger BUY/SELL/ORDER/TRADE. |

### Absence vs Outcome

| Contract | Source | Violation Example |
|---|---|---|
| `NO_DECISION_RECORD ≠ NO_ACTION` | P5-06 §5 | "No decision exists" is NOT the same as "decision evaluated, no action warranted". Never map absence to NO_ACTION. |

### Historical Integrity

| Contract | Source | Violation Example |
|---|---|---|
| `historical ≠ live recomputation` | P5-05 §11 | Historical decisions must be read from persisted artifacts, never re-computed from live P4 data. |

### Identity

| Contract | Source | Violation Example |
|---|---|---|
| `decisionId is deterministic` | P5-02 AD-013/AD-018 | Same identity tuple → same decisionId. No random, sequence, or wall-clock identity. |
| `decisionId ≠ idempotencyKey ≠ contentHash` | P5-02 AD-013 | These are three distinct identifiers with different purposes. |

### Presentation Boundary

| Contract | Source | Violation Example |
|---|---|---|
| `presentation is pure transformation` | P5-06C | Presentation layer must NOT evaluate policy, score, rank, threshold, or create new business rules. |
| `presentation does not query live P4` | P5-06C | Historical decisions use persisted snapshot, never live P4 re-query. |

---

## 2. Acceptance Gate Audit (G1–G20)

| Gate | Description | Evidence | Result |
|---|---|---|---|
| G1 | Baseline completeness | All P5-03/04/05/07/08/09/10/11 components implemented and frozen | ✅ PASS |
| G2 | Architecture consistency | P3→P4→P5-03→04→05→10→09→PostgreSQL→08→07→Read→UI chain verified from source | ✅ PASS |
| G3 | Capability consistency | Capability catalog (this document §2) matches source implementation | ✅ PASS |
| G4 | UI consistency | P5ActionDecisionPanel renders all AVAILABLE NOW capabilities (U1–U10) | ✅ PASS |
| G5 | Provenance consistency | Full chain: P4 snapshot → p4SnapshotRef → P5-03 → P5-04 → P5-05 → P5-10 → P5-09 → read → presentation → UI. No break | ✅ PASS |
| G6 | Semantic invariants | All frozen contracts (§1 above) verified from source. No violations | ✅ PASS |
| G7 | Open-item consistency | Open items register (P4-P5_OPEN_ITEMS.md) is complete. No undocumented items | ✅ PASS |
| G8 | Frozen-component consistency | Zero frozen P5-03/04/05/07/08/09/10/11 components modified during baseline | ✅ PASS |
| G9 | Regression evidence | 481/481 tests pass (28 suites). P4: 150/150. P5: 338/338 | ✅ PASS |
| G10 | Typecheck | tsc --noEmit = exit 0 | ✅ PASS |
| G11 | No Class A gap | Product closure audit found zero class A (completion blocker) items | ✅ PASS |
| G12 | No undocumented provisional | contentHash (O1) documented in open items register | ✅ PASS |
| G13 | No undocumented environment blocker | Real PostgreSQL E2E (O3) documented in open items register | ✅ PASS |
| G14 | No future item as current capability | All FUTURE/P6 items (O7–O12) clearly classified as future | ✅ PASS |
| G15 | P4 frozen contracts intact | P4 types, service, panel untouched | ✅ PASS |
| G16 | P5-03 frozen | Policy evaluator untouched | ✅ PASS |
| G17 | P5-04 frozen | Safety evaluator untouched | ✅ PASS |
| G18 | P5-05 frozen | Explanation evaluator untouched | ✅ PASS |
| G19 | P5-10/11 frozen | Producer + adapter untouched | ✅ PASS |
| G20 | No execution semantics introduced | V1 remains advisory-only. executionState=NOT_APPLICABLE. No BUY/SELL/ORDER/TRADE | ✅ PASS |

**20/20 GATES PASS**

---

## 3. What P6 Must NOT Do

When P6 begins, it must:

| Must NOT | Reason |
|---|---|
| Modify P5-03 outcome vocabulary | Frozen by P4-P5 baseline |
| Modify P5-04 safety/approval/permission vocabulary | Frozen by P4-P5 baseline |
| Modify P5-05 explanation/audit vocabulary | Frozen by P4-P5 baseline |
| Modify P5-10 producer assembly logic | Frozen by P4-P5 baseline |
| Modify P5-09 recorder persistence logic | Frozen by P4-P5 baseline |
| Map NO_DECISION_RECORD to NO_ACTION | Violates P5-06 §5 |
| Map selection to execution without approval | Violates selection ≠ execution |
| Query live P4 for historical decisions | Violates historical-over-live |
| Create hidden scoring/ranking in presentation layer | Violates presentation purity |
| Change decisionId derivation | Violates AD-013/AD-018 |

## 4. What P6 May Do

| May Do | Condition |
|---|---|
| Add new ActionTypes to P5-02 vocabulary | Through explicit change request |
| Add execution semantics | With new P5-04 approval/permission artifacts |
| Surface P4 direction/signals in P5 panel | Enhancement, no semantic change |
| Implement contentHash | Through explicit change request |
| Add RBAC | Through explicit change request |
| Add permission artifact persistence | Through explicit change request |

---

## 5. Handoff Confirmation

This document confirms:

- P4-P5 is the frozen Product Baseline
- All semantic contracts are documented and verified
- All open items are registered and classified
- All acceptance gates pass
- Future phases must follow the change request process
- No silent modification of frozen semantics is permitted

**Baseline closure date:** August 2026

**Verified by:** Source-level audit of all production code + 481/481 passing tests + clean typecheck
