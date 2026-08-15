# P3-14 — Historical Intelligence & Trend Specification

## Status: SPECIFICATION COMPLETE — Final Verdict: **B. DATA INSUFFICIENT — NEED MORE P3 EXECUTIONS**

**Spec date:** 2026-08-14
**Nature:** DISCOVERY + SPECIFICATION task. No production code was implemented. All queries were read-only. P3 kernel, thresholds, regime/rotation contracts, P0–P2 data, and immutable artifacts were **not touched**.
**Companion document:** `docs/P3_Upgrade/P3_14_HISTORICAL_DATA_AUDIT.md` (full data audit with query results).

---

## Executive Summary

P3-14 audited the persisted P3 dataset and designed the Historical Intelligence & Trend capability as a **specification only**. The audit found exactly **one P3 artifact** in the entire database (AI / 7D / windowEnd 2026-08-11 / VALID / NEUTRAL / ACCELERATING). The schema is trend-ready (every stage metric is a per-artifact column, identity is enforced), but **no historical series exists**, no previous artifact exists, and the scheduler has never run a P3 job.

**Verdict: B. DATA INSUFFICIENT — NEED MORE P3 EXECUTIONS.** P3-14 cannot be implemented meaningfully today. The spec below defines exactly what to build and the data thresholds required before trend becomes meaningful.

---

## PART A — Historical Data Audit

Full details in `P3_14_HISTORICAL_DATA_AUDIT.md`. Summary:

