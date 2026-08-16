# P4-07 — Production Validation / Runtime Operational Validation Specification

**Phase:** P4 — Intelligence → Decision Support
**Task:** P4-07-DOC — Production Validation Specification
**Status:** SPECIFICATION COMPLETE — IMPLEMENTATION NOT STARTED
**Authoritative phase document:** `docs/P4_Upgrade/P4_MASTER_SPECIFICATION.md`

This document is the authoritative specification for P4-07: validating the
**production** P4 Decision Support path — service, API, UI, and runtime
behavior — against the frozen contracts. It is DOCUMENT-ONLY. P4-07-IMPL
implements and executes it later.

---

## 1. Purpose and scope

P4-07 validates that the EXISTING, FROZEN P4 Decision Support implementation
behaves correctly in production runtime conditions:

- the production read path returns contract-conforming results;
- failure isolation holds (P4 can never break the narrative endpoint/page);
- determinism, identity integrity, provenance and P2-scope preservation hold;
- API serialization and UI consumption are correct;
- runtime behavior (repeated/concurrent requests, latency observation) is
  safe and non-destructive.

Scope: service (`src/lib/p4/service.ts`), assembler/mapper/interpretation/
explanation (read path), API (`GET /api/narratives/[id]`), UI
(`/narrative/[id]` + `P4DecisionSupportPanel`), and runtime characteristics.

Out of scope: P4-06 historical semantic validation (see §2), any semantic
change, new thresholds/signals/scoring, P3/P2 modification, API/UI/DB
redesign.

## 2. Relationship to P4-06

- **P4-07 is explicitly independent of P4-06.** P4-06 = historical semantic
  validation (do the PROVISIONAL rules behave sensibly over historical
  artifacts). P4-07 = production/runtime operational validation (does the
  FROZEN implementation behave correctly in production).
- **P4-06 remains OPEN with DATA ACCRUAL** (per
  `P4_06_CLOSURE_DECISION.md` — Option A). P4-07 must NOT close it, must NOT
  re-run it, and must NOT absorb its verdicts.
- All 9 P4 provisional rules remain INSUFFICIENT_EVIDENCE. **P4-07 must NOT
  attempt to replace or supplement P4-06's historical evidence.**
- Production validation ≠ historical semantic validation. P4-07 verifies
  implementation consistency and runtime safety; it cannot validate rule
  semantics historically.

## 3. Validation objectives

1. **Production-path correctness** — the production chain
   (raw/P3 read models → service → interpretation → explanation → ViewModel →
   API → UI) produces outputs conforming to the frozen contracts.
2. **Read-only behavior** — no writes, no P3/P2 mutations, no schema changes
   (§15).
3. **Failure isolation** — any P4 failure degrades to `null` without failing
   the endpoint/page (§7).
4. **Determinism** — same snapshot + versions ⇒ same semantic result
   (modulo metadata `generatedAt`) (§8).
5. **Identity integrity** — full identity enforced at the service boundary;
   mixed/ambiguous identities rejected (§9).
6. **Evidence provenance** — every evidence reference carries the frozen
   identity/provenance fields (§9).
7. **P2 provenance/scope preservation** — `sourceLayer=P2`,
   `sourceType=P2_EVENT_RISK`, scope kinds preserved; no Decision Engine
   threshold reuse (§10).
8. **UNKNOWN/degraded behavior** — all degradation codes and UNKNOWN
   propagation behave per §14 of P4-03 (§6/§8).
9. **API serialization** — `data.p4DecisionSupport` round-trips the full
   ViewModel (§12).
10. **UI consumption** — the panel renders the ViewModel verbatim with no
    frontend interpretation (§13).
11. **Runtime safety** — repeated/concurrent requests, large history, no
    N+1 blowups, no memory/error regressions (§14).

## 4. System-under-test boundary

```
Raw/P3 persisted artifacts (p3_narrative_intelligence + read services)
  → P4 service (getP4DecisionSupport: load → assemble → interpret → explain → map)
  → P4-03 interpretation (interpretP4)
  → P4-04 explanation (buildExplanation)
  → P4DecisionSupportViewModel
  → API (GET /api/narratives/[id] → data.p4DecisionSupport)
  → UI (/narrative/[id] → P4DecisionSupportPanel)
```

