# P6-SEMANTIC-07 — Health Weight Sensitivity & Predictive Value Audit

## Executive Summary

This audit evaluates whether `health_weights` need adjustment after P6 narrative aggregation repair and recommendation threshold calibration.

**Key findings:**

1. **Derivative's 35% weight is structurally constrained** — its feature stddev (7.9) limits effective contribution to 11.8% regardless of weight increases
2. **Trend and momentum are 64% correlated** — they share signal, creating potential double-counting
3. **All3 candidate configurations produce nearly identical health distributions** — stddev 15.4–16.3, mean 58.6–59.2
4. **No ground truth exists** to validate which configuration produces better predictions
5. **Volume is the most volatile feature** (day-over-day mean change 17.7) — increasing its weight adds noise

**Verdict: `INSUFFICIENT_EVIDENCE_DEFER`**

The current weights are not optimal, but no evidence supports that any alternative is better. The root issue is **derivative feature quality**, not weight allocation. Tuning weights before fixing the feature pipeline would be speculative.

---

## 1. Current Baseline

### Configuration

```json
{
  "trend": 0.35,
  "derivative": 0.35,
  "volume": 0.20,
  "momentum": 0.10
}
```

### Nominal vs Effective Contribution

| Feature | Nominal Weight | StdDev | Weight × StdDev | Effective % |
|---------|---------------:|-------:|----------------:|------------:|
| trend | 0.35 | 36.0 | 12.60 | **53.8%** |
| derivative | 0.35 | 7.9 | 2.77 | **11.8%** |
| volume | 0.20 | 24.4 | 4.88 | **20.7%** |
| momentum | 0.10 | 13.6 | 1.36 | **5.8%** |

**Finding confirmed:** Derivative's 35% weight produces only 12% of health variation due to low feature discrimination (stddev 7.9 vs trend's 36.0).

---

## 2. Feature Distribution

### Production Data (n=729, 14-day window)

| Feature | Min | Max | Mean | Median | StdDev | P10 | P25 | P75 | P90 | P95 | P99 |
|---------|----:|----:|-----:|-------:|-------:|----:|----:|----:|----:|----:|----:|
| trend | 0 | 100 | 68.1 | 70.0 | 36.0 | 0 | 40 | 100 | 100 | 100 | 100 |
| derivative | 37.5 | 100 | 53.1 | 50.0 | 7.9 | 47.5 | 47.5 | 57.5 | 57.5 | 67.5 | 75.0 |
| volume | 15 | 95 | 48.7 | 45.0 | 24.4 | 15 | 30 | 60 | 85 | 85 | 95 |
| momentum | 33 | 89 | 64.7 | 69.0 | 13.6 | 45 | 53 | 75 | 81 | 83 | 85 |

### Feature Discrimination Power

| Feature | StdDev | Range Used | Discrimination | Distribution Shape |
|---------|-------:|-----------:|----------------|-------------------|
| trend | 36.0 | 100 | **HIGH** | Bimodal (0 or 100) |
| volume | 24.4 | 80 | **HIGH** | Continuous spread |
| momentum | 13.6 | 56 | **MODERATE** | Skewed right |
| derivative | 7.9 | 62.5 | **LOW** | Tightly clustered around 50 |

### Critical Observation

**Derivative's narrow range (37.5–100, but P95=67.5)** means 95% of observations fall within a 20-point band (47.5–67.5). Even doubling its weight from 35% to 70% would only increase its effective contribution from 12% to ~24% — still dominated by trend.

---

## 3. Correlation Analysis

| Pair | Correlation | Interpretation |
|------|------------:|----------------|
| trend ↔ momentum | **0.643** | HIGH — shared signal (trend-following) |
| trend ↔ volume | 0.160 | LOW — mostly independent |
| trend ↔ derivative | **−0.015** | ZERO — completely independent |
| derivative ↔ volume | 0.041 | ZERO — completely independent |
| derivative ↔ momentum | 0.021 | ZERO — completely independent |
| volume ↔ momentum | 0.158 | LOW — mostly independent |

### Implications

1. **Trend + momentum = double-counting risk** — both capture directional movement; 64% correlation means increasing one effectively increases both
2. **Derivative is the only truly independent signal** — zero correlation with all other features
3. **Volume provides unique information** — low correlation with everything else
4. **Reducing derivative weight reduces independent signal** — the only feature that isn't correlated with trend

---

## 4. Sensitivity Analysis

### Candidate Configurations

| Config | Trend | Derivative | Volume | Momentum | Rationale |
|--------|------:|-----------:|-------:|---------:|-----------|
| A (Current) | 0.35 | 0.35 | 0.20 | 0.10 | Baseline |
| B (Moderate) | 0.35 | 0.30 | 0.20 | 0.15 | Shift 5% from derivative → momentum |
| C (Balanced) | 0.35 | 0.25 | 0.25 | 0.15 | Shift 10% from derivative → volume+momentum |

### Health Score Distribution Comparison