| Dimension | Finding |
|---|---|
| Total P3 artifacts | **1** |
| Artifacts per narrative | AI=1; RWA/TOPMC/FAVORITE/RESTAKING=0 |
| Artifacts per window | 7D=1 |
| Artifacts per window_end | 2026-08-11=1 |
| Availability states | VALID=1 |
| Regime history | [NEUTRAL] (length 1) |
| Rotation history | [ACCELERATING (75.19)] (length 1) |
| Leadership history | leaderCoinId 10 / 89.29 at artifact level; `p3_leadership_members` = **0 rows** |
| Stage metrics history | breadth/momentum1d/3d/7d/14d/RS1d/3d/7d/14d stored per artifact (length 1) |
| Constituent snapshot history | 1 snapshot (7 members, 7 eligible), 7 member rows |
| Corrections ledger | 1 entry (references artifact 1's superseded snapshot) |
| Scheduler | Only `interval_refresh` / `manual_refresh` ever ran; **0 P3 jobs** |
| Current / previous / series | current = artifact 1; **previous = none; series = length 1** |
| Missing periods | no periods have artifacts before/after 2026-08-11 |

**No historical data was assumed to exist — it does not.**

---

## PART B — Trend Capability

### B.1 Can the current system compute these trends?

| Trend metric | Requires | Status today | Once 2+ same-identity artifacts exist |
|---|---|---|---|
| Regime transition | 2 artifacts w/ regime | ❌ NOT AVAILABLE (1 artifact) | ✅ DERIVABLE (persisted `regime` column) |
| Rotation transition | 2 artifacts w/ rotation | ❌ NOT AVAILABLE | ✅ DERIVABLE (persisted `rotation`) |
| Rotation score delta | 2 artifacts w/ rotationScore | ❌ NOT AVAILABLE | ✅ DERIVABLE (persisted `rotation_score`) |
| Breadth delta | 2 artifacts w/ breadth | ❌ NOT AVAILABLE | ✅ DERIVABLE (persisted `breadth`) |
| Momentum delta | 2 artifacts w/ matched window momentum | ❌ NOT AVAILABLE | ✅ DERIVABLE (persisted `momentum{1,3,7,14}d`; window-matched per P3-12 `inferP3Window`) |
| Relative Strength delta | 2 artifacts w/ matched window RS | ❌ NOT AVAILABLE | ✅ DERIVABLE (persisted `relative_strength{1,3,7,14}d`) |
| Leadership change | 2 artifacts w/ leaderCoinId | ❌ NOT AVAILABLE | ✅ DERIVABLE at artifact level (leaderCoinId/leaderScore) |
| Leader score delta | 2 artifacts w/ leaderScore | ❌ NOT AVAILABLE | ✅ DERIVABLE |
| Constituent change | 2 constituent snapshots | ❌ NOT AVAILABLE | ✅ DERIVABLE (set-diff of `p3_constituent_snapshot_members`) |

### B.2 Classification

| Category | Metrics |
|---|---|
| **STORED DATA** | All of the above are stored per-artifact today (single artifact exists) |
| **DERIVABLE DATA** | All of the above are pure arithmetic/string comparisons over stored artifacts — no P3 recalculation needed, no kernel import |
| **NOT AVAILABLE** | Member-level leadership detail (`p3_leadership_members` = 0 rows: emerging leaders, leader persistence, contribution); 14d momentum for artifact 1 (null); any cross-artifact delta today (no second artifact) |

### B.3 Key design constraint

All trend computation must be **read-only over persisted artifacts** and must **never import P3 kernel modules** (`src/lib/p3/index.ts`) to recompute anything. Trends are derived, not recalculated.

---

## PART C — Historical Identity Contract

Two artifacts are comparable **only if they share the same identity**:

| Identity field | Source | Notes |
|---|---|---|
| `narrative_id` | `p3_narrative_intelligence.narrativeId` | Same narrative only |
| `window` | `provenance.context.window` (authoritative) | 1D/3D/7D/14D — do NOT compare 7D vs 3D artifacts |
| `algorithm_key` | `algorithmKey` | e.g. `p3-orchestrator` |
| `algorithm_version` | `algorithmVersion` | e.g. `1` — do NOT compare v1 vs v2 outputs |
| `calculation_mode` | `calculationMode` | `observed` vs simulated must not mix |

**Time dimension:** within an identity, artifacts are ordered by `window_end` ascending. "Previous" = the artifact with the same identity and the greatest `window_end` strictly less than the current one's.

**Explicitly forbidden:** arbitrarily comparing artifacts across narratives, windows, algorithm versions, or modes. The read service must filter by identity before ordering.

---

## PART D — Trend Semantics (PROPOSED — NOT APPROVED)

All of the following are **proposed semantics for review**. They are **not implemented** and **not approved**; a product decision is required before any threshold ships.

### D.1 Proposed trend state model

| State | Proposed definition | Notes |
|---|---|---|
| **IMPROVING** | Regime improves (e.g. NEUTRAL→EMERGING/STRONG) OR rotation strengthens (e.g. STABLE→ACCELERATING) OR momentum delta > +ε | Directional improvement |
| **DETERIORATING** | Regime weakens OR rotation weakens OR momentum delta < -ε | Directional decline |
| **STABLE** | No classification change and all metric deltas within ±ε | No meaningful movement |
| **TRANSITION** | A classification change occurred but direction is mixed / net score ≈ 0 | Regime/rotation changed; not clearly better or worse |
| **UNKNOWN** | < 2 comparable artifacts, or any required stage unavailable | Insufficient data — must render as UNKNOWN, never guess |

### D.2 Proposed thresholds (all ε values are PROPOSED placeholders)

| Threshold | Proposed value | Status |
|---|---|---|
| momentum delta ε | ±1.0 (percentage points, window-matched) | PROPOSED — requires review |
| rotation score delta ε | ±5.0 (0–100 scale) | PROPOSED — requires review |
| breadth delta ε | ±0.05 | PROPOSED — requires review |
| RS delta ε | ±0.01 | PROPOSED — requires review |
| leader score delta ε | ±5.0 | PROPOSED — requires review |

### D.3 Semantics rules

- **NEUTRAL is a valid regime** — a transition NEUTRAL→NEUTRAL is STABLE, not "no data".
- **NOT_APPLICABLE is distinct from STABLE** — an artifact whose stage availability is NOT_APPLICABLE yields UNKNOWN for that metric, never STABLE.
- If either endpoint of a comparison is unavailable (MISSING/INSUFFICIENT_HISTORY/NOT_APPLICABLE/INVALID/STALE/AMBIGUOUS), the trend for that metric is **UNKNOWN**, never fabricated.
- Regime/rotation **transitions are string comparisons** (identity-safe); score deltas are numeric. Both must agree with the identity contract (PART C).

---

## PART E — UI/UX Proposal (no new dashboard)

Proposed extension of the existing `/narrative/[id]` page, **below the current P3 Intelligence panel** (P3-12), following the same design language:

```
┌──────────────────────────────────────────────────────────────┐
│ P3 INTELLIGENCE  (current artifact — existing panel)          │
│   NEUTRAL · ACCELERATING · 7D · 11 Aug 2026                  │
├──────────────────────────────────────────────────────────────┤
│ HISTORICAL TREND (new, progressive disclosure)                │
│   ▸ Previous vs Current    AI · 7D                            │
│                                                              │
│   Regime      NEUTRAL → NEUTRAL      [STABLE]                │
│   Rotation    — → ACCELERATING       [TRANSITION]            │
│   Momentum    — → +14.03             [IMPROVING]  ← proposed │
│   Breadth     — → 0.143              [UNKNOWN]    ← no prev  │
│                                                              │
│   ▸ Why? — window, mode, identities compared                  │
└──────────────────────────────────────────────────────────────┘
```

Design decisions (proposed):

1. **Progressive disclosure** — Historical Trend is collapsed by default; the current-intelligence panel remains the primary surface (per PART I of P3-12 priorities).
2. **Previous vs Current comparison rows** — one row per metric: previous value → current value + proposed trend state badge.
3. **Regime/Rotation transition chips** — reuse the existing classification chip styles from `P3IntelligencePanel`.
4. **UNKNOWN state** — when < 2 comparable artifacts, show a neutral "Not enough history yet — N artifacts available" message (never hide, never fabricate).
5. **Identity banner** — always display the identity being compared (`AI · 7D · algorithm p3-orchestrator/1 · observed`), satisfying PART C transparency.
6. No new page, no new dashboard, no new route namespace.

---

## PART F — API Contract (PROPOSED — not implemented)

### F.1 Decision

**Do not implement an API in P3-14.** The audit proves zero comparable artifacts exist today; an endpoint would only ever return UNKNOWN. Implementation is deferred until the data threshold (PART G) is met.

### F.2 Proposed contract (for the future implementation task)

Preferred: **extend the existing read path** — do NOT create a new namespace.

```
GET /api/narratives/[id]   (existing route)
  data.p3Intelligence          — current artifact (existing, P3-12)
  data.p3IntelligenceHistory   — NEW: proposed shape below
```

Proposed read model (`P3IntelligenceHistoryViewModel`):

```
{
  identity: { narrativeId, window, algorithmKey, algorithmVersion, calculationMode },
  series: [ P3IntelligenceViewModel, ... ],        // ordered by windowEnd asc
  previous: P3IntelligenceViewModel | null,         // same identity, max windowEnd < current
  current: P3IntelligenceViewModel,
  trend: {
    regime:     { previous, current, state: IMPROVING|DETERIORATING|STABLE|TRANSITION|UNKNOWN },
    rotation:   { previous, current, delta, state },
    rotationScore: { previous, current, delta, state },
    breadth:    { previous, current, delta, state },
    momentum:   { previous, current, delta, state },
    relativeStrength: { previous, current, delta, state },
    leadership: { previousLeader, currentLeader, leaderScoreDelta, changed, state },
    constituents: { previousCount, currentCount, added, removed, changed, state },
  },
  dataSufficiency: { comparableArtifacts, requiredMinimum, sufficient }
}
```

Constraints (non-negotiable):

- UI → service → DB; **no P3 kernel import** anywhere in the read path.
- Service reads persisted rows only; trend is derived arithmetically/string-wise.
- `UNKNOWN` whenever the identity contract or availability gates fail.

---

## PART G — Data Sufficiency

### G.1 Direct answer

> **"Với dữ liệu production hiện tại, P3-14 có thể triển khai ngay hay cần thêm historical executions?"**

**Cần thêm historical executions. Dữ liệu hiện tại KHÔNG đủ.** Chỉ có **1 artifact** (AI/7D/2026-08-11); không có artifact trước đó, không có series. Mọi trend metric đều trả về UNKNOWN/NOT AVAILABLE ngày hôm nay.

### G.2 How many executions are required?

| Goal | Minimum artifacts (same identity) | Meaning |
|---|---|---|
| Show "Previous vs Current" with 1 delta per metric | **2** | First comparability point |
| Classify single-step trend (IMPROVING/DETERIORATING/STABLE/TRANSITION) | **2** | One transition is classifiable, but direction cannot be confirmed |
| Confirmed trend direction (2 consecutive deltas) | **3** | Direction becomes meaningful |
| **Recommended production threshold** | **5** | Enough consecutive windows to distinguish noise from trend |

Recommendation: **at least 3 artifacts (2 deltas) to expose trend with confidence; 5+ recommended before any "trend" claim is surfaced prominently.** With a daily window cadence (windowEnd daily), that is ~3–5 consecutive daily executions per narrative. Today: 1/5 for the recommended threshold, 0/2 for even the first comparability point.

### G.3 What must happen before implementation

1. A scheduled (or explicit) P3 execution loop must produce consecutive artifacts for the same identity — **none runs today** (0 P3 jobs in `scheduler_logs`).
2. Optionally, the `p3_leadership_members` write path should be exercised (0 rows today) if member-level leadership trend is desired.
3. Product approval of PART D proposed thresholds.

---

## PART H — Safety

| Requirement | Status |
|---|---|
| Production mutations | **0** — audit used read-only SELECTs only |
| P3 kernel modifications | **0** — no file under `src/lib/p3/` touched |
| P0–P2 modifications | **0** |
| Immutable artifacts | untouched (artifact 1 intact) |
| Corrections ledger | untouched |
| New API/UI code | **none** (spec only) |

---

## PART I — Deliverables

| Item | Location |
|---|---|
| Historical data audit | `docs/P3_Upgrade/P3_14_HISTORICAL_DATA_AUDIT.md` |
| This specification | `docs/P3_Upgrade/P3_14_HISTORICAL_INTELLIGENCE_AND_TREND_SPEC.md` |

No source code changed in P3-14.

---

## PART J — Final Verdict

### B. DATA INSUFFICIENT — NEED MORE P3 EXECUTIONS

**Reasoning:**

1. Exactly **1 P3 artifact** exists in production (AI / 7D / 2026-08-11 / VALID / NEUTRAL / ACCELERATING).
2. **No previous artifact, no historical series, no gaps** — a trend requires ≥2 same-identity artifacts; we have 1.
3. The scheduler has **never run a P3 job** — artifacts do not accrue automatically; the single artifact came from the manual P3-10E execution series.
4. `p3_leadership_members` is **empty** (0 rows) — member-level leadership history is not stored.
5. The schema and read architecture are **trend-ready** (per-artifact metrics, identity unique constraint, P3-12 view model reusable), so no schema change is needed — only **more executions**.

**Next step (not executed, per scope):** run consecutive P3 executions (target: 3+ artifacts per identity, 5 recommended), then implement the PART F contract + PART E UI with the approved PART D thresholds.

No P3-14E remediation chain is created. No kernel changes. No production changes.