The system under test is the FULL production chain. P4-07 must exercise it
through the API and UI layers, not only the service in isolation.

## 5. Production-path invariants

1. P4 never writes: no DB insert/update/delete, no cache, no persistence.
2. P4 never recalculates P3 metrics; it consumes persisted read models.
3. P4 never imports the P3 kernel (`src/lib/p3/*`) — read-model types only.
4. The route performs zero P4 interpretation; all logic lives in
   `src/lib/p4/`.
5. P4 failure ⇒ `data.p4DecisionSupport = null`; existing narrative data,
   status codes and error behavior unchanged.
6. Same inputs ⇒ same outputs (semantic equality, `generatedAt` excluded).
7. Identity, evidence provenance, P2 scope are never invented or mutated.
8. The frozen value vocabulary (Direction 5-state, O/R/C/A qualitative,
   signal catalog, roles) is never transformed or extended.
9. UNKNOWN is never replaced with N/A/zero/neutral/low in the UI.
10. No buy/sell/allocation/recommendation language anywhere in P4 output.

## 6. Input/data validity matrix

| Input state | Expected P4 behavior (frozen) |
|---|---|
| VALID evidence (full identity, ≥2 artifacts, VALID current) | AVAILABLE ViewModel, direction + O/R/C/A + signals + explanation |
| MISSING current artifact | service returns `null` (NO_EVIDENCE) → API `null` |
| STALE current | DEGRADED status, `STALE` degradation code, Confidence cap MEDIUM, UNKNOWN not forced when determinable |
| INVALID current | DEGRADED `INVALID` (defensive; service boundary normally rejects) → API `null`/DEGRADED per contract |
| AMBIGUOUS evidence | DEGRADED `AMBIGUOUS` → UNKNOWN propagation |
| INSUFFICIENT_HISTORY (<2 artifacts) | DEGRADED `INSUFFICIENT_HISTORY`, Confidence LOW, UNKNOWN direction |
| Identity mismatch (narrative/window/algo/version/mode) | rejected → service `null` (IDENTITY_MISMATCH), never guessed |
| Identity ambiguity (empty identity fields) | DEGRADED `IDENTITY_AMBIGUOUS`, Confidence UNKNOWN |
| Partial P2 (single coin-local) | coin-local scope, secondary/contextual evidence only, no Risk tier change alone |
| P2 unavailable (0 rows) | `p2Scope = none`, no effect on O/R/C/A per frozen §14 |

## 7. Runtime failure-isolation requirements

- The service must never throw across its public boundary (returns `null`).
- The route must wrap the P4 call in try/catch → `p4DecisionSupport = null`.
- Under P4 throw / null / unavailable evidence / internal error, the endpoint
  must still return 200 with the existing narrative payload.
- The UI must render a compact unavailable state for `null` without hiding or
  breaking P3 panels, P3 Historical Trend, or CorrelationHeatmap.
- **Mandatory tests:** P4 throws (mock), P4 returns null, P4 unavailable
  evidence — all must keep the narrative endpoint/page functional
  (existing `p4-decision-support.test.ts` cases B/C/E cover the API level).

## 8. Determinism requirements

- Same (interpretation input, evidence snapshot, version tuple) ⇒ identical
  semantic result. Verified by repeated calls and by the existing
  determinism tests (service + validation harness).
- `generatedAt` is metadata and is EXCLUDED from semantic equality
  (P4-04-DOC §5). No byte-for-byte claim including `generatedAt`.
- No `Math.random`, no Date.now in the semantic path, no LLM, no hidden
  heuristic (verified by code audit).

## 9. Identity/provenance validation

- Full identity tuple: `(narrativeId, window, algorithmKey, algorithmVersion,
  calculationMode)` — validated at assembly (`validateIdentity`), exposed on
  the ViewModel (`narrativeIdentity`).
- `artifactIdentity` composite on P3 refs:
  `narrativeId|algorithmKey|algorithmVersion|calculationMode|window`; null
  only for P2/P4 refs.
- Every `EvidenceReference` carries sourceLayer, sourceType, sourceId,
  narrativeIdentity, windowOrDate, field, status, interpretationRole.
