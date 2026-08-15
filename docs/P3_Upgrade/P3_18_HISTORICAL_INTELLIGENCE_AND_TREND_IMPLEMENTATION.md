# P3-18 — Historical Intelligence & Trend Implementation

```
TASK
P3-18 — Historical Intelligence & Trend Implementation (read-path/service/API/UI)

STATUS
PASS — implemented, tested, verified against the 3 VALID production artifacts

DOCUMENT
docs/P3_Upgrade/P3_18_HISTORICAL_INTELLIGENCE_AND_TREND_IMPLEMENTATION.md

VERDICT
PASS — no STOP conditions triggered; no P3 kernel/semantics change; 0 mutations
```

==================================================
1. CONTRACT TRACEABILITY (frozen inputs)
==================================================

| Source | Adopted |
|---|---|
| P3-14 Part C — identity contract | narrativeId + window + algorithmKey + algorithmVersion + calculationMode; order by windowEnd ASC; "previous" = same identity, max windowEnd < current |
| P3-14 Part D.1 — trend state model | IMPROVING / DETERIORATING / STABLE / TRANSITION / UNKNOWN definitions |
| P3-14 Part D.2 — epsilon thresholds | momentum ±1.0, rotation score ±5.0, breadth ±0.05, relative strength ±0.01, leader score ±5.0 (adopted verbatim; no new threshold invented) |
| P3-14 Part D.3 — semantics rules | NEUTRAL→NEUTRAL = STABLE; NOT_APPLICABLE → UNKNOWN (never STABLE); any unavailable endpoint → UNKNOWN (never fabricated); transitions are string comparisons, deltas are numeric |
| P3-14 Part F.2 — API shape | extend `GET /api/narratives/[id]` with `data.p3IntelligenceHistory`; no new namespace; UI → service → DB; no kernel import |
| P3-14 Part E — UI | progressive disclosure below the current P3 Intelligence panel; no new dashboard/page/route |
| P3-14 Part G.2 — sufficiency | requiredMinimum = 2 same-identity artifacts; 3 = confirmed direction; 5 = recommended before prominent "trend" claims |

**Verification dataset** (production, unchanged):

```
id=1  windowEnd=2026-08-11  VALID  NEUTRAL    / ACCELERATING 75.192711  breadth 0.142857  mom7d +14.030000  rs7d -0.011188  leader 10 (BLUAI) 89.29
id=9  windowEnd=2026-08-13  VALID  WEAKENING  / INFLOW       61.190795  breadth 0.142857  mom7d  -0.984287  rs7d +0.047994  leader 22 (TRUTH) 61.35
id=10 windowEnd=2026-08-15  VALID  WEAKENING  / STABLE       49.892445  breadth 0.000000  mom7d  -2.402857  rs7d +0.040372  leader 12 (PROMPT) 55.98
```

All three share identity `narrativeId=1 · 7D · p3-orchestrator/1 · observed`.

==================================================
2. FILES
==================================================

| File | Change |
|---|---|
| `src/lib/types/p3-intelligence-history.ts` | **NEW** — `P3IntelligenceHistoryViewModel`, `P3TrendStep`, `P3MetricTrend`, `P3ClassificationTrend`, `P3LeadershipTrend`, `P3ConstituentTrend`, `P3TrendState` |
| `src/lib/services/p3-intelligence-history.service.ts` | **NEW** — read-only service + pure trend functions; no `@/lib/p3/*` import |
| `src/app/api/narratives/[id]/route.ts` | Added `data.p3IntelligenceHistory` (try/catch → null degradation) |
| `src/types/index.ts` | Added `p3IntelligenceHistory` to `NarrativeDetail` |
| `src/components/P3HistoricalTrend.tsx` | **NEW** — progressive-disclosure Historical Trend section |
| `src/components/P3IntelligencePanel.tsx` | Renders `P3HistoricalTrend`; exported `classificationChipClass` |
| `src/app/narrative/[id]/page.tsx` | Passes `history` to the panel |
| `src/lib/p3/__tests__/p3-intelligence-history.test.ts` | **NEW** — 27 tests (pure + service + kernel isolation) |
| `src/components/__tests__/P3IntelligencePanel.test.tsx` | +4 history rendering tests |
| `src/app/api/narratives/__tests__/route-resilience.test.ts` | +2 history degradation tests |

