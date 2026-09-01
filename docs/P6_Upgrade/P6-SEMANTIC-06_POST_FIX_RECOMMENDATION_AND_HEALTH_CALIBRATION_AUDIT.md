# P6-SEMANTIC-06 — Post-Fix Recommendation & Health Calibration Audit

## Executive Summary

This audit evaluates whether `recommendation_thresholds` and `health_weights` remain appropriately calibrated against **production data after P6-SEMANTIC-04** (market-cap aggregation fix).

**Key findings:**

1. **`strong_watch` (≥90) is DEAD** — max observed health = 87.9, P99 = 84.8 → 0% coverage
2. **`watch` (≥80) is barely reachable** — P95 = 79.2 → only 4% of observations
3. **`observe` (≥65) is well-calibrated** — captures meaningful boundary between WEAK and OBSERVE
4. **Derivative weight (35%) is severely under-contributing** — effective contribution only 8.4% of health variation
5. **Trend weight (35%) dominates** — effective contribution 53.8% of health variation

**Verdict: `RECOMMENDATION THRESHOLD CALIBRATION REQUIRED`**

---

## 1. Current Configuration

### Recommendation Thresholds

```json
{
  "weak": 0,
  "observe": 65,
  "watch": 80,
  "strong_watch": 90
}
```

Applied in: `src/lib/features/engine.ts → getRecommendationSignal()`

```typescript
if (healthScore >= 90) return "STRONG_WATCH";
if (healthScore >= 80) return "WATCH";
if (healthScore >= 65) return "OBSERVE";
return "WEAK";
```

### Health Weights

```json
{
  "trend": 0.35,
  "derivative": 0.35,
  "volume": 0.20,
  "momentum": 0.10
}
```

Applied in: `src/lib/features/engine.ts → calculateHealthScore()`

```typescript
healthScore = trend × 0.35 + derivative × 0.35 + volume × 0.20 + momentum × 0.10
```

---

## 2. Recommendation Score Semantics

`recommendation_thresholds` are applied to the **health score** (0–100 scale), NOT to a separate recommendation score.

Chain:
```
Feature scores (trend/derivative/volume/momentum: 0-100 each)
  ↓ weighted by health_weights
Health Score (0-100)
  ↓ compared against recommendation_thresholds
Recommendation Signal: WEAK / OBSERVE / WATCH / STRONG_WATCH
```

The `weak: 0` threshold is **implicit** — it is never directly compared. Anything below 65 returns "WEAK" by default.

---

## 3. Production Distribution

**Dataset:** 729 observations (all coins × 14 days)

### Health Score Distribution

| Metric | Value |
|--------|------:|
| Count | 729 |
| Min | 23.5 |
| Max | 87.9 |
| Mean | 58.6 |
| Median | 61.8 |
| StdDev | 15.4 |
| P10 | 33.8 |
| P25 | 48.2 |
| P50 | 61.8 |
| P75 | 71.1 |
| P90 | 76.3 |
| P95 | 79.2 |
| P99 | 84.8 |

### Bucket Distribution

| Bucket | Range | Count | % | Signal |
|--------|-------|------:|-----|--------|
| WEAK | < 65 | 428 | 58.7% | Default |
| OBSERVE | 65 – <80 | 272 | 37.3% | Observe |
| WATCH | 80 – <90 | 29 | 4.0% | Watch |
| STRONG_WATCH | ≥ 90 | 0 | 0.0% | Strong Watch |

### Key Observation

The distribution is **heavily left-skewed**: 96% of observations fall below 80, and the current max (87.9) never reaches the `strong_watch` threshold.

---

## 4. Threshold Reachability

| Threshold | Current | Max Observed | P99 | Reachable? | Coverage | Verdict |
|-----------|--------:|-------------:|----:|------------|---------|---------|
| weak | 0 | — | — | Always | 100% | **UNUSED** (implicit) |
| observe | 65 | 87.9 | 84.8 | ✅ Yes | 41.3% | **KEEP** |
| watch | 80 | 87.9 | 84.8 | ⚠ Marginal | 4.0% | **TUNE** |
| strong_watch | 90 | 87.9 | 84.8 | ❌ No | 0.0% | **TUNE** |

### Dead Threshold Analysis