- No ref may be fabricated; dedup by full identity key (a reference appears
  once per item).
- Mixed-identity or ambiguous-identity inputs must be rejected/flagged, never
  silently coalesced (P4-02 §7).

## 10. P2 Event Risk validation

- Provenance: `sourceLayer="P2"`, `sourceType="P2_EVENT_RISK"`,
  `artifactIdentity=null`, scope `{kind, symbols?, riskLevel?}` preserved
  end-to-end (service → API → UI).
- Scope kinds: `coin-local` (1 constituent) ≠ `multi-coin` (≥2 constituents)
  ≠ `narrative-wide` — distinct, never conflated.
- Only narrative-wide/multi-coin HIGH/CRITICAL may raise Risk +1 tier
  (cap HIGH, never sole HIGH); coin-local is secondary/context only.
- **No P2 Decision Engine numeric thresholds are reused** (riskScore is
  carried as provenance, never as a P4 threshold input).
- 0 P2 rows ⇒ `p2Scope=none`, no O/R/C/A effect (frozen §14).

## 11. Explanation validation

- Evidence-grounded: every statement maps to evidence refs; no invented
  values/numbers formatted in the engine (Alternative B display values from
  the read-model mapper).
- Selection limits (P4-04 §4): primary ≤3, conflicting ≤2, contextual ≤2,
  total items ≤6.
- No LLM; template-based, deterministic.
- STALE/INVALID refs never support a statement (caveat/contextual only, with
  status shown).
- Degraded states produce UNKNOWN/caveat explanations that state the reason.

## 12. API validation

- `GET /api/narratives/[id]` returns `data.p4DecisionSupport` =
  `P4DecisionSupportViewModel` (additive; existing fields byte-for-byte
  unchanged).
- `null` degradation per §7 — no other fallback representation.
- Serialization: enums, nullable fields, arrays, EvidenceReference,
  ExplanationItem, historicalContext, provenance, generatedAt/asOf,
  version/attribution fields round-trip unchanged (test F exists).
- No new endpoint; no P4 logic in the route.

## 13. UI validation

- Placement: P3IntelligencePanel → P4 Decision Support → CorrelationHeatmap;
  P3HistoricalTrend not duplicated.
- Direction rendered exactly (POSITIVE/NEGATIVE/MIXED/NEUTRAL/UNKNOWN);
  O/R/C/A rendered qualitatively (LOW/MEDIUM/HIGH/UNKNOWN).
- Signals, explanation items, evidence roles/status/provenance rendered from
  the ViewModel; P2 provenance/scope visible.
- UNKNOWN/degraded states explained with the ViewModel reason; no N/A
  without explanation, no zero/neutral/low substitution.
- No buy/sell/allocation language (UI-13 test scans output).
- Accessible headings, `aria-expanded` collapsibles, non-color status.

## 14. Runtime performance / operational checks

Observation-only unless an existing project contract defines a numeric SLO
(none exists in the P4 docs today — no numeric SLO is invented here):

- **Query count / N+1 risk** — audit the P4 read path for query fan-out per
  narrative (current path: P3 latest + history queries + 1 constituents query
  + 1 P2 query). Record the count; flag if it grows with series length or
  constituent count (N+1).
- **Latency observation** — record request durations for the narrative
  endpoint with and without P4 data; report observations, not invented
  thresholds.
- **Repeated requests** — the same narrative requested N times returns
  identical semantic results (determinism) with no state change.
- **Concurrent requests** — parallel requests across narratives complete
  without errors, interleaving, or cross-narrative contamination.
- **Large evidence/history behavior** — a narrative with a long series /
  many constituents must not blow up query count or response time
  (verify no per-step queries).
- **Memory/error behavior** — no leaks on repeated requests; errors degrade
  to null; server logs capture failures without crashing.

## 15. Read-only / side-effect audit

Mandatory checks (automated where possible):

- No DB writes: audit the service/assembler/loaders for any `insert` /
  `update` / `delete` — the P4 path must be SELECT-only.