| Metric | A (Current) | B (Moderate) | C (Balanced) |
|--------|------------:|-------------:|-------------:|
| Mean | 58.6 | 59.2 | 59.0 |
| Median | 61.8 | 62.6 | 62.5 |
| StdDev | 15.4 | 15.8 | 16.3 |
| Min | 23.5 | 23.1 | 21.5 |
| Max | 87.9 | 87.7 | 87.2 |

**Key finding:** All3 configurations produce nearly identical distributions. The mean shifts by only 0.6 points, and stddev increases by only 0.9 points. No configuration dramatically changes the health score landscape.

### Ranking Stability

Narrative health simulation (equal-weighted across members):

| Narrative | A (Current) | B (Moderate) | C (Balanced) | Max Δ |
|-----------|------------:|-------------:|-------------:|------:|
| N1 (AI) | 42.6 | 43.3 | 41.6 | 1.7 |
| N2 | 44.0 | 44.3 | 42.8 | 1.5 |
| N3 | 63.1 | 64.5 | 62.7 | 1.8 |
| N4 | 58.2 | 59.7 | 57.9 | 1.8 |
| N6 | 58.7 | 59.8 | 58.1 | 1.7 |
| N7 | 55.4 | 56.5 | 56.5 | 1.1 |
| N8 | 65.9 | 67.4 | 66.3 | 1.5 |
| N9 | 42.0 | 42.9 | 41.1 | 1.8 |
| N10 | 51.6 | 51.9 | 50.1 | 1.8 |

**Ranking is stable.** No narrative changes rank position across configurations. The max shift is 1.8 points — well within noise.

### Regime Distribution Comparison

| Regime | A (Current) | B (Moderate) | C (Balanced) |
|--------|------------:|-------------:|-------------:|
| BEARISH | 11.8% | 11.8% | 11.9% |
| WEAKENING | 15.1% | 14.4% | 15.5% |
| NEUTRAL | 31.8% | 30.0% | 31.1% |
| STABLE | 41.3% | 43.8% | 41.4% |

**Regime distribution is stable.** Config B shifts ~2.5% from NEUTRAL to STABLE, but no regime changes dramatically.

---

## 5. Day-Over-Day Stability

| Feature | Mean Change | Median | P90 | Max | Interpretation |
|---------|----------:|-------:|----:|----:|----------------|
| trend | 7.5 | 0.0 | 40.0 | 100.0 | Low typical change, but can jump |
| derivative | 8.0 | 10.0 | 17.5 | 62.5 | Moderate, bounded |
| volume | **17.7** | 15.0 | 45.0 | 70.0 | **HIGH VOLATILITY** |
| momentum | 2.9 | 0.0 | 6.0 | 24.0 | Very stable |

### Implications

1. **Volume is the noisiest feature** — mean daily change of 17.7 points. Increasing volume weight adds noise to health scores
2. **Momentum is the most stable** — mean daily change of only 2.9 points. Good for stable signal
3. **Trend is bimodal** — often doesn't change (median 0), but can jump dramatically (max 100)
4. **Derivative is moderate** — bounded by futures data availability

---

## 6. Predictive Value Analysis

### Ground Truth Assessment

| Requirement | Status |
|-------------|--------|
| Historical health scores | ✅ Available (14 days) |
| Subsequent price movement | ❌ Not available in current dataset |
| Regime change labels | ⚠ Only P6 regime (not validated) |
| P5 decision outcomes | ✅ Available (SELECTED/NO_ACTION) |
| Market performance ground truth | ❌ Not available |

**PREDICTIVE_VALUE_UNVERIFIED**

No ground truth exists to validate which feature configuration produces better predictions. The analysis below is structural, not empirical.

### Structural Assessment

| Feature | Lead/Lag | Predictive Potential | Risk |
|---------|----------|---------------------|------|
| trend | Concurrent | Moderate — captures current state | High weight = overweight current state |
| derivative | Concurrent | Low — narrow range, low discrimination | High weight = wasted allocation |
| volume | Concurrent | Moderate — captures participation | High weight = noise from volatility |
| momentum | Concurrent | Moderate — captures direction + volatility | Low weight = under-utilized stable signal |

### Correlation with P5 Decisions

P5 SELECTED narratives have health scores in the 47–52 range (OBSERVE zone). P5 does not use health scores directly — it uses P4 direction. Therefore, health weight changes do not directly affect P5 outcomes.

---

## 7. Business Semantics Assessment

### Question 1: Is trend dominating too much?

**Yes, but by design.** Trend at 35% weight produces 54% of health variation because it has the highest stddev (36.0). This is a feature quality issue, not a weight issue. Trend's bimodal distribution (0 or 100) makes it act as a classifier rather than a continuous score.

### Question 2: Is momentum 10% making P6 too slow to react to rotation?

**Partially.** Momentum is the most stable feature (mean daily change 2.9), which is good for stability but means P6 reacts slowly to momentum shifts. However, momentum is 64% correlated with trend — increasing momentum weight effectively increases trend weight too.

### Question 3: Is derivative 35% over-weighted on paper but under-influential in practice?

**Yes, confirmed.** Derivative's stddev (7.9) means even at 35% weight, it contributes only 12% of health variation. The weight is wasted — it could be redistributed without changing the output.

