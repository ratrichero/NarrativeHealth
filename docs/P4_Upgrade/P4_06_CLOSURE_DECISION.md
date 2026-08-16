# P4-06 — Historical Validation Closure Decision

**Phase:** P4 — Intelligence → Decision Support
**Task:** P4-06-CLOSURE-DOC
**Status:** DECISION RECORDED — **OPTION A (KEEP OPEN) RECOMMENDED** — pending reviewer confirmation
**Authoritative phase document:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md`

This document is the formal decision record determining whether P4-06
(Historical Decision Validation) should (A) remain open for further
historical data accrual/replay, or (B) close with the final semantic verdict
INSUFFICIENT_EVIDENCE.

It is a DOCUMENTATION/DECISION task: no P4-03/P4-04 semantics were modified,
no P3/P2 code was touched, no validation code was added, no data was
invented, and no provisional rule was promoted.

---

## 1. P4-06 objective

P4-06's purpose (P4-03 §17, P4-06A §1): determine whether the PROVISIONAL
P4-03 v1 interpretation rules behave sensibly over historical P3 evidence.
It is NOT to make rules pass. The acceptable outcomes per rule are
VALIDATED / PARTIALLY_SUPPORTED / CONTRADICTED / INSUFFICIENT_EVIDENCE, where
INSUFFICIENT_EVIDENCE is a legitimate final state and is neither PASS nor
FAIL.

The objective was operationalized by P4-06A (framework + replay harness) and
P4-06B (execution). P4-06B-DOC froze the protocol; P4-06B-IMPL executed it
against the real database and produced the validation report.

## 2. Technical execution vs semantic validation vs phase closure

These are three distinct levels and must not be conflated:

| Level | Status | Evidence |
|---|---|---|
| **Technical execution** | COMPLETE | as-of loaders, sample builder, mechanical rule evaluation, leakage/identity tests (21/21), full P4 suite 111/111, tsc 0 errors — `P4_06B_HISTORICAL_VALIDATION_REPORT.md` |
| **Semantic validation** | NOT ACHIEVED — INSUFFICIENT_EVIDENCE for all 9 rules | real replay of 3 samples; 0 contradictions; no required scenario class fully covered |
| **Phase closure (this decision)** | PENDING — this document records the recommendation; closure requires reviewer confirmation | — |

Technical completion ≠ semantic validation ≠ phase closure. Only this
decision document addresses the third.

## 3. Actual historical evidence inventory (verified, not assumed)

Re-queried live DB at P4-06B execution time and re-verified for this
decision:

- 5 narratives (ids 1, 2, 3, 4, 6); only narrative 1 has artifacts.
- **3 P3 artifacts** — ids 1 (2026-08-11), 9 (2026-08-13), 10 (2026-08-15);
  all `p3-orchestrator`/`1`/`observed`/`7D`, all VALID, no duplicates.
- **2 transitions** (1→9, 9→10).
- **0 P2 event-risk rows**; 1 historical-correction row.
- **0 conflicting (core-split) cases; 0 STALE; 0 INVALID; 0 POSITIVE
  Direction samples.**
- 3 replay samples (1 DEGRADED INSUFFICIENT_HISTORY; 2 VALID NEGATIVE).

## 4. Rule-by-rule assessment (all 9 provisional rules)

All from the executed P4-06B report (observed classes recorded, no
promotion):

| Rule | Observed conforming behavior | Unobserved required classes | Verdict |
|---|---|---|---|
| R1 Corroborator set / reconciliation | dominant-lean survives opposing corroborator (2 samples) | tentative_opposing, neutral_split | INSUFFICIENT_EVIDENCE |
| R2 Conflict materiality / severity | minor conflict severity low, not material (1 sample) | core_split_1, core_split_2plus | INSUFFICIENT_EVIDENCE |
| R3 P2 scope tiers | — (missing_p2 only) | all 4 P2 scope classes | INSUFFICIENT_EVIDENCE |
| R4 Opportunity suppression ladder | — (no POSITIVE sample) | all ladder steps | INSUFFICIENT_EVIDENCE |
| R5 Risk base thresholds | ≥2 NEGATIVE ⇒ HIGH (2 samples) | neg_1, neg_0 | INSUFFICIENT_EVIDENCE |
| R6 Confidence combination | cov_full HIGH, minor −1 ⇒ MEDIUM, insufficient-history LOW | material_cap, divergence, stale_cap, cov_low, cov_corr1 | INSUFFICIENT_EVIDENCE |
| R7 Actionability table | §13 LOW×HIGH×NEGATIVE ⇒ HIGH (2 samples) | HIGH×HIGH, material/P2 caps | INSUFFICIENT_EVIDENCE |
| R8 Opportunity × Risk matrix | lowxhigh cell (2 samples) | highxhigh, lowxlow, mediumxmedium | INSUFFICIENT_EVIDENCE |
| R9 NARRATIVE_* minimums | deterioration fires correctly; breadth-only opposition does not suppress (C4) | improving side, core-split suppression | INSUFFICIENT_EVIDENCE |

**No rule is promoted. INSUFFICIENT_EVIDENCE is not reinterpreted as
correctness.** The conforming observations are early, weak signals to confirm
later — nothing more.

## 5. Scenario coverage

Observed: deterioration; weakening with positive RS (minor conflict);
insufficient history (degraded). Not observed: strong broad improvement,
strong concentrated improvement (POSITIVE never fires), neutral/mixed, true
MIXED (core split), stale, all P2 scenarios, positive-vs-deteriorating and
negative-vs-improving divergence cases.

## 6. Proven capabilities

What the current evidence DOES establish (mechanical/contract-level, not rule
validation):

- The production P4 path is deterministic and reproducible over historical
  artifacts (same input ⇒ same output modulo `generatedAt`).
- Identity isolation works: mixed-identity series are rejected; the latest
  identity group is selected without contamination.
- No future leakage: as-of queries are SQL-bounded and replay output is
  independent of future artifacts.
- UNKNOWN propagation and the INSUFFICIENT_HISTORY degradation gate behave as
  frozen (§14) on the single-artifact window.
- Minor (breadth/corroborator-only) conflicts fire with severity low and
  material=false (C1 conforming on the observed case), and Confidence −1 on
  a minor opposing corroborator (C2-compatible on the observed case).
- The NARRATIVE_DETERIORATION signal fired only with matching trend + core
  corroboration and was NOT suppressed by breadth-only opposition (C4
  conforming on the observed case).

## 7. Unproven capabilities

- Core-split materiality (C1's central clause) — zero samples.
- Material-conflict Confidence cap at MEDIUM (C2's central clause) — zero
  samples.
- All P2 scope tiers and Risk projection — zero P2 rows.
- Opportunity suppression ladder — zero POSITIVE samples.
- Risk MEDIUM/LOW branches, Confidence coverage-floor branches, STALE cap —
  zero samples.
- The full Actionability table and the O×R HIGH×HIGH cell — zero samples.
- NARRATIVE_IMPROVEMENT and core-split suppression — zero samples.
- Cross-narrative behavior — 1 narrative only.

## 8. Option A — data accrual / keep open

**Keep P4-06 open** as IN PROGRESS; do not mark it complete. The validation
mandate stays live; the deterministic harness is re-run as artifacts accrue.
The standing verdict remains INSUFFICIENT_EVIDENCE until re-evaluation.

- Pros: the question is genuinely unanswered and answerable; the system
  (P3-15 scheduler) will produce more artifacts; re-run cost is near zero;
  no premature permanence for provisional rules.
- Cons: phase stays open indefinitely without an owner/trigger; no
  guarantee data accrues in this environment; administrative overhead.

## 9. Option B — close with INSUFFICIENT_EVIDENCE

**Close P4-06** with the final semantic verdict INSUFFICIENT_EVIDENCE for
all 9 rules. Rules remain PROVISIONAL (never promoted, never rewritten).
A documented re-run procedure is preserved so a future task can re-open
validation if evidence accrues.

- Pros: decisive phase boundary; verdict is already final for the current
  evidence (re-playing the same 3 artifacts adds nothing); P4-07 proceeds
  regardless; no lingering open phase.
- Cons: closing without a re-validation owner risks provisional rules
  staying unvalidated permanently; P4-06's core question remains
  unanswered with no committed follow-up.

## 10. P4-07 dependency analysis

- P4-07 (production validation / runtime operational validation) is
  **semantically independent** of P4-06's rule status (P4-06B-DOC §25):
  P4-07 validates live deployment, API/UI behavior, scheduler cadence and
  operational health — not provisional-rule semantics.
- Neither option blocks P4-07. Under Option A, P4-06 stays open and P4-07
  may run in parallel; under Option B, P4-07 follows normally.
- P4-07 must NOT re-litigate P4-06 rule statuses; the INSUFFICIENT_EVIDENCE
  verdict travels with the rules as a documented caveat.

## 11. Explicit recommendation

**RECOMMENDED: Option A — keep P4-06 open for data accrual/replay, with a
defined re-run trigger and closure criteria (§12).**

Rationale:
1. The validation question is genuinely open — every rule lacks at least one
   required scenario class, and the missing classes (core splits, P2,
   POSITIVE-direction, stale) are exactly the ones the production system will
   produce over time.
2. The harness is deterministic, leakage-safe, and tested — the marginal cost
   of re-running is near zero, so keeping the phase open is cheap.
3. Closing now would make PROVISIONAL rules permanently unvalidated with no
   re-validation owner; that is a worse state than a defined open phase with
   a trigger.
4. P4-07 is not blocked either way (§10), so openness costs no sequencing.

This recommendation is provisional until the reviewer confirms it (the task
requires not closing P4-06 automatically).

## 12. Closure criteria

P4-06 may be closed (Option B) when ANY of the following holds, each via a
separate documented decision:

1. **Sufficient evidence achieved** — every provisional rule reaches
   VALIDATED or PARTIALLY_SUPPORTED with no CONTRADICTED rule (frozen §10
   sample policy: all required classes observed, ≥3 narratives, ≥10 samples,
   recurrence).
2. **Contradiction resolved** — any CONTRADICTED rule has been processed via
   Master §21 (explicit decision: revision, or documented acceptance).
3. **Deliberate provisional acceptance** — an explicit reviewer decision
   accepts PROVISIONAL status as final for the product (e.g., P4-07 or
   production needs force closure), recorded in the Master.
4. **Data-accrual ceiling** — evidence shows the production system will not
   produce the missing scenario classes within a stated horizon, and the
   decision to accept INSUFFICIENT_EVIDENCE is recorded.

**Re-run trigger (while open):** execute the P4-06B harness again when any of:
(a) ≥10 eligible replay points exist across ≥3 narratives; (b) any P2
event-risk rows appear; (c) a core-split conflict sample appears; (d) a
STALE or INVALID artifact appears; (e) a POSITIVE-direction replay point
appears.

## 13. Master update proposal

If the recommendation (Option A) is confirmed, update
`P4_MASTER_SPECIFICATION.md` minimally:
- Roadmap: P4-06 stays **IN PROGRESS — NOT COMPLETE (closure decision:
  keep open for data accrual; see P4_06_CLOSURE_DECISION.md)**.
- Add a §19I checkpoint recording this decision document, the re-run
  trigger, and the closure criteria.
- Phase line: next task = P4-07 (production validation) may proceed in
  parallel; P4-06 re-evaluation is trigger-based.
- Do NOT rewrite semantic sections; do NOT mark P4-06 complete.

## 14. Contradiction audit against Master §21

- **No semantic contradiction was discovered** in this task. The P4-06B
  execution recorded zero rule contradictions; this decision changes no
  semantics.
- Master §21 requires: any semantic change → versioned amendment,
  documentation update, impact assessment, affected-task identification,
  version bump. This decision makes NO semantic change: rules remain
  PROVISIONAL, C1–C5 remain frozen exactly as resolved, no threshold/
  epsilon/signal/UNKNOWN/NEUTRAL/MIXED change, no promotion, no revision.
- No silent resolution occurred: the only statuses changed are
  phase-management states (IN PROGRESS), not rule semantics.
- P4-06 and P4-07 remain semantically separate (§10).

## 15. Final decision status

| Item | Value |
|---|---|
| Decision recorded | YES — this document |
| Recommended option | **A — keep open (data accrual / replay)** |
| Alternative | B — close with INSUFFICIENT_EVIDENCE (available; see §9/§12) |
| Semantic verdict | INSUFFICIENT_EVIDENCE for all 9 rules (unchanged; not PASS, not FAIL) |
| Rules promoted | 0 |
| Rules modified | 0 |
| C1–C5 | unchanged (frozen) |
| P3/P2 modifications | none |
| P4-06 marked complete | NO (requires reviewer confirmation of this decision) |
| P4-07 | NOT implemented; independent; may proceed |
| Contradictions (Master §21) | none |

**This document is the decision record; it is not itself the closure.** If
the reviewer confirms Option A, the Master update in §13 is applied and P4-06
remains open with the re-run trigger. If the reviewer prefers Option B, the
Master is updated accordingly (P4-06 → COMPLETE with final verdict
INSUFFICIENT_EVIDENCE) — still without promoting or modifying any rule.

---
*End of closure decision. See P4_MASTER_SPECIFICATION.md for phase status.*
