# P4-07 — Production Validation / Runtime Operational Validation Report

**Phase:** P4 — Intelligence → Decision Support
**Task:** P4-07-IMPL — Production Validation Implementation
**Status:** **PASS WITH LIMITATIONS**
**Specification:** `docs/P4_Upgrade/P4_07_PRODUCTION_VALIDATION_SPEC.md` (frozen)
**Authoritative phase document:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md`

This report records the executed P4-07 production validation. The production
P4 implementation was NOT modified; no semantics changed; P4-06 remains OPEN
with data accrual; no provisional rule was promoted.

---

## 1. Scope

Validated the full production chain: P3 persisted/read models →
`getP4DecisionSupport` (load → assemble → interpret → explain → map) →
`GET /api/narratives/[id]` → `P4DecisionSupportPanel` on `/narrative/[id]`.
Validation-only code was added under `src/lib/p4/validation/`; nothing in the
production path was changed.

## 2. Environment

- Sandbox (Freebuff) with live read-only Postgres reachable; 5 narratives,
  3 P3 artifacts (narrative 1), 0 P2 rows, 3 constituent snapshots.
- `npx tsc --noEmit`, Jest 39/39 validation, 129/129 P4, 12/12 API,
  32/32 UI (14 P4 panel + 18 P3 panel).
- Latency observations were made against the live service with a warm
  connection pool.

## 3. System under test

`src/lib/p4/service.ts` → `assembler.ts` → `interpretation.ts` →
`explanation/engine.ts` → `src/app/api/narratives/[id]/route.ts` →
`src/app/narrative/[id]/page.tsx` → `src/components/P4DecisionSupportPanel.tsx`.
The validation harness reuses the production functions directly — no shadow
interpretation, no duplicate explanation algorithm (verified by import graph).

## 4. Tests executed

- New: `src/lib/p4/validation/__tests__/production.test.ts` — 18 tests
  (failure-isolation drill matrix A–L, determinism, identity drills,
  provenance contract, explanation limits, stale/invalid exclusion,
  no-humanValue).
- Existing: full `src/lib/p4` (129), API narratives (12), P4 panel UI (14),
  P3 panel UI (18).
- Runtime: live latency/determinism/concurrency/read-only observations
  (§16/§17).

## 5. Production-path audit

- **PASS.** `getP4DecisionSupport` performs load → assemble → `interpretP4`
  → `buildExplanation` → `toViewModel`; the route adds the ViewModel to
  `data.p4DecisionSupport` with zero interpretation logic; the UI renders the
  ViewModel verbatim.
- No shadow algorithm: validation code imports the production modules; no
  copy/paste of interpretation or explanation logic.

## 6. Failure-isolation results

| Drill | Result | Contract outcome |
|---|---|---|
| A valid P4 result | PASS | status OK, direction POSITIVE (fixture) / NEGATIVE (live narrative 1) |
| B no valid P3 current | PASS | service → `null` |
| C insufficient history | PASS | DEGRADED ViewModel, `INSUFFICIENT_HISTORY`, direction UNKNOWN, Confidence LOW |
| D identity mismatch | PASS | `null` (rejected, never guessed) |
| E ambiguous identity | PASS | DEGRADED `IDENTITY_AMBIGUOUS`, Confidence UNKNOWN |
| F missing history | PASS | `null` |
| G stale evidence | PASS | DEGRADED `STALE`, Confidence capped ≤ MEDIUM |
| H invalid evidence | PASS | DEGRADED `INVALID` (defensive gate) |
| I P2 unavailable | PASS | `p2Scope=none`, no structural degradation |
| J partial P2 | PASS | coin-local path does not disturb structural output (service boundary) |
| K P4 internal/service failure | PASS | thrown P3 read ⇒ `null` (never escapes) |
| L API P4 failure | PASS | route try/catch ⇒ `null` (API suite case C, 12/12) |

Acceptance: endpoint remains functional in every case; P4 degrades to
null/unavailable per contract; no invented fallback decision; no P4 exception
breaks the endpoint; P3 behavior unchanged.

## 7. Determinism results

- **PASS.** Repeated live calls (5×) to `getP4DecisionSupport(1)` produced
  identical semantic output (status OK, direction NEGATIVE) with
  `generatedAt` (root, explanation, and per-item) excluded.
- Same evidence snapshot + same version tuple ⇒ same semantic ViewModel.
  No byte-for-byte claim including `generatedAt`.

## 8. Identity results

- **PASS.** Valid identity tuple preserved on the ViewModel
  (`narrativeId 1 / 7D / p3-orchestrator / 1 / observed`).
- Mixed identity (latest vs history) ⇒ `null`; ambiguous identity ⇒ DEGRADED
  `IDENTITY_AMBIGUOUS` (never guessed); mismatched latest/history identity ⇒
  `null`. No silent reconciliation anywhere.

## 9. Evidence/provenance results

- **PASS.** Every `EvidenceReference` in the live ViewModel carries
  sourceLayer, sourceType, sourceId, narrativeIdentity, windowOrDate, field,
  status, interpretationRole; P3 refs carry the composite `artifactIdentity`;
  no duplicate identity keys (dedup verified).
- STALE/INVALID refs never appear in `supportingEvidence` (verified on a
  STALE drill output).
- Explanation statements map to evidence refs; no invented values (Alternative
  B display values from the read-model mapper).

## 10. P2 results

- Live DB has **0 P2 rows** ⇒ `p2Scope=none`; `provenance.p2EventRisk=false`
  on the live ViewModel. P2 scope-tier behavior is NOT historically
  validated (P4-06 verdict unchanged).
- Structural verification uses only explicit test fixtures: `P2_EVENT_RISK`
  refs carry `sourceLayer=P2`, `artifactIdentity=null`, scope `{kind,
  symbols?, riskLevel?}` (existing service/UI tests); coin-local ≠
  narrative-wide is enforced by `classifyP2` (tested).
- **No P2 Decision Engine numeric thresholds are reused** (riskScore carried
  as provenance only) — verified by code audit.
- Honest limitation: real-P2 production behavior remains unobserved.

## 11. UNKNOWN/degraded results

- **PASS.** UNKNOWN direction stays UNKNOWN (drills C/E); reason present via
  `degradation` codes; insufficient history does not fabricate conclusions;
  STALE caps Confidence ≤ MEDIUM (drill G); identity ambiguity never becomes a
  guessed identity; missing P2 does not degrade structural output (drill I);
  degraded UI renders a safe state (UI-11/14b).

## 12. Explanation results

- **PASS.** Deterministic/template-based (no LLM, no `Math.random`/`Date.now`
  in the semantic path — code audit); evidence-grounded; limits respected
  (primary ≤3, conflicting ≤2, contextual ≤2, total ≤6 — asserted on live
  output); STALE/INVALID not supporting; P2 provenance retained; no
  `humanValue` field; no "Nothing to explain"; degraded states carry real
  reasons.

## 13. API results

- **PASS.** `data.p4DecisionSupport` present when available (live: OK,
  NEGATIVE), `null` on failure (API suite B/C); existing fields unchanged
  (compat test D); HTTP behavior unchanged (200/404); serialization
  round-trip verified (test F); no P4 exception breaks the request. Route
  behavior untouched.

## 14. UI results

- **PASS.** Panel placed between P3 Intelligence and CorrelationHeatmap
  (verified in `page.tsx`); Direction/O/R/C/A, signals, explanation,
  evidence roles/status/provenance rendered from the ViewModel; UNKNOWN and
  null states handled (UI-05/11); no buy/sell/allocation/trading language
  (UI-13 scans rendered output); accessible headings + `aria-expanded`
  collapsibles (UI-14). UI components untouched.

## 15. Read-only audit

- **PASS (verified live).** Before/after the P4 service call, persisted row
  counts were unchanged: artifacts 3→3, P2 0→0, constituent snapshots 3→3.
- Code audit: the P4 path is SELECT-only (no insert/update/delete, no cache,
  no persistence, no P3/P2 mutation, no schema changes). An initial probe
  printed a false negative due to a probe-script operator-precedence bug;
  the corrected check confirms read-only behavior.

## 16. Query/runtime observations

Observed values + conditions + interpretation (no invented thresholds; no
project SLO exists):

- **Query count (code audit):** the P4 request path issues a **fixed, bounded
  set of ~10 queries per narrative** (latest artifact + leader + constituent
  count; history series + leader coins + snapshots + members; active P2 +
  constituent membership + P2 rows). Member/leader lookups use single `IN`
  queries ⇒ **no N+1 growth with series length or constituent count**. Live
  query-count instrumentation was not available; this is a code-audit
  observation, reported as such.
- **Latency (live, sandbox):** `getP4DecisionSupport(1)` — avg 1695 ms,
  min 1506 ms, max 2304 ms over 5 calls. Phase profiling shows the cost is
  DB round-trip bound (single raw count query ≈ 170 ms; `getLatestValidP3Intelligence`
  ≈ 1390 ms; `getP3IntelligenceHistory` ≈ 859 ms) — i.e., dominated by the
  sandbox DB connection/round-trips, not by P4 logic (P4 adds ~3 fixed
  queries). Interpretation: latency is an environment/DB characteristic;
  the P4 incremental cost is small and constant.
- **Repeated requests:** identical semantic output (determinism, §7).
- **Concurrent requests:** same-narrative ×4 identical; different narratives
  (1,2,3,4,6) isolated — each response's `narrativeIdentity` matches its
  request; no cross-request contamination (§17).
- **Large history/evidence:** not observable — the largest series is 3
  artifacts; no N+1 risk identified by code audit.
- **Memory/error behavior:** no anomalies observed; errors degrade to null
  without crashes.

## 17. Concurrency results

- **PASS.** `Promise.all` of 4 identical narrative-1 requests → all identical
  (modulo `generatedAt`). 5 different-narrative requests → narrative-1 OK,
  narratives 2/3/4/6 null (no artifacts) — correct, with `narrativeIdentity`
  matching per request. No shared mutable state, no evidence/identity
  leakage (service is stateless read-path).

## 18. Regression results

| Suite | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx jest src/lib/p4/validation` | 39/39 (21 harness + 18 production drills) |
| `npx jest src/lib/p4` | 129/129 |
| `npx jest src/app/api/narratives` | 12/12 |
| `npx jest src/components/__tests__/P4DecisionSupportPanel.test.tsx` | 14/14 |
| `npx jest src/components/__tests__/P3IntelligencePanel.test.tsx` | 18/18 |

