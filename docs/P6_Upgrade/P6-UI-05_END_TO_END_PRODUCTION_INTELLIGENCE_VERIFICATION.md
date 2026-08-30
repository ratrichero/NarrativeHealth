# P6-UI-05 — End-to-End Production Intelligence Verification & P3/P4/P5 Visibility Audit

## Date: 2026-08-30

---

## 1. Executive Summary

P6 end-to-end intelligence pipeline is **verified in production**:
- Snapshot persistence: FIXED (P6-UI-04)
- Downstream pipeline (regime/summary): WORKING
- P6 API: returns data correctly
- P6IntelligencePanel: mounted on both Coin and Narrative detail pages
- Indicators: 11 types present, no regression

P3 backend data exists (9 narratives). P4 backend data exists (1035 features). P5 tables do NOT exist in production. P3/P4/P5 UI panels are NOT mounted — P6IntelligencePanel has fully replaced them on detail pages.

---

## 2. Production Deployment

- Latest refresh: id=380, COMPLETED, 214s, 49 coins processed
- Snapshots created at: 2026-08-30 12:22:37 UTC
- Code includes P6-UI-04 fix (commit f023965+)

---

## 3. Production Snapshot State

```
coin: CURRENT = 49
narrative: CURRENT = 9
narrative: SUPERSEDED = 18
```

All 49 active coins have CURRENT snapshots. All 9 narratives have CURRENT snapshots.

---

## 4. Coin 16 Snapshot Evidence

| Field | Value |
|-------|-------|
| id | 472 |
| status | CURRENT |
| health_score | 27.88 |
| confidence_score | 60 |
| data_completeness | 66.7 |
| timeframe | DAILY |
| feature_version_id | null |
| calculation_time | 2026-08-30 12:22:37 UTC |

**Health Dimensions:**
- TREND: 0
- MOMENTUM: 39
- VOLUME: 15
- DERIVATIVE: 57.5

**Provenance keys:** input_features, quality_summary, calculation_time, input_window_end, snapshot_version, data_completeness, freshness_summary, input_window_start, entity_snapshot_time, input_observations_count

---

## 5. Narrative 1 Snapshot Evidence

| Field | Value |
|-------|-------|
| id | 518 |
| status | CURRENT |
| health_score | 50 |
| data_completeness | 0 |
| calculation_time | 2026-08-30 12:22:37 UTC |

**Member scores:** 7 members. All with weight=0, included=false (market cap unavailable for weighting). First member: CARV, health_score=50.38.

Historical: 2 SUPERSEDED records (Aug 27, Aug 28).

---

## 6. Downstream P6 Artifacts

### Coin 16

| Artifact | Status | Evidence |
|----------|--------|----------|
| Snapshot | CURRENT (id=472) | health=27.88, confidence=60 |
| Regime | CURRENT (id=93) | regime=UNKNOWN, conf=0, count=0 |
| Warnings | 0 active | No warnings for coin 16 |
| Summary | 1 CURRENT | health=27.88, snapshot_confidence=60, regime=UNKNOWN, warnings=0, regime_changed=true |

**Artifact chain:** Snapshot → Regime → Summary ✅
Warnings: ABSENT (not a bug — no threshold triggered)

### Narrative 1

| Artifact | Status | Evidence |
|----------|--------|----------|
| Snapshot | CURRENT (id=518) | health=50, completeness=0 |
| Regime | CURRENT (id=135) | regime=STABLE, conf=100, count=10 |
| Warnings | 0 active | No warnings for narrative 1 |
| Summary | CURRENT | health=50, regime=STABLE, warnings=0, regime_changed=false |

**Artifact chain:** Snapshot → Regime → Summary ✅

---

## 7. API ↔ DB Traceability

Coin 16 DB → API chain:
```
DB: p6_snapshots (coin/16, CURRENT, health=27.88, confidence=60)
  → readCurrentSnapshot() reads WHERE status='CURRENT'
  → /api/p6/coins/16 returns CoinIntelligenceDTO
  → P6IntelligencePanel renders health, confidence, regime, warnings, summary
```

**Verified:** API reads CURRENT artifacts only. DB values match expected API output.

---

## 8. P6IntelligencePanel UI Inventory

### Coin Detail

```
P6 Intelligence
├── Health Score (27.9)
├── Confidence (60.0)
├── Regime (UNKNOWN badge)
├── Warnings count (0 — "No active warnings")
├── Historical Comparison selector (Off / 7 Days / 30 Days / Baseline)
├── [Expandable] Health Delta, What Changed, Why, What to Watch
└── [Expandable] Quality state, Freshness state, Window end
```

### Narrative Detail

```
P6 Intelligence
├── Health Score (50.0)
├── Confidence (N/A)
├── Regime (STABLE badge)
├── Warnings count (0)
├── Historical Comparison selector
├── [Expandable] Summary details
└── [Expandable] Quality/Freshness metadata
```

---

## 9. P6 Value Assessment

| Intelligence | Coin 16 | Narrative 1 | Evidence |
|-------------|---------|-------------|----------|
| Health | YES (27.88) | YES (50.0) | DB + API + UI |
| Confidence | YES (60) | NO (null) | DB + API + UI |
| Regime | YES (UNKNOWN) | YES (STABLE) | DB + API + UI |
| Warning | YES (0 warnings) | YES (0 warnings) | DB + API + UI |
| Summary | YES (regime_changed, what_changed) | YES (health_delta=0) | DB + API + UI |
| Quality | YES (via snapshot quality_metadata) | YES (via summary quality_metadata) | DB + API |
| Freshness | YES (via freshness_metadata) | YES (via freshness_metadata) | DB + API |
| Provenance | YES (full provenance chain) | YES (provenance with member snapshots) | DB + API |