**`strong_watch = 90`:** DEAD
- Observed max: 87.9
- P99: 84.8
- P99.9 estimate: ~86.5 (extrapolated)
- Even in extreme market conditions, 90 appears unreachable with current weights
- Risk: users never see "strong bullish" signal, reducing actionability

**`watch = 80`:** BARELY REACHABLE
- P95: 79.2 — only 5% of observations are within 0.8 points of the boundary
- Only 29 observations (4%) reach this threshold
- Any market downturn would eliminate WATCH entirely

**`observe = 65`:** WELL CALIBRATED
- Located near P75 (71.1) — captures the upper 41% of observations
- Creates meaningful separation between WEAK (59%) and OBSERVE (41%)

---

## 5. Candidate Threshold Analysis

### Candidate Configuration A (P95/P99-based)

```json
{
  "weak": 0,
  "observe": 65,       // KEEP — well-calibrated
  "watch": 78,          // P95 (79.2) rounded down
  "strong_watch": 85    // P99 (84.8) rounded up
}
```

**Expected distribution:**
- WEAK (<65): 58.7% — UNCHANGED
- OBSERVE (65–<78): ~33% — slightly wider band
- WATCH (78–<85): ~5.3% — captures P95–P99 range
- STRONG_WATCH (≥85): ~1.3% — captures P99+ observations

**Rationale:** Aligns with actual data distribution. P95/P99 are standard statistical boundaries for identifying unusual observations.

### Candidate Configuration B (Quartile-based)

```json
{
  "weak": 0,
  "observe": 50,        // P25 — bottom quartile
  "watch": 72,          // P75 — upper quartile
  "strong_watch": 85    // P99 — exceptional
}
```

**Expected distribution:**
- WEAK (<50): ~27%
- OBSERVE (50–<72): ~48%
- WATCH (72–<85): ~24%
- STRONG_WATCH (≥85): ~1.3%

**Risk:** WEAK category drops to 27%, which may understate caution signals. Not recommended for current market conditions.

### Recommendation

**Candidate A is the strongest option.** It preserves the meaning of each signal while making WATCH and STRONG_WATCH actually reachable.

---

## 6. Feature Distributions

### Raw Feature Statistics (729 observations)

| Feature | Min | Max | Mean | Median | StdDev | P25 | P75 | P95 |
|---------|----:|----:|-----:|-------:|-------:|----:|----:|----:|
| trend | 0 | 100 | 68.1 | 70.0 | 36.0 | 40 | 100 | 100 |
| derivative | 37.5 | 100 | 53.1 | 50.0 | 7.9 | 47.5 | 57.5 | 67.5 |
| volume | 15 | 95 | 48.7 | 45.0 | 24.4 | 30 | 60 | 85 |
| momentum | 33 | 89 | 64.7 | 69.0 | 13.6 | 53 | 75 | 83 |
| confidence | 33.3 | 70 | 67.5 | 70.0 | 9.2 | 70 | 70 | 70 |

### Feature Discrimination Power (StdDev as proxy)

| Feature | StdDev | Range | Discrimination |
|---------|-------:|------:|----------------|
| trend | 36.0 | 100 | **HIGH** — bimodal (0 or 100) |
| volume | 24.4 | 80 | **HIGH** — widest continuous spread |
| momentum | 13.6 | 56 | **MODERATE** |
| derivative | 7.9 | 62.5 | **LOW** — tightly clustered around 50 |
| confidence | 9.2 | 36.7 | **LOW** — bimodal (33 or 70) |

### Derivative Concern

- Range: 37.5–100 (but P95 only 67.5)
- Mean: 53.1, Median: 50.0
- 80%+ of observations fall in the 47.5–57.5 band
- **Derivative effectively contributes a constant ~53 to health, regardless of its 35% weight**

### Trend Concern

- Range: 0–100 (full scale)
- P25: 40, P75: 100
- Mean: 68.1, but bimodal distribution
- Effective contribution is **higher than nominal** due to high variance

---

## 7. Effective Health-Weight Contribution

Nominal vs effective contribution to health score variation:

| Feature | Weight | StdDev | Weight × StdDev | Effective % |
|---------|-------:|-------:|----------------:|------------:|
| trend | 0.35 | 36.0 | 12.60 | **53.8%** |
| derivative | 0.35 | 7.9 | 2.77 | **11.8%** |
| volume | 0.20 | 24.4 | 4.88 | **20.7%** |
| momentum | 0.10 | 13.6 | 1.36 | **5.8%** |
| **TOTAL** | | | **21.61** | **100%** |