- No P3/P2 mutations: the P4 path never calls P3/P2 mutation services.
- No schema changes: no DDL, no migrations from P4.
- No cache layer, no persistence of ViewModels.
- Confirmed by code audit + read-only test (existing "never mutates P3
  inputs" test in the service suite).

## 16. Observability / diagnostics

- Must be observable: P4 availability per narrative (OK / DEGRADED / null),
  degradation codes, identity rejections (logged), service errors (logged),
  ViewModel status distribution.
- Must NOT leak: full evidence dumps, P2 event contents beyond the ViewModel
  contract, internal stack traces to API clients, sensitive narrative detail
  beyond the existing API surface.
- Logging must follow the existing `console.error` degrade pattern — no new
  logging framework.

## 17. Production safety matrix

| Risk | Mitigation | Severity if violated |
|---|---|---|
| P4 throws at runtime | service never throws + route try/catch → null | blocker if endpoint fails |
| P4 writes to DB | read-only audit + SELECT-only path | blocker |
| Identity contamination | validateIdentity + rejection | blocker |
| Future leakage | as-of SQL bounds (validation harness) / no cross-window reads in service | blocker |
| Serialization break | round-trip tests | major |
| UI crash on null | safe unavailable state + UI-11 test | major |
| Slow endpoint | query-count audit | major |
| Sensitive data leak | observability audit | major |
| Determinism break | determinism tests | major |
| Minor rendering drift | UI tests | minor |

## 18. Test levels

- **Unit** — service/assembler/mapper/interpretation/explanation (existing
  111 P4 tests stay green).
- **Integration** — service against mocked read services + real persisted
  shapes (existing service suite).
- **API** — route-level: available/null/throws/compat/P3-independence/
  serialization (existing 12 API tests).
- **UI** — panel rendering: directions, O/R/C/A, signals, explanation,
  evidence, P2 provenance, null/degraded, language scan (existing 14 UI
  tests).
- **Runtime/smoke** — live-endpoint smoke: repeated + concurrent requests,
  latency observation, query-count audit (P4-07-IMPL adds).
- **Regression** — full P4 + API + UI suites + P3 panel suite; the known 16
  P3 kernel failures remain OUT OF SCOPE (§23).

## 19. Acceptance criteria

All of:

1. All P4 unit/integration/API/UI suites pass (no new failures).
2. Runtime smoke passes: repeated requests identical (modulo generatedAt);
   concurrent requests across ≥2 narratives complete without contamination;
   query count per narrative is bounded (no N+1 by series length).
3. Failure-isolation drills pass: mocked P4 throw + null ⇒ endpoint 200 with
   `data.p4DecisionSupport = null` and P3 data intact.
4. Read-only audit passes: no writes anywhere in the P4 path.
5. Serialization round-trip passes for the full ViewModel.
6. UI renders all states (POSITIVE…UNKNOWN, null, degraded) without
   crashing; no buy/sell/allocation language.
7. Identity/provenance/P2-scope assertions hold on real responses.
8. No semantic change; no threshold/signal/scoring addition; C1–C5 intact.

## 20. Failure severity classification

- **Blocker** — endpoint fails, DB writes, identity contamination, semantic
  output violates a frozen contract, data leak.
- **Major** — serialization break, UI crash, determinism break, unbounded
  query growth, P2 scope loss.
- **Minor** — cosmetic rendering drift, suboptimal logging, non-contract
  wording.
- **Informational** — observations (latency, query counts) recorded for
  future reference.

## 21. Stop-the-line conditions

STOP P4-07-IMPL and report immediately when any of:

1. A P4 failure fails the narrative endpoint/page in a real request.
2. The P4 path performs a DB write or P3/P2 mutation.
3. Identity/provenance is contaminated or fabricated.
4. Determinism breaks on identical inputs.
5. A semantic contradiction with a frozen contract is discovered (→ §29).
6. Any forbidden file (P3/P2/API/UI/DB/schema/migrations) is modified by
   P4-07-IMPL.

## 22. Rollback / disable behavior

- P4 is additive and failure-isolated: if P4-07 discovers a production
  problem, the response field can be nulled without code change only if the
  service degrades; otherwise rollback = revert the P4 integration commit.
- **The existing narrative endpoint/page must never depend on P4** — a P4
  disable (route returns null) must leave the page fully functional (P3
  panels, trend, correlation intact).
- No feature flag is required by contract; the null-degradation IS the
  disable mechanism.

## 23. Known P3 caveat

- **16 pre-existing P3 kernel test failures remain OUT OF SCOPE** — not
  caused by P4, not to be fixed by P4-07-IMPL, not to be used as an excuse
  to change P3.
- Do NOT classify the repository as globally green; report P4-scope suites
  green with the P3 caveat explicitly stated.

## 24. Relationship to provisional rules

- P4-07 MAY verify implementation consistency (does the running system
  implement the frozen rules as specified) — this is a code/contract check.
- P4-07 MAY NOT promote historical validity — it produces no historical
  evidence; rule statuses remain exactly as P4-06 left them
  (INSUFFICIENT_EVIDENCE ×9).

## 25. P4-06 revalidation trigger

P4-07 must preserve (not consume) the re-run trigger from
`P4_06_CLOSURE_DECISION.md` §12: re-run the P4-06B harness when any of
(a) ≥10 eligible replay points across ≥3 narratives; (b) any P2 event-risk
rows; (c) a core-split conflict sample; (d) a STALE/INVALID artifact;
(e) a POSITIVE-direction replay point. P4-07 may REPORT that the trigger is
still un-met; it must not re-run P4-06.

## 26. Production validation report format

`docs/P4_Upgrade/P4_07_PRODUCTION_VALIDATION_REPORT.md` (P4-07-IMPL output):

1. Executive verdict
2. System-under-test scope
3. Environment / dataset observed
4. Test execution results (unit/integration/API/UI/runtime/regression)
5. Failure-isolation drills
6. Determinism verification
7. Identity/provenance audit
8. P2 validation
9. Read-only audit
10. Runtime observations (query counts, latency, concurrency)
11. UI verification
12. Safety matrix results
13. Severity-classified findings
14. Contradictions (none expected; protocol §29)
15. P4-06 trigger status (reported, not consumed)
16. Recommendation

## 27. Promotion/closure policy

- P4-07-IMPL NEVER promotes or freezes a provisional rule; it never changes
  P4-06 status; it never closes P4-06.
- P4-07's own completion = acceptance criteria (§19) met with no blocker,
  documented in the Master checkpoint (P4-07-IMPL COMPLETE — production
  validation executed).
- Any rule-status change remains P4-06's decision, per its closure criteria.

## 28. Master update requirements

- P4-07-DOC: add the roadmap/checkpoint entry for P4-07-DOC
  (specification complete) ONLY if the existing Master structure permits
  documentation checkpoints (it does — §19A–§19H pattern). No semantic
  section is modified.
- Do not mark P4-07 complete (that is P4-07-IMPL's checkpoint after
  execution).
- Keep P4-06 row unchanged (OPEN — data accrual).

## 29. Contradiction protocol (Master §21)

If P4-07 discovers a semantic conflict between the frozen contracts and the
running system:

1. STOP execution.
2. Record the contradiction with exact source clauses (doc + section + line)
   and observed behavior.
3. Classify: implementation / spec / example / data contradiction.
4. Assess impact and affected tasks.
5. Report — do NOT silently fix, do NOT adapt code to observations, do NOT
   rewrite the spec.

## 30. Implementation boundary for P4-07-IMPL

MAY modify/create:
- P4 runtime/smoke validation code under `src/lib/p4/validation/` (or a
  sibling P4-07 module);
- P4-07 tests (runtime/smoke, API, UI additions);
- P4-07 report + Master checkpoint docs.

MUST NOT modify:
- `src/lib/p3/**`, P2 kernel, `src/lib/p4/interpretation.ts`,
  `src/lib/p4/explanation/**`, `src/lib/p4/service.ts` (production path),
  API route behavior (beyond existing degrade pattern), UI components,
  DB schema, migrations, `vite.config.ts`, package-lock, tsbuildinfo.

If an existing production service outside `src/lib/p4/` must be touched:
STOP and report (adapter inside `src/lib/p4/` preferred).

## 31. Verification checklist

- [ ] Full P4 unit/integration suite green (111/111)
- [ ] API suite green (12/12)
- [ ] UI suite green (14/14)
- [ ] Runtime smoke: repeated + concurrent + query-count audit
- [ ] Failure-isolation drills pass
- [ ] Read-only audit passes
- [ ] Determinism verified (generatedAt excluded)
- [ ] Identity/provenance/P2-scope assertions pass on real responses
- [ ] No forbidden files changed (git audit)
- [ ] No semantic change; C1–C5 intact
- [ ] P4-06 trigger reported, not consumed; P4-06 stays OPEN
- [ ] Report written; Master checkpoint added (P4-07-IMPL)

## 32. Exact next task

**P4-07-IMPL** — implement the P4-07 runtime/operational validation:
execute the failure-isolation drills, determinism/repeated-request checks,
concurrent-request and query-count/latency observations against the live
endpoint, re-run all P4/API/UI suites, perform the read-only and
identity/provenance/P2 audits, and produce
`docs/P4_Upgrade/P4_07_PRODUCTION_VALIDATION_REPORT.md` + the Master
checkpoint.

---

## Traceability matrix

Requirement → source contract → actual implementation → validation method →
acceptance criterion.

| # | Requirement | Source contract | Actual implementation | Validation method | Acceptance criterion |
|---|---|---|---|---|---|
| T1 | Production-path correctness (service) | P4-02 §8; P4-03 §2–14 | `src/lib/p4/service.ts`, `assembler.ts`, `interpretation.ts` | unit + integration suites | 111/111 P4 tests green |
| T2 | Failure isolation (service) | P4-02 §9/§10 | service catch → null; route try/catch → null | API tests B/C/E | endpoint 200, `p4DecisionSupport=null`, P3 intact |
| T3 | Determinism | P4-04-DOC §5; P4-06B §8 | pure engines; `generatedAt` metadata-only | determinism tests + repeated-request smoke | identical modulo generatedAt |
| T4 | Identity integrity | P4-02 §7 | `validateIdentity`, `artifactIdentityOf`, `assertSameIdentity` | unit + identity tests | mixed/ambiguous rejected; no fabrication |
| T5 | Evidence provenance | P4-02 §5 | `P4EvidenceReference` full fields | service + UI tests (UI-09) | refs carry layer/type/id/field/status/role |
| T6 | P2 provenance/scope | P4-03 §10; P4-01A Q5 | `mapP2Event`, `classifyP2`, `interpretRisk` | service + UI tests (UI-10) | P2_EVENT_RISK + scope preserved; coin-local ≠ narrative-wide |
| T7 | No P2 threshold reuse | P4-03 §10 (frozen) | riskScore carried as provenance only | code audit + tests | no threshold comparison on riskScore in P4 |
| T8 | UNKNOWN/degraded behavior | P4-03 §14 | 8 degradation gates in `interpretP4` | unit + UI tests (UI-05/11/14b) | codes correct; UNKNOWN never replaced |
| T9 | API serialization | P4-02 §10 | route `data.p4DecisionSupport` | API test F | full round-trip `toStrictEqual` |
| T10 | UI placement + values | P4-05C §2/§4/§5 | `page.tsx` + `P4DecisionSupportPanel` | UI tests (UI-01..04,06) | placement correct; frozen values verbatim |
| T11 | No buy/sell language | P4-05C §17 | panel templates | UI test UI-13 | scan clean |
| T12 | Read-only | P4-02 §8 | SELECT-only path | code audit + service read-only test | no writes/mutations/schema |
| T13 | Query-count boundedness | §14 (this spec) | 1 P3 latest + 1 history + 1 constituents + 1 P2 per narrative | runtime smoke audit | no N+1 by series length/constituents |
| T14 | Concurrent isolation | §14 (this spec) | stateless read path | concurrent smoke | no cross-narrative contamination |
| T15 | Null UI safety | P4-05C §10 | `viewModel ?? null` prop | UI test UI-11 | page renders; P3 panels intact |
| T16 | P4-06 separation | P4-06 closure §12 | trigger preserved in docs only | report check | P4-06 stays OPEN; trigger not consumed |
| T17 | No semantic change | Master §21 | untouched engines | git diff audit | no P4-03/P4-04 change |

---

*End of P4-07 specification. See P4_MASTER_SPECIFICATION.md for phase
status. P4-07-IMPL may proceed after this spec is accepted.*