Read path: `UI → /api/narratives/[id] → getP3IntelligenceHistory → DB (SELECT only)`.
The service reuses the P3-12 view-model transform (`toP3IntelligenceViewModel`) so
series entries are byte-consistent with the current-intelligence panel.

==================================================
3. TREND SEMANTICS IMPLEMENTATION
==================================================

### 3.1 Epsilons (P3-14 D.2 — adopted verbatim)

```ts
P3_TREND_EPSILONS = {
  momentum: 1.0,          // percentage points, window-matched
  rotationScore: 5.0,     // 0–100 scale
  breadth: 0.05,
  relativeStrength: 0.01,
  leaderScore: 5.0,
}
```

### 3.2 Directional mappings (no new semantics)

- **Regime rank** — implementation mapping over the canonical P3-08 regime
  list, derived from the frozen D.1 examples (NEUTRAL→EMERGING/STRONG improves;
  regime weakening deteriorates):
  `DEAD < WEAKENING < NEUTRAL < MATURE < EMERGING < STRONG`
  Any unranked value → **UNKNOWN** (never guessed).
- **Rotation rank** — directly from the P3-09 threshold ordering
  (`acceleratingMin > inflowMin > stableMin > deceleratingMin`):
  `OUTFLOW < DECELERATING < STABLE < INFLOW < ACCELERATING`.
- Same classification → **STABLE** (covers NEUTRAL→NEUTRAL = STABLE).
- Classification change + direction → IMPROVING / DETERIORATING.
- Any unavailable / unranked endpoint → **UNKNOWN**.

### 3.3 Per-metric rules

| Metric | Rule |
|---|---|
| regime / rotation | `classificationTransition` (string + rank) |
| rotation score / breadth / momentum / rel. strength | `trendFromDelta` (numeric ± ε) |
| leadership | `changed = leaderCoinId differs`; same leader → score-delta ε rule; leader change → **TRANSITION** (cross-coin score direction not defined by contract); `scoreDelta` always reported numerically |
| constituents | set-diff of persisted `p3_constituent_snapshot_members` coin ids; change → TRANSITION, unchanged → STABLE, unavailable → UNKNOWN |

### 3.4 Aggregates (over the whole series)

- Any step UNKNOWN → metric **UNKNOWN** (D.3: never fabricate).
- Mixed improving + deteriorating → **TRANSITION**.
- Single direction wins; all STABLE → STABLE; all TRANSITION → TRANSITION.
- **Overall** = regime + rotation + momentum (D.1 definition).

### 3.5 Data sufficiency

`requiredMinimum = 2` (first comparability point). With 1 artifact the view model
is still returned with `steps: []`, all trends `UNKNOWN`, and
`dataSufficiency.sufficient = false` (UI shows the insufficient-history message).
With 0 artifacts the service returns `null` (API field `null`, page unaffected).

==================================================
4. PRODUCTION VERIFICATION (read-only, real DB)
==================================================

Ran `getP3IntelligenceHistory(1)` directly against production (the exact code
path the route calls):