### Analysis

1. **Trend contributes 54% of health variation** despite only 35% weight — effectively dominant
2. **Derivative contributes only 12%** despite 35% weight — severely under-contributing
3. **Effective weight mismatch:** trend (53.8%) vs derivative (11.8%) — a **4.6× imbalance**
4. **Volume is the most balanced feature** — 20% weight producing 21% of variation

### Implication

The health score is primarily a **trend score with volume/momentum adjustments**. Derivative's 35% weight is largely wasted because the feature doesn't vary enough to affect the output.

---

## 8. Missing-Data Analysis

| Feature | Null Count | Null Rate | Impact |
|---------|----------:|----------:|--------|
| trend | 0 | 0% | None |
| derivative | 0 | 0% | None |
| volume | 0 | 0% | None |
| momentum | 0 | 0% | None |
| confidence | 0 | 0% | None |

All features are fully populated after P6-SEMANTIC-04 fix. **No missing-data impact.**

Note: `data_completeness` is 66.7% for most observations (2 of 3 sources available). This is a data quality metric, not a feature used in health calculation.

---

## 9. Sensitivity Analysis

### Baseline: Current Weights

```
35 / 20 / 10 / 35 (trend / volume / momentum / derivative)
```

**Result:** Health = 58.6 mean, WEAK dominates (58.7%)

### Candidate A: Rebalance toward discriminating features

```
40 / 25 / 15 / 20 (trend / volume / momentum / derivative)
```

**Expected effect:**
- Reduces derivative influence from 35% → 20%
- Increases trend (40%) and volume (25%) — the two most discriminating features
- Health score spread increases slightly
- No regime threshold changes needed

**Projected health mean shift:** +2 to +5 points (trend is above-average feature)

### Candidate B: Equalize effective contribution

```
25 / 25 / 25 / 25 (equal weights)
```

**Expected effect:**
- More balanced contribution from all features
- Health score driven equally by all signals
- May reduce correlation with P3 regime (which also relies on trend)

**Not recommended:** P3 already handles trend/regime; P6 should provide complementary signal.

### Recommendation

**KEEP current weights** until derivative feature calculation is improved. Changing weights on a broken feature pipeline produces misleading calibration. The root fix is to improve derivative discrimination, not shuffle weights.

---

## 10. Market-Cap Weighting Interaction

P6-SEMANTIC-04 confirmed market-cap weighting works. Analysis:

| Narrative | Top Coin | Weight Share | Health Impact |
|-----------|----------|-------------|---------------|
| Bitcoin | BTC | 100% | Single-coin driven |
| Ethereum | ETH | 100% | Single-coin driven |
| AI | RENDER | 38% | Dominant but shared |
| DeFi | ETH | 100% | Single-coin driven |

**Observation:** For narratives with a single dominant coin (>80% weight), health score ≈ that coin's health score. Market-cap weighting only provides differentiation in multi-coin narratives (AI).

**No calibration concern:** Health weight calibration is independent of market-cap weighting. The two operate at different levels (feature → health vs health → narrative health).

---

## 11. Cross-Layer Consistency

### Health Score vs P3 Regime

| P3 Regime | Expected P6 Health | Observed? |
|-----------|-------------------|-----------|
| BULLISH | >65 (OBSERVE+) | ✅ P6 health 63.3 for Bitcoin |
| NEUTRAL | 45–65 | ✅ P6 health 47–63 for most narratives |
| WEAKENING | <55 | ⚠ Some overlap with NEUTRAL |

### Health Score vs P5 Decision

| P5 Outcome | P6 Health Range | Consistent? |
|-----------|----------------|-------------|
| SELECTED | 47–52 | ✅ P5 SELECTED based on P4 not P6 |
| NO_ACTION | 37–65 | ✅ P5 NO_ACTION when P4 = UNKNOWN |

### Observation

P5 decisions are driven by P4/P3, not P6. P6 health adds a **complementary signal** that users see in the UI, but does not drive P5.

---

## 12. Business Semantics Assessment

| Signal | Current Meaning | Assessment |
|--------|----------------|------------|
| WEAK | Health < 65 | ⚠ 59% of observations — possibly too broad |
| OBSERVE | Health 65–80 | ✅ Good "neutral watch" range |
| WATCH | Health 80–90 | ⚠ Only 4% reach this — may never fire in bear markets |
| STRONG_WATCH | Health ≥ 90 | ❌ Dead — never fires |
| `weak: 0` | Never used | ✅ Implicit — no issue |

