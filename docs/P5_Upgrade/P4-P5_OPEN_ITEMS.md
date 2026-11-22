# P4-P5 Open Items Register

## Purpose

Single source of truth for all remaining items. Prevents future reports from misclassifying known limitations as bugs.

---

## Items Register

| # | Item | Status | Owner Phase | Blocking P4-P5? | Notes |
|---|---|---|---|---|---|
| O1 | contentHash | PROVISIONAL | Future | **No** | Always null in V1. decisionId derived from AD-013/AD-018 identity tuple, unaffected. Implement when content integrity verification is needed. |
| O2 | Permission artifact gap | OPEN / V1 by-design | Future | **No** | V1 has no execution semantics. Permission = NOT_APPLICABLE. Artifact persistence needed when execution is added (P6). |
| O3 | Real PostgreSQL E2E verification | VERIFIED (sandbox) · CI PENDING | Infrastructure | **No** | 2026-11-21: sandbox đọc/ghi trực tiếp DB production (settlement, audit, đo pipeline), nên câu “sandbox blocks DATABASE_URL” đã hết đúng. Còn lại: chạy lại E2E trong CI/deployed env. Source-verified: 481/481 tests pass. |
| O4 | P4 confidence pass-through | **CLOSED (P5-06C-ENH)** | — | **No** | `P5P4SnapshotRef` có `confidence?` (optional, không đổi contract freeze); presentation model dùng đúng confidence của P4 khi có (`source: "P4"`), fallback suy diễn (`"DERIVED"`) khi record freeze không mang. Test: `src/lib/p5/read/__tests__/presentation-model.test.ts`. |
| O5 | P4 direction surfacing | **CLOSED (P5-06C-ENH)** | — | **No** | `P5P4SnapshotRef.direction?` được `buildP4SnapshotRef` điền từ P4 ViewModel; `P5ConfidenceGuidance.direction` + fact “Direction” trong WHY. Không có direction thì không bịa. Test cùng file O4. |
| O6 | MONITOR guidance differentiation | **CLOSED (P5-06C-ENH)** | — | **No** | `monitorGuidance(direction)` trả câu khác nhau cho POSITIVE / NEGATIVE / MIXED / NEUTRAL; thiếu direction thì giữ câu chung cũ. Chỉ áp cho `actionType = MONITOR`. |
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
| VERIFIED (sandbox) · CI PENDING | 1 | O3 (Real E2E) |
| CLOSED (P5-06C-ENH, 2026-11-21) | 3 | O4, O5, O6 |
| Future / P6 candidate | 6 | O7, O8, O9, O10, O11, O12 |
| Not needed | 3 | O13, O14, O15 |

## Key Clarification

**None of these items block P4-P5 baseline closure.** All items are either:
- Intentionally deferred to future phases (P6)
- Product enhancements (not completion defects)
- Environment limitations (not code defects)
- Not needed for V1 scope