## 19. Known limitations

1. **Real P2 data absent** (0 rows) — P2 production behavior unobserved;
   only fixture-based structural verification. Not a reason to invent
   evidence.
2. **Single-narrative live data** (3 artifacts) — large-history and
   multi-narrative runtime behavior unobserved.
3. **Query count not instrumented live** — code-audit estimate only.
4. **Latency figures are sandbox-DB bound** — not representative of a
   production deployment; no SLO exists; observation-only.
5. The known **16 pre-existing P3 kernel failures** remain OUT OF SCOPE; the
   repository is NOT classified globally green.

## 20. Contradiction register

**Empty.** No contradiction between the frozen contracts and observed
production behavior was discovered. (If one is found in a later run, it must
follow Master §21: record → classify → report, never silently fix.)

## 21. Severity classification

No findings. All executed checks passed; the only open items are the
limitations in §19 (environmental/data availability, informational).

## 22. Overall P4-07 verdict

**PASS WITH LIMITATIONS.**

- Production path correctness: PASS (129 P4 + 12 API + 32 UI tests + live
  call).
- Failure isolation: PASS (drills A–L).
- Determinism, identity, provenance, P2 structural handling, explanation
  integrity, API serialization, UI consumption, read-only behavior,
  concurrency: PASS.
- Limitations: no real P2 data, single-narrative live data, sandbox-bound
  latency, non-instrumented live query counts — informational, not blockers.

## 23. P4-06 status

**UNCHANGED — OPEN / DATA ACCRUAL.** P4-07 did not promote any provisional
rule, did not mark P4-06 complete, did not re-run P4-06, and did not
interpret production correctness as historical validation. The P4-06
revalidation trigger (P4-06 closure decision §12) remains un-met (2 replay
points, 1 narrative, 0 P2 rows, 0 core splits, 0 STALE/INVALID, 0 POSITIVE
samples).

## 24. Recommendation for P4-08

P4-08 (P4 Closure) may proceed when the reviewer accepts:
1. P4-07 = PASS WITH LIMITATIONS (this report);
2. P4-06 remains OPEN with the documented re-run trigger (no rule status
   change); and
3. the production caveat that P4 is additive and failure-isolated is
   recorded for operations.
P4-08 must not close P4-06 automatically; it should record the phase state
and the standing P4-06 revalidation trigger.

---
*End of P4-07 production validation report. See
P4_MASTER_SPECIFICATION.md for phase status.*