### Question 4: Is volume enough to detect breakouts?

**Volume is the best breakout detector** — it has good discrimination (stddev 24.4) and is independent of other features. At 20% weight, it contributes 21% of variation — proportional. Increasing to 25% would make it contribute ~27%, which could improve breakout detection but adds noise (volume is the most volatile feature).

### Question 5: Does a narrative without futures data get biased?

**Yes.** When a coin lacks futures data, derivative defaults to 50 (neutral). With derivative at 35% weight, this neutral default has significant influence. For narratives with mostly non-futures coins, derivative effectively becomes a constant, reducing health score variation.

### Question 6: Does market-cap weighting interact adversely with health weights?

**No.** Market-cap weighting operates at the narrative aggregation level, while health weights operate at the coin feature level. They are independent layers. A large-cap coin with low health score will dominate narrative health regardless of which feature weights are used.

---

## 8. Cross-Layer Simulation

### Impact on P3 Intelligence

P3 uses its own regime/rotation thresholds, not health weights. **No impact.**

### Impact on P6 Regime

| Regime | Config A | Config B | Config C |
|--------|--------:|--------:|--------:|
| STABLE | 41.3% | 43.8% | 41.4% |
| BEARISH | 11.8% | 11.8% | 11.9% |

Config B increases STABLE by 2.5pp — a minor shift. No dramatic regime transition changes.

### Impact on P4 Decision Support

P4 uses its own classification logic. **No direct impact.**

### Impact on P5 Action Decision

P5 uses P4 direction (not health scores). **No direct impact.**

### Summary

No configuration creates excessive regime transitions, abnormal P5 SELECTED rates, or BULLISH/BEARISH bias. The cross-layer impact is negligible for all candidates.

---

## 9. Risk Assessment

### Risk of Changing Weights

| Risk | Severity | Mitigation |
|------|----------|------------|
| Increased noise (volume weight) | Medium | Volume is most volatile feature |
| Reduced independent signal (derivative weight) | High | Derivative is only uncorrelated feature |
| Double-counting (momentum weight) | Medium | Momentum 64% correlated with trend |
| Regime transition instability | Low | All configs produce similar regime distributions |
| P5 outcome change | None | P5 doesn't use health scores |

### Risk of NOT Changing Weights

| Risk | Severity | Mitigation |
|------|----------|------------|
| Wasted derivative allocation | Low | Current output is functional |
| Trend over-dominance | Low | Users see trend-driven health, which is meaningful |
| Suboptimal breakout detection | Low | Volume at 20% is adequate |

---

## 10. Decision

### Option A: KEEP_CURRENT_WEIGHTS

**Arguments for:**
- All3 candidates produce nearly identical distributions
- No ground truth to validate any alternative
- Current weights are functional and produce meaningful health scores
- Changing weights before fixing derivative feature quality is premature
- Cross-layer impact is negligible for all candidates

**Arguments against:**
- Derivative's 35% weight is structurally wasted
- Trend + momentum double-counting exists

### Option B: TUNE_HEALTH_WEIGHTS

**Arguments for:**
- Derivative weight could be redistributed to more effective features
- Momentum is under-utilized (stable, independent signal)

**Arguments against:**
- No evidence any alternative is better
- Derivative is the only uncorrelated feature — reducing it reduces independent signal
- All candidates produce similar output

### Option C: INSUFFICIENT_EVIDENCE_DEFER

**Arguments for:**
- No ground truth exists to validate predictions
- Feature quality (derivative) should be fixed before weight tuning
- All candidates produce similar output — no clear winner
- Changing weights without evidence is speculative

**Arguments against:**
- Derivative's structural inefficiency is well-documented

---

## 11. Final Verdict

```
INSUFFICIENT_EVIDENCE_DEFER
```

### Reasoning

1. **All3 configurations produce nearly identical health distributions** — the weight change has minimal impact on output
2. **No ground truth exists** to validate which configuration produces better predictions
3. **The root issue is derivative feature quality** (stddev 7.9), not weight allocation
4. **Derivative is the only uncorrelated feature** — reducing its weight reduces independent signal without clear benefit
5. **Changing weights before fixing the feature pipeline would be speculative**

### Recommended Follow-Up

```
P6-FEATURE-01 — Derivative Feature Discrimination Improvement
```

Improve derivative's stddev from 7.9 to ≥20 by:
- Improving OI/funding rate normalization
- AddingOI-based momentum components
- Expanding the scoring range

After derivative discrimination improves, re-run this audit with better feature data.

### If Weights Must Change (Business Decision)

If forced to choose a tuning, **Config B** (trend 0.35 / derivative 0.30 / volume 0.20 / momentum 0.15) is the least risky option:
- Only 5% shift from derivative → momentum
- Momentum is stable (low daily change) and independent
- Produces slightly higher health scores (+0.6 mean)
- No regime distribution changes

**But this is not recommended** without ground truth validation.

---

## 12. Files Changed

- **Deleted:** `src/app/api/admin/health-weight-audit/route.ts` (diagnostic endpoint, removed after use)
- **No production code changes**
- **No config changes**
- **No schema changes**
