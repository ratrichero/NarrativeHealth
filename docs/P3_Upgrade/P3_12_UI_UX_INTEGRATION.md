# P3-12 — P3 Intelligence UI/UX Integration

## Status: PASS — P3 Intelligence is visible in the product UI

**Execution date:** 2026-08-14
**Integration target:** Narrative Detail page (`/narrative/[id]`) for the first VALID P3 artifact (AI narrative, 7D window ending 2026-08-11T00:00:00Z, observed mode, regime NEUTRAL, rotation ACCELERATING)

---

## Executive Summary

P3-12 integrated the persisted P3 Intelligence layer into the existing product UI with a **read-only** path. The existing Narrative Detail API (`GET /api/narratives/[id]`) was extended to join the latest VALID P3 artifact, normalized into a frontend-safe view model (`P3IntelligenceViewModel`), and rendered on the Narrative Detail page in a dedicated **P3 Intelligence** section using the existing design language (Card / Badge / slate + cyan).

**Result:** P3-12 PASS — the first P3 artifact (NEUTRAL / ACCELERATING / 7D / 11 Aug 2026 / VALID) is visibly exposed in the product UI with zero production mutations and zero P3 semantic changes.

---

## PART A — Existing UI Architecture Audit

### A.1 Pages

| Page | Route | Displays |
|---|---|---|
| Dashboard | `/` (`src/app/page.tsx`) | Narrative cards (NarrativeCard), overall health summary |
| Narrative Detail | `/narrative/[id]` (`src/app/narrative/[id]/page.tsx`) | Narrative health score, 30-day health history chart, P3 Intelligence (new), correlation heatmap, coin ranking table |

### A.2 Findings

1. **Which page displays Narrative Health?** The Dashboard (`/`) displays per-narrative health via `NarrativeCard`. The Narrative Detail page (`/narrative/[id]`) displays the full narrative-level view: health score, status badge, score change, confidence badge, health history chart, and constituent coins.
2. **Which page displays narrative-level metrics?** The Narrative Detail page. It already aggregates narrative health, health history, correlation data, and constituent coin health/signals.
3. **Best home for P3 Intelligence?** The **Narrative Detail page** (`/narrative/[id]`). P3 intelligence is a per-narrative, per-window artifact; the detail page is the natural surface and the task's recommended first surface.
4. **How does the frontend fetch narrative data?** Client-side via React Query (`useQuery` with `queryKey ["narrative", id]`) calling `GET /api/narratives/[id]` (see `src/app/narrative/[id]/page.tsx`).
5. **Is there an existing narrative detail endpoint?** Yes — `GET /api/narratives/[id]` (`src/app/api/narratives/[id]/route.ts`). Reused; no new API namespace created.
6. **Is there an existing dashboard API?** Yes — `GET /api/dashboard` (`src/app/api/dashboard/route.ts`). Not modified; P3 belongs on the detail surface.
7. **Where should P3 data be joined?** Into the existing `GET /api/narratives/[id]` response as a new `p3Intelligence` field on `data`. This keeps the client fetch path unchanged (one query, one render pass).
8. **Existing TypeScript types/models for P3?** None in the frontend read path. P3 kernel types live under `src/lib/p3/` (calculation-side, e.g. `P3CalculationResult`, `P3MetricResult`). A new frontend-safe read model was required.
9. **Existing UI patterns:** Card (`src/components/ui/Card.tsx`), Badge (`src/components/ui/Badge.tsx`), HealthBadge, ConfidenceBadge, chips/borders with slate-800 + cyan accents, lucide-react icons, tabular-nums for numbers, `space-y-6` layout. All reused.
10. **Minimum new components:** **One** — `P3IntelligencePanel` (with small internal sub-components). No parallel dashboard, no new page, no new route namespace.

### A.3 Data Flow (current)

```
PostgreSQL (p3_narrative_intelligence, coins, p3_constituent_snapshots)
  ↓  Drizzle ORM (read-only selects)
src/lib/services/p3-intelligence.service.ts  (new — read service, view-model transform)
  ↓
GET /api/narratives/[id]  (existing route, joined field: data.p3Intelligence)
  ↓
React Query  (useQuery ["narrative", id])
  ↓
P3IntelligencePanel  (new component, mounted on /narrative/[id])
```