---

## 10. P3/P4/P5 Backend Status

| Layer | Backend Status | Evidence |
|-------|---------------|----------|
| P3 | BACKEND_PRESENT — 9 narratives in p3_narrative_intelligence | Latest: id=15, narrative=2, avail=VALID, regime=NEUTRAL |
| P4 | BACKEND_PRESENT — 1035 features + health_scores + narrative_health | coin 16 latest: health=27, status=WEAK |
| P5 | BACKEND_ABSENT — p5_* tables do not exist in production DB | No P5 tables found |

### P3 Regime Values

| Narrative | Regime | Latest |
|-----------|--------|--------|
| 1 (AI) | NEUTRAL | 2026-08-26 |
| 2 (RWA) | NEUTRAL | latest |
| 3 (TOPMC) | WEAKENING | latest |

---

## 11. P3/P4/P5 UI Status

| Layer | Backend | API | UI Mounted | UI Visible |
|-------|---------|-----|------------|------------|
| P3 | YES | YES (/api/p3/*) | NO | NO |
| P4 | YES | YES (features, health_scores) | NO | NO |
| P5 | NO | NO | NO | NO |
| P6 | YES | YES (/api/p6/*) | YES | YES |

**P6IntelligencePanel** is the ONLY intelligence panel mounted on both Coin Detail and Narrative Detail pages. No P3/P4/P5 legacy components are rendered.

---

## 12. P3/P4/P5 → P6 Relationship

**Classification: B — Replaced**

P6 UI (`P6IntelligencePanel`) has fully replaced P3/P4/P5 panels on detail pages. The old P3/P4/P5 components exist in `src/components/` but are NOT imported or rendered by the detail page routes.

P6 does NOT incorporate P3/P4/P5 data in its presentation. P6 uses its own snapshot/regime/warning/summary pipeline. P3/P4/P5 data remains in the backend but has no UI representation on detail pages.

This is a **UI visibility gap** for P3/P4/P5, not a P6 defect.

---

## 13. Indicator 1D Verification

Business date: 2026-08-30 (Asia/Ho_Chi_Minh)

**Coin 16 — 11 indicator types present:**

| Indicator | Value |
|-----------|-------|
| EMA_9 | 0.13260200 |
| EMA_21 | 0.14257919 |
| EMA_50 | 0.16037365 |
| EMA_200 | NaN (insufficient history — expected) |
| RSI_14 | 33.10723232 |
| MACD | -0.01059136 |
| ADX_14 | 43.93168403 |
| BB_20 | 0.14250500 |
| ATR_14 | 0.01160790 |
| VOLUME_RATIO | 0.39768191 |
| OBV | 1,504,066,079 |

**No regression.** EMA_200 = NaN is expected for coin 16 (insufficient historical klines).

---

## 14. TypeScript Regression

```
npx tsc --noEmit → exit code 0 (PASS)
```

---

## 15. Findings Classification

| # | Finding | Class | Description |
|---|---------|-------|-------------|
| F1 | P6 snapshots materialize CURRENT | PASS | All 49 coins + 9 narratives verified |
| F2 | P6 downstream pipeline works | PASS | Regime + summary populated correctly |
| F3 | P6IntelligencePanel displays data | PASS | Health, confidence, regime, warnings, summary all rendered |
| F4 | Indicators 1D present | PASS | 11 types, no regression |
| F5 | P3/P4/P5 UI panels not mounted | **Class C** | Non-blocking — P6 replaces P3/P4/P5 on detail pages |
| F6 | P5 tables absent in production | **Class D** | Deferred — P5 was never deployed to this production DB |
| F7 | Narrative 1 data_completeness = 0 | **Class C** | Non-blocking — all members have weight=0 (no market cap) |
| F8 | Coin 16 regime = UNKNOWN | **Class C** | Non-blocking — regime logic needs historical data |

---

## 16. Remaining Gaps

1. **P3/P4/P5 UI visibility**: P3 and P4 data exists in backend but is not displayed on Coin/Narrative detail pages. This is a separate UI integration task if legacy visibility is desired.

2. **P5 never deployed**: p5_* tables do not exist in production. P5 decision records were never materialized.

3. **Narrative weighting**: All narrative members have weight=0 because no coins have market cap data available. Narrative health_score defaults to 50.

---

## 17. Recommended Next Tasks

1. **P6-UI-06** — Restore P3 legacy panels on Coin/Narrative detail (if P3 intelligence should remain visible to users)
2. **P6-UI-07** — Investigate narrative member weighting (market cap data gap)
3. **P5-DEPLOY** — Deploy P5 tables if decision records are needed (separate infrastructure task)

---

## 18. Final Verdict

```
P6 END-TO-END INTELLIGENCE VERIFIED
```

- Snapshot persistence: ✅ FIXED (P6-UI-04)
- Downstream pipeline: ✅ WORKING
- P6 API: ✅ RETURNS DATA
- P6IntelligencePanel: ✅ MOUNTED AND RENDERING
- Indicators: ✅ NO REGRESSION
- TypeScript: ✅ PASS
- P3/P4/P5 UI: ⚠️ NOT MOUNTED (separate visibility gap, not P6 defect)