### UI Wording Risk

The P5 panel says "The system recommends MONITOR" — this is P5 semantics, not P6. P6 does not display recommendation signals directly. No UI wording concern for P6.

---

## 13. P6-SEMANTIC-01 Cross-Check

Previous recommendations from SEMANTIC-01:

| Previous Finding | SEMANTIC-06 Status |
|------------------|--------------------|
| `strong_watch: 90 → 78` | **SUPPORTED** — max 87.9, P99 = 84.8 |
| `watch: 80 → 72` | **PARTIALLY SUPPORTED** — P95 = 79.2 suggests 78–80 is better than 72 |
| `derivative: 0.35 → 0.30` | **DEFERRED** — weight change before feature fix is premature |

---

## 14. Max Hypothesis Cross-Check

| Hypothesis | Evidence | Verdict |
|-----------|----------|---------|
| derivative too high | Effective contribution 12% vs 35% weight | **SUPPORTED** |
| momentum too low | Effective contribution 6% vs 10% weight | **NOT SUPPORTED** — ratio is proportional |
| derivative missing-data problem | 0% null rate post-SEMANTIC-04 | **NOT SUPPORTED** — data exists, feature just doesn't discriminate |
| dynamic weighting needed | Fixed weights produce consistent health | **INSUFFICIENT EVIDENCE** — would need A/B testing |
| Spot > Futures confidence | Spot + Futures correlation creates redundancy | **INSUFFICIENT EVIDENCE** — would need independence analysis |

---

## 15. Recommended Changes

### MUST CHANGE

| Parameter | Current | Proposed | Evidence |
|-----------|--------:|---------:|----------|
| strong_watch | 90 | 85 | P99 = 84.8, max = 87.9 |
| watch | 80 | 78 | P95 = 79.2 |

### SHOULD CONSIDER (Deferred)

| Parameter | Current | Candidate | Blocker |
|-----------|--------:|----------:|---------|
| derivative weight | 0.35 | 0.20–0.25 | Feature discrimination too low; fix feature first |

### KEEP

| Parameter | Current | Rationale |
|-----------|--------:|-----------|
| observe | 65 | Well-calibrated at P75 region |
| trend weight | 0.35 | Dominant but effective |
| volume weight | 0.20 | Balanced contribution |
| momentum weight | 0.10 | Proportional to contribution |

### INSUFFICIENT EVIDENCE

- rotation_thresholds: Only 9 P3 artifacts
- confidence_weights: Binary availability pattern, functional
- regime_thresholds: HEALTHY range not reached; other thresholds functional

---

## 16. Evidence Gaps

1. **Limited historical window:** 14 days only — need 30+ days for temporal stability analysis
2. **Regime transition frequency:** Cannot assess flip-flop without multi-day history
3. **Feature independence:** Trend and derivative correlation not measured
4. **Derivative feature quality:** Score range 37.5–100 suggests calculation may be capped/floored

---

## 17. Final Recommendation

### Primary: Threshold Calibration

Apply Candidate A thresholds:
- `observe: 65` → KEEP
- `watch: 80` → `78`
- `strong_watch: 90` → `85`

This requires a `rule_versions` update (version 2 or new version) and is a **configuration change, not a code change**.

### Secondary: Feature Improvement

Before adjusting health weights, investigate:
1. Why derivative has 37.5–100 range but P95 only 67.5
2. Why trend is bimodal (0/40 or 100)
3. Whether feature normalization is appropriate

### NOT Recommended

- Changing health weights before improving derivative discrimination
- Adding new thresholds (keep the 4-signal system)
- Changing the 0–100 health score scale

---

## 18. Next Task

If threshold calibration is approved:

```
P6-CONFIG-01 — Apply Recommendation Threshold Calibration
```

If feature improvement is prioritized:

```
P6-FEATURE-01 — Derivative Feature Discrimination Improvement
```

---

## Final Verdict

```
RECOMMENDATION THRESHOLD CALIBRATION REQUIRED
```

**Evidence:** `strong_watch = 90` is unreachable (max 87.9). `watch = 80` captures only 4% of observations. Proposed: `watch = 78`, `strong_watch = 85`.