```
NARRATIVE 1 — identity: {narrativeId:1, window:"7D", algorithmKey:"p3-orchestrator", algorithmVersion:"1", calculationMode:"observed"}
  series: 11 Aug 2026 NEUTRAL/ACCELERATING 75.19 → 13 Aug 2026 WEAKENING/INFLOW 61.19 → 15 Aug 2026 WEAKENING/STABLE 49.89
  current: 15 Aug 2026   previous: 13 Aug 2026   steps: 2

  11 Aug → 13 Aug
    regime NEUTRAL → WEAKENING      DETERIORATING
    rotation ACCELERATING → INFLOW  DETERIORATING
    rotationScore 75.19 → 61.19 (Δ-14.00)  DETERIORATING
    breadth 0.143 → 0.143 (Δ+0.000)         STABLE
    momentum +14.03 → -0.98 (Δ-15.01)       DETERIORATING
    relStr -0.011 → +0.048 (Δ+0.059)        IMPROVING
    leadership BLUAI → TRUTH (Δ-27.94)      TRANSITION (leader changed)
    constituents 7 → 7 (added [] removed []) STABLE
    step: DETERIORATING

  13 Aug → 15 Aug
    regime WEAKENING → WEAKENING    STABLE
    rotation INFLOW → STABLE        DETERIORATING
    rotationScore 61.19 → 49.89 (Δ-11.30)  DETERIORATING
    breadth 0.143 → 0.000 (Δ-0.143)         DETERIORATING
    momentum -0.98 → -2.40 (Δ-1.42)         DETERIORATING
    relStr +0.048 → +0.040 (Δ-0.008)        STABLE
    leadership TRUTH → PROMPT (Δ-5.36)      TRANSITION (leader changed)
    step: DETERIORATING

  trend: regime DETERIORATING · rotation DETERIORATING · rotationScore DETERIORATING
         breadth DETERIORATING · momentum DETERIORATING · relativeStrength IMPROVING
         leadership TRANSITION · constituents STABLE · overall DETERIORATING
  dataSufficiency: {comparableArtifacts: 3, requiredMinimum: 2, sufficient: true}
```

Every delta was cross-checked against the raw persisted columns (mom7d
14.03/−0.984287/−2.402857 ⇒ Δ−15.01, −1.42; rotScore 75.192711/61.190795/49.892445
⇒ Δ−14.00, −11.30; breadth 0.142857→0.000000 ⇒ Δ−0.143; rs7d ⇒ +0.059, −0.008) —
**derived from stored data, never fabricated**.

**Degradation path** — `getP3IntelligenceHistory(4)` (FAVORITE, no P3 artifacts)
→ `null`. The API route wraps both P3 reads in try/catch: any service/DB failure
yields `null` and the narrative endpoint stays 200 (route tests).

**Mutations = 0** — `ARTIFACT_COUNT=3` before/after verification; only SELECTs.

==================================================
5. TESTS
==================================================

New suites (50 tests across the 3 touched suites, all passing):

| Suite | Cases |
|---|---|
| `p3-intelligence-history.test.ts` (27) | 0 artifact → null · 1 artifact → insufficient (steps 0, UNKNOWN, sufficient=false) · 2 artifacts → 1 step + deltas · 3 artifacts → 2 steps + aggregates + ordering · same regime → STABLE · NEUTRAL→NEUTRAL = STABLE · regime transition NEUTRAL→WEAKENING = DETERIORATING · NEUTRAL→EMERGING = IMPROVING · rotation STABLE→ACCELERATING = IMPROVING · ACCELERATING→INFLOW = DETERIORATING · score delta ±ε · improving/deteriorating/stable/unknown · NOT_APPLICABLE → UNKNOWN (not STABLE) · missing stage → UNKNOWN for that metric only · constituent snapshot unavailable → UNKNOWN · different algorithm version excluded · different calculation mode excluded · kernel isolation (no `@/lib/p3/` import, no calc function names) |
| `P3IntelligencePanel.test.tsx` (+4) | collapsed disclosure + overall badge · full chain + delta rows when open · insufficient-history message · null history renders nothing |
| `route-resilience.test.ts` (+2) | history service throws → 200 + `p3IntelligenceHistory: null` · history success → 200 + view model · (existing) narrative 404 without invoking P3 |