---

## PART B — P3 Read Contract

### B.1 View Model

Defined in `src/lib/types/p3-intelligence.ts`:

```ts
P3IntelligenceViewModel {
  artifactId, narrativeId,
  window,            // "7D"  (authoritative, from persisted provenance)
  windowEnd,         // ISO UTC, e.g. "2026-08-11T00:00:00.000Z"
  windowEndLabel,    // "11 Aug 2026" (UTC)
  calculationMode,   // "observed"
  algorithmKey, algorithmVersion,
  availabilityState, // "VALID" | "MISSING" | ... (P3 availability union)

  regime:  P3ClassificationViewModel,   // { availabilityState, classification, display }
  rotation:P3RotationViewModel,         // { availabilityState, classification, score, scoreDisplay }
  breadth: P3StageViewModel,            // { availabilityState, value, display }
  momentum:P3StageViewModel,
  relativeStrength: P3StageViewModel,
  leadership: P3LeadershipViewModel,    // { availabilityState, coinId, symbol, score, scoreDisplay }
  constituents: P3ConstituentsViewModel // { count, availabilityState }
}
```

### B.2 Read-Only Guarantee

- The view model is built **exclusively** from persisted rows (`p3_narrative_intelligence`, `coins`, `p3_constituent_snapshots`).
- **No P3 calculation function is called** from the read path. `src/lib/p3/index.ts` kernel entry points (`calculateP3...`) are not imported by the service.
- No writes, no recalculation, no artifact creation.

---

## PART C — API / Service Layer

### C.1 Implementation

- **Service:** `src/lib/services/p3-intelligence.service.ts`
  - `getLatestValidP3Intelligence(narrativeId)` — selects the latest `availabilityState = 'VALID'` artifact ordered by `windowEnd DESC, id DESC`, joins leader symbol (`coins`) and member count (`p3_constituent_snapshots`), returns the view model or `null`.
  - `toP3IntelligenceViewModel(source)` — pure transform (unit-tested, no DB).
  - Formatting helpers: `formatP3Ratio`, `formatP3Momentum`, `formatP3SignedRatio`, `formatP3Score`, `p3WindowLabel`, `p3WindowEndLabel`, `normalizeAvailabilityState`.
  - `inferP3Window` — authoritative window from persisted `provenance.context.window` (e.g. `"7D"`); fallback to the longest persisted momentum horizon; last resort to the period span.
- **Route:** `GET /api/narratives/[id]` now includes `data.p3Intelligence`. The join is wrapped in try/catch so a P3 read failure can never take down the narrative page (degrades to `null`).
- **No new API namespace** — the existing narrative detail endpoint is the read path.

### C.2 Verified Response (live API, artifact #1)

```json
{
  "artifactId": 1, "narrativeId": 1,
  "window": "7D",
  "windowEnd": "2026-08-11T00:00:00.000Z",
  "windowEndLabel": "11 Aug 2026",
  "calculationMode": "observed",
  "algorithmKey": "p3-orchestrator", "algorithmVersion": "1",
  "availabilityState": "VALID",
  "regime":  { "availabilityState": "VALID", "classification": "NEUTRAL",      "display": "NEUTRAL" },
  "rotation":{ "availabilityState": "VALID", "classification": "ACCELERATING", "score": 75.19, "scoreDisplay": "75.19" },
  "breadth": { "availabilityState": "VALID", "value": 0.142857, "display": "0.143" },
  "momentum":{ "availabilityState": "VALID", "value": 14.03,    "display": "+14.03" },
  "relativeStrength": { "availabilityState": "VALID", "value": -0.011188, "display": "-0.011" },
  "leadership": { "availabilityState": "VALID", "coinId": 10, "symbol": "BLUAI", "score": 89.29, "scoreDisplay": "89.29" },
  "constituents": { "count": 7, "availabilityState": "VALID" }
}
```

---

## PART D — UI MVP

### D.1 Surface

A dedicated **P3 Intelligence** Card on the Narrative Detail page (`src/app/narrative/[id]/page.tsx`), rendered between the Health Score History chart and the Correlation Matrix:

```
┌──────────────────────────────────────────────────────────────┐
│ 🧠 P3 INTELLIGENCE                  [AI · 7D · 11 Aug 2026]  │
│                                                              │
│  Regime     [ NEUTRAL ]       Rotation   [ ACCELERATING ] 75.19│
│                                                              │
│  Breadth            Momentum          Rel. Strength          │
│  [Valid] 0.143      [Valid] +14.03    [Valid] -0.011         │
│                                                              │
│  Leadership   BLUAI · 89.29   [Valid]                        │
│                                                              │
│  ▸ Why? — window, mode & stage validity                      │
└──────────────────────────────────────────────────────────────┘
```

### D.2 Design Language

Follows the existing project language exactly: `Card`/`CardHeader`/`CardContent`/`CardTitle`, `Badge` variants, slate-800/30 tiles with slate-800 borders, cyan accents (`text-cyan-400`), lucide icons (`BrainCircuit`, `ChevronDown`, `ChevronRight`), `tabular-nums` for numeric values, responsive `grid` (`grid-cols-1 md:grid-cols-2`, `sm:grid-cols-3`). No new visual system introduced.

### D.3 Progressive Disclosure

Stage details (calculation window, mode, algorithm, availability, constituent count, per-stage validity badges) are collapsed behind a **"Why? — window, mode & stage validity"** disclosure, satisfying PART H (lightweight provenance) without a full provenance explorer.

---

## PART E — Regime / Rotation UI Semantics

- **NEUTRAL** is rendered from the persisted value as a real classification chip (slate-toned, distinct styling), labeled **NEUTRAL**. It is **never** rendered as N/A, Unknown, Missing, or Not Applicable. Regression test: `regime NEUTRAL is a valid classification, never N/A`.
- **ACCELERATING** is rendered as a real rotation chip (cyan-toned) with its score. Regression test: `rotation ACCELERATING is preserved, never treated as missing`.
- Values are **not reinterpreted**: the persisted classification string is displayed verbatim.
- **NOT_APPLICABLE** is a distinct *availability state*, rendered via the state badge ("N/A") only when the artifact/stage is genuinely not applicable — and it can never display "NEUTRAL". Regression test: `NOT_APPLICABLE is distinct from NEUTRAL`.

---

## PART F — Availability States

The UI distinguishes all persisted availability states via a badge:

| State | Badge label | Badge variant |
|---|---|---|
| VALID | Valid | success |
| MISSING | Missing | neutral |
| INVALID | Invalid | danger |
| STALE | Stale | warning |
| INSUFFICIENT_HISTORY | Insufficient data | warning |
| NOT_APPLICABLE | N/A | neutral |
| AMBIGUOUS | Ambiguous | warning |

Behavior:

- When the artifact `availabilityState = VALID` but an individual stage is absent, that stage shows its own badge + `—` display (e.g. missing momentum → "Missing" + "—") while remaining VALID stages still render. Test: `handles incomplete stages gracefully`.
- When the artifact itself is not VALID (e.g. NOT_APPLICABLE), all stage values degrade to `null`/`—` with the artifact-level state propagated to each stage.
- When no artifact exists at all, the panel shows a visible placeholder ("No P3 intelligence available for this narrative yet.") rather than hiding the section.
- No new availability semantics were invented; the exact `P3AvailabilityState` union from `src/lib/p3/availability.ts` is used.

---

## PART G — Historical Window

- The header chip always shows **narrative · window · window-end** (e.g. `AI · 7D · 11 Aug 2026`).
- The window is the authoritative persisted value read from `provenance.context.window` (fallback: longest persisted momentum horizon, then period span).
- The window end label is computed from UTC date parts (`11 Aug 2026`) so it is stable regardless of server timezone / driver parsing of the `timestamp without tz` column.
- P3 data is never presented as "current" without its calculation window — the window is always visible, and the "Why?" disclosure repeats window + windowEnd.

---

## PART H — Provenance / Explainability

Lightweight, per PART H: the "Why? — window, mode & stage validity" disclosure exposes:

- Calculation window + window end
- Calculation mode (`observed`)
- Algorithm key/version (`p3-orchestrator/1`)
- Availability state
- Constituent member count
- Per-stage validity badges (Regime / Rotation / Breadth / Momentum / Rel. Strength / Leadership)

