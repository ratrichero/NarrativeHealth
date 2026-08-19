# P4-P5 Open Items Register

## Purpose

Single source of truth for all remaining items. Prevents future reports from misclassifying known limitations as bugs.

---

## Items Register

| # | Item | Status | Owner Phase | Blocking P4-P5? | Notes |
|---|---|---|---|---|---|
| O1 | contentHash | PROVISIONAL | Future | **No** | Always null in V1. decisionId derived from AD-013/AD-018 identity tuple, unaffected. Implement when content integrity verification is needed. |
| O2 | Permission artifact gap | OPEN / V1 by-design | Future | **No** | V1 has no execution semantics. Permission = NOT_APPLICABLE. Artifact persistence needed when execution is added (P6). |
| O3 | Real PostgreSQL E2E verification | ENVIRONMENT BLOCKER | Infrastructure | **No** | Sandbox blocks direct DATABASE_URL access. Source-verified: 481/481 tests pass, all contracts verified from source. Verify in deployed environment. |
| O4 | P4 confidence pass-through | Enhancement | Future | **No** | P4 provides confidence (HIGH/MEDIUM/LOW/UNKNOWN). Presentation model re-derives from outcome+status. Functional but may differ from P4 panel. |
| O5 | P4 direction surfacing | Enhancement | Future | **No** | Direction consumed by P5-03 but not shown in P5 UI. Available in P4 panel. |
| O6 | MONITOR guidance differentiation | Enhancement | Future | **No** | All MONITOR outcomes show identical guidance. Could differentiate by direction/confidence. |
| O7 | P4 signals surfacing | Future | P6 candidate | **No** | Fired signals (NARRATIVE_IMPROVEMENT, EVIDENCE_CONFLICT, etc.) not surfaced in P5 panel. |
| O8 | P4 opportunity/risk intelligence | Future | P6 candidate | **No** | Opportunity and risk qualitative values not surfaced in P5 panel. |
| O9 | Trend intelligence in history | Future | P6 candidate | **No** | Decision history shows current/previous but no trend analysis. |
| O10 | Additional action type guidance | Future | P6 candidate | **No** | REVIEW, INVESTIGATE, etc. have static guidance. Could be refined with domain-specific advice. |
| O11 | Execution semantics | Future | P6 | **No** | BUY/SELL/ORDER/TRADE execution requires new action model, approval workflow, and permission artifacts. |
| O12 | RBAC / authority | Future | P6 | **No** | Role-based access control for decision actions. |
| O13 | P4 explanation items in P5 | Not needed | — | **No** | P4 has detailed explanation items. P5 has simpler explanation from P5-05. Different content, not duplication. |
| O14 | P4 historical context in P5 | Not needed | — | **No** | P4 panel shows historical context. P5 panel does not need to duplicate. |
| O15 | P4 evidence traceability in P5 | Not needed | — | **No** | P4 panel shows evidence references. P5 has provenance chain instead. |

---

## Summary by Status

| Status | Count | Items |
|---|---|---|
| PROVISIONAL | 1 | O1 (contentHash) |
| OPEN / V1 by-design | 1 | O2 (Permission artifact) |
| ENVIRONMENT BLOCKER | 1 | O3 (Real E2E) |
| Enhancement | 3 | O4, O5, O6 |
| Future / P6 candidate | 5 | O7, O8, O9, O10, O11, O12 |
| Not needed | 3 | O13, O14, O15 |

## Key Clarification

**None of these items block P4-P5 baseline closure.** All items are either:
- Intentionally deferred to future phases (P6)
- Product enhancements (not completion defects)
- Environment limitations (not code defects)
- Not needed for V1 scope