**Regressions:** full `src/lib/p3` + `src/components` run — **394 passed / 410
total**. The 16 failures are the known pre-existing P3-10 kernel debt: the 12
documented in P3-13 (rotation 6, breadth 1, preparation 1, persistence 2,
membership 1, p3-10e-29 1) plus `oi-source-filter` (4). `oi-source-filter.test.ts`
and its kernel source were last touched at `fe71947` (P3-10) and are **byte-
identical to HEAD** in this task — provably unaffected by P3-18 (which only
touches read-path files). Per the frozen constraint, kernel tests are not
"fixed to pass".

`npx tsc --noEmit` → 0 errors. `git diff --check` → PASS.

==================================================
6. UI (P3-14 Part E — progressive disclosure)
==================================================

`P3IntelligencePanel` now renders `P3HistoricalTrend` below the current state:

```
P3 Intelligence (current artifact — unchanged panel)
└─ ▸ Historical Trend          [Deteriorating]
     └─ open:
        AI · 7D · algorithm p3-orchestrator/1 · observed   (identity banner)
        Windows:  11 Aug 2026 [NEUTRAL][ACCELERATING] 75.19
                        ↓
                  13 Aug 2026 [WEAKENING][INFLOW] 61.19
                        ↓
                  15 Aug 2026 [WEAKENING][STABLE] 49.89
        Previous → Current · 13 Aug → 15 Aug
          Regime          [WEAKENING] → [WEAKENING]   [Stable]
          Rotation        [INFLOW] → [STABLE]          [Deteriorating]
          Rotation score  61.19 → 49.89 (Δ -11.30)     [Deteriorating]
          Breadth         0.143 → 0.000 (Δ -0.143)     [Deteriorating]
          Momentum        -0.98 → -2.40 (Δ -1.42)      [Deteriorating]
          Rel. Strength   +0.048 → +0.040 (Δ -0.008)   [Stable]
          Leadership      TRUTH 61.35 → PROMPT 55.98   [Transition]
          Constituents    7 → 7 (—)                    [Stable]
        Trend · 3 windows  [Deteriorating]  Regime / Rotation / Momentum /
          Breadth / Rel. Str. / Leadership / Constituents
        Why? — deltas compare only same-identity artifacts…
```

Insufficient history (1 artifact): "Not enough history yet — 1 same-identity
artifact available. At least 2 are required to compare windows." Never hidden,
never fabricated.

==================================================
7. HARD CONSTRAINTS — CONFIRMED
==================================================

| Constraint | Status |
|---|---|
| P3-04 → P3-09 kernel untouched | ✅ `git status` — only read-path files changed this task; kernel diff is P3-15/16 work only |
| Regime / rotation semantics unchanged | ✅ no kernel change; trends are read-side mappings over persisted labels |
| Thresholds unchanged | ✅ ε values adopted verbatim from P3-14 D.2 |
| Artifacts #1/#2/#3 untouched | ✅ `ARTIFACT_COUNT=3` before/after; immutable triggers intact |
| No new artifact / no backfill | ✅ verification is SELECT-only |
| Scheduler unchanged | ✅ not touched |
| No new dashboard / page / route namespace | ✅ extended the existing panel + existing route |
| No P3 kernel import in read path | ✅ enforced + regression-tested (source-level check) |
| Production mutations | ✅ 0 |

**STOP conditions** — none triggered: thresholds were specified (P3-14 D.2),
identity comparison is defined (P3-14 C), data is sufficient (3 same-identity
VALID artifacts), no kernel/semantics change required. No P3-19/E-chain opened.

==================================================
8. KNOWN DEBT (unchanged, documented)
==================================================

1. **16 pre-existing kernel test failures** (P3-10 family, incl. the 4
   `oi-source-filter` cases) — out of scope; kernel semantics are frozen.
2. **5-artifact recommended threshold** (P3-14 G.2) not yet reached — the UI
   labels the series "3 windows" and does not claim a confirmed long-term trend.
3. **Member-level leadership** (`p3_leadership_members` = 0 rows) — artifact-level
   leadership trend is used; member-level remains NOT AVAILABLE.
4. Sandbox preview CLI intermittently unavailable during verification — service
   verified directly against production + route covered by unit tests.