A full provenance explorer (stage input manifests, correction ledger links, member-level detail) is deferred to the P3 UI backlog (see PART N).

---

## PART I — Responsive / UX

- **Desktop:** full 2-column regime/rotation row + 3-column stage row.
- **Tablet/mobile:** grids collapse to 1 column (`md:grid-cols-2`, `sm:grid-cols-3` breakpoints); header chip wraps; disclosure collapses.
- The P3 section is one Card in the existing page stack — it does not dominate the dashboard.
- Display priority matches PART I: Regime → Rotation → Momentum/Breadth/Relative Strength → Leadership → provenance.

---

## PART J — Testing

### J.1 Test files added

| File | Coverage |
|---|---|
| `src/lib/p3/__tests__/p3-intelligence-service.test.ts` | Formatting helpers, window inference (provenance-first, momentum fallback), view-model transform, **NEUTRAL != NOT_APPLICABLE**, **ACCELERATING != missing**, missing-stage handling, window-matched metric selection, read service with mocked db (returns latest VALID / returns null) |
| `src/components/__tests__/P3IntelligencePanel.test.tsx` | SSR rendering of VALID artifact (NEUTRAL, ACCELERATING, 7D · 11 Aug 2026, metrics, BLUAI leader), NEUTRAL never N/A/Missing, NOT_APPLICABLE renders N/A and never NEUTRAL, ACCELERATING vs missing rotation, incomplete-stage degradation, no-artifact placeholder |

`jest.config.js` `testMatch` widened from `**/__tests__/**/*.test.ts` to `**/__tests__/**/*.test.{ts,tsx}` so the new `.tsx` component test runs.

### J.2 Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ PASS (0 errors) |
| `git diff --check` | ✅ PASS |
| New test suites (23 tests) | ✅ 23/23 PASS |
| Full suite | 382 passed / 12 failed — see J.3 |

### J.3 Pre-existing failures (not caused by P3-12)

The full suite reports 12 failures across 6 suites, all in P3-10 kernel test files **untouched by this task**. Verified by running the same suites in a detached worktree at `HEAD` (551196a) — identical failures occur without any P3-12 changes:

| Suite | Failure |
|---|---|
| `rotation.test.ts` (6) | "Relative Strength normalization" expects min/max mapping (0→100) but implementation returns center-based values (~50). Pre-existing test/impl contract mismatch from P3-10A. |
| `breadth.test.ts` (1) | Expects `bullishRatio: 1/3` when `availabilityState: MISSING`; implementation returns `null`. Pre-existing (P3-04 kernel). |
| `preparation.test.ts` (1) | Snapshot identity provenance expected as string, received object. Pre-existing. |
| `persistence.test.ts` (2) | Test mocks lack `tx.insert(...).onConflictDoUpdate`. Pre-existing mock gap. |
| `membership.test.ts` (1) | Mock `db.select is not a function`. Pre-existing mock gap. |
| `p3-10e-29-remediation.test.ts` (1) | Pre-existing. |

Per PART K these P3 kernel semantics are **not modified** in P3-12; the failures are documented here and left for the P3 kernel owner.

---

## PART K — No P3 Semantic Changes

STRICT RULE compliance — the following were **not modified**:

- P3-04 breadth kernel, P3-05 momentum, P3-06 relative strength, P3-07 leadership, P3-08 regime classification, P3-09 rotation calculation
- Thresholds, regime/rotation definitions, persistence gate, membership resolver, correction ledger, immutable historical artifacts
- `src/lib/p3/regime.ts`, `src/lib/p3/rotation.ts`, `src/lib/p3/breadth.ts`, `src/lib/p3/persistence.ts`, `src/lib/p3/membership.ts`, `src/lib/p3/preparation.ts` — all untouched (verified via `git status`)

No backend contract problems were encountered; the persisted data read cleanly through the normal Drizzle layer (matching P3-11's A.2 verification).

---

## PART L — Production Safety

Production mutations: **0**.

- No artifacts created, no authoritative calculations executed, no production P3 history modified, no membership changes, no P0–P2 data touched.
- The only database access in this task is read-only `SELECT` (service) and the pre-existing read/write behavior of `GET/PUT/DELETE /api/narratives/[id]` (untouched semantics; only a read-only P3 join added).
- All changes are additive: 1 new service, 1 new type module, 1 new component, 2 new test files, and small additions to the existing narrative route/page.

---

## PART M — Deliverables

| Item | Location |
|---|---|
| P3 read service | `src/lib/services/p3-intelligence.service.ts` (new) |
| P3 read model types | `src/lib/types/p3-intelligence.ts` (new), re-exported from `src/types/index.ts` |
| P3 Intelligence UI | `src/components/P3IntelligencePanel.tsx` (new) |
| Narrative route join | `src/app/api/narratives/[id]/route.ts` (additive) |
| Narrative page mount | `src/app/narrative/[id]/page.tsx` (additive) |
| Service/view-model tests | `src/lib/p3/__tests__/p3-intelligence-service.test.ts` (new) |
| UI rendering tests | `src/components/__tests__/P3IntelligencePanel.test.tsx` (new) |
| Test config | `jest.config.js` (testMatch widened for `.tsx`) |
| This document | `docs/P3_Upgrade/P3_12_UI_UX_INTEGRATION.md` |

### M.1 Screenshots / visual verification

Project tooling in this environment is a headless preview; browser screenshots are not captured here. Live verification performed instead:

- `GET /api/narratives/1` → `data.p3Intelligence` present with exact values from PART C.2 (NEUTRAL, ACCELERATING, 7D, 11 Aug 2026, VALID, BLUAI 89.29, 7 constituents).
- `GET /api/narratives/4` (FAVORITE, no P3 artifact) → `p3Intelligence: null` (graceful).
- `GET /narrative/1` → HTTP 200; page is client-rendered (React Query) so the panel mounts after hydration; rendering verified by the SSR component tests in J.1.
- Preview URL: `https://3000-af754ec1-a476-4c0d-b969-a457194ce95c.daytonaproxy01.net` (port 3000).

---

## PART N — Future P3 UI Backlog

1. **P3 on Dashboard cards** — surface regime/rotation as compact chips on `NarrativeCard` for at-a-glance scanning.
2. **Full provenance explorer** — stage input manifests, correction ledger entries, member-level inclusion reasons, availability reasons.
3. **Historical window selector** — choose among persisted windowEnds (and windows) to compare P3 states over time.
4. **P3 history chart** — regime/rotation/score over successive windows.
5. **Leadership detail surface** — top-N leaders with scores and per-member health drill-down (`/coin/[id]` already exists as a destination).
6. **Constituent membership visualization** — snapshot diff views for membership changes across windows.
7. **P3 admin console section** — browse artifacts/versions/validity states (extends the existing `/admin` console).

---

## SUCCESS CRITERIA

- [x] Existing UI architecture audited
- [x] Correct existing dashboard/detail surface identified (Narrative Detail)
- [x] P3 read path implemented (reuses `GET /api/narratives/[id]`)
- [x] No P3 recalculation on read (read-only service; kernel never imported)
- [x] P3 view model implemented (`P3IntelligenceViewModel`)
- [x] P3 Intelligence visibly appears in UI (dedicated panel on `/narrative/[id]`)
- [x] Regime = NEUTRAL displayed correctly (chip, never N/A/Missing)
- [x] Rotation = ACCELERATING displayed correctly (chip + score)
- [x] 7D / windowEnd displayed (header chip + provenance disclosure)
- [x] Breadth displayed (0.143)
- [x] Momentum displayed (+14.03)
- [x] Relative Strength displayed (-0.011)
- [x] Leadership displayed (BLUAI · 89.29)
- [x] VALID state displayed correctly (Valid badge)
- [x] Incomplete states handled safely (per-stage badges + `—`, placeholder when absent)
- [x] API/read tests PASS (service tests, mocked db)
- [x] UI tests PASS (panel SSR rendering incl. NEUTRAL/NOT_APPLICABLE/ACCELERATING/missing)
- [x] Typecheck PASS (`npx tsc --noEmit`)
- [x] `git diff --check` PASS
- [x] Production mutations = 0
- [x] P3 calculation semantics unchanged (kernel files untouched; pre-existing kernel test failures documented, not "fixed" per PART K)

---

# P3-12 STATUS: PASS

P3 Intelligence is now visible in the product UI.
