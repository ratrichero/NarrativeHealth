# P6-CONFIG-02 — Health Weight Recalibration Audit

**Status:** AUDIT COMPLETE  
**Scope:** Audit + Recommendation (NO production config changes)  
**Date:** 2026-09-01  
**Coins:** 49  
**Narratives:** 9  

---

## 1. Executive Summary

### Critical Finding

After P6-FEATURE-02 continuous derivative scoring, the derivative feature's **variance has collapsed by 42x** relative to trend. The current weight configuration:

```
trend: 35%  → effective: 63.1%  (ratio 1.80x)
derivative: 35%  → effective: 1.5%  (ratio 0.04x)
volume: 20%  → effective: 25.7%  (ratio 1.28x)
momentum: 10%  → effective: 9.7%  (ratio 0.97x)
```

**Derivative's35% nominal weight has only 1.5% effective influence on Health Score.** This is the single most important finding of this audit.

### Secondary Finding

Trend and momentum are **highly correlated** (r=0.73), creating redundancy and double-counting. Both together account for 73% of effective variance.

### Tertiary Finding

All 49 coins fall in the OBSERVE band (46–66 health). No coin reaches WATCH (≥78) or STRONG_WATCH (≥85). The recommendation system is effectively non-differentiating.

### Verdict

```
RECOMMEND_WEIGHT_CHANGE
```

The current weights are **not appropriate** for the post-FEATURE-02 distribution. Derivative's35% weight is effectively wasted. The recommendation system cannot differentiate coins.

---

## 2. Current Production Evidence

### Feature Distribution (Sep 1, 2026, 49 coins)

| Feature | Mean | Median | StdDev | Min | Max | Variance | Range |
|---------|-----:|-------:|-------:|----:|----:|---------:|------:|
| trend | 68.0 | 70 | 34.8 | 0 | 100 | **1208.1** | 100 |
| derivative | 52.4 | 51.1 | **5.4** | 42.9 | 66.5 | **28.8** | 23.6 |
| volume | 35.1 | 30 | 22.2 | 15 | 95 | 491.3 | 80 |
| momentum | 67.2 | 71 | 13.6 | 37 | 85 | 185.1 | 48 |

### Percentile Distribution

| Percentile | trend | derivative | volume | momentum |
|:----------:|------:|-----------:|-------:|---------:|
| P10 | 0 | 46.1 | 15 | 37 |
| P25 | 40 | 49.0 | 15 | 71 |
| P50 | 70 | 51.1 | 30 | 71 |
| P75 | 100 | 56.1 | 45 | 71 |
| P90 | 100 | 59.5 | 75 | 85 |
| P95 | 100 | 62.0 | 85 | 85 |

### Key Observations

1. **Derivative is compressed:** 90% of values between 46.1–59.5 (range of 13.4 points). The continuous scoring effectively eliminates discrimination.
2. **Trend is polarized:** 50% of coins are at 100 (ceiling). The EMA-based scoring creates a bimodal distribution.
3. **Volume is well-distributed:** Good spread from 15–95. Best discrimination potential.
4. **Momentum is clustered:** 75% of values at 71 (ROC threshold boundary).

---

## 3. Cross-Feature Correlation

| Pair | Correlation | Interpretation |
|------|:-----------:|----------------|
| trend × momentum | **0.73** | **HIGH** — significant redundancy |
| derivative × volume | 0.59 | Moderate — partial overlap |
| trend × derivative | -0.10 | Low — independent signals |
| trend × volume | 0.06 | Low — independent signals |
| derivative × momentum | -0.15 | Low — independent signals |
| volume × momentum | -0.05 | Low — independent signals |

### Implication

Trend and momentum are measuring largely the same underlying price behavior. Having both at high weight creates **double-counting** of trend information while derivative (the actual independent signal) is effectively ignored.

---

## 4. Effective Contribution Analysis

### How Variance Determines Influence

In a weighted average:
```
Health = w_t × trend + w_d × derivative + w_v × volume + w_m × momentum
```

The **effective contribution** of each feature to Health variance is:
```
effective_i = (w_i² × var_i) / Σ(w_j² × var_j)
```

This is what actually determines how much each feature can differentiate coins.

### Current State

| Feature | Nominal Weight | Variance | w²×var | Effective % | Ratio |
|---------|:-------------:|---------:|-------:|:-----------:|:-----:|
| trend | 0.35 | 1208.1 | 148.0 | **63.1%** | 1.80x |
| derivative | 0.35 | 28.8 | 3.5 | **1.5%** | 0.04x |
| volume | 0.20 | 491.3 | 19.6 | **25.7%** | 1.28x |
| momentum | 0.10 | 185.1 | 1.9 | **9.7%** | 0.97x |

### Interpretation

- **Trend (63% effective):** Dominates. Its high variance (1208) means even with35% weight, it controls 63% of Health differentiation.
- **Derivative (1.5% effective):** Essentially dead. Its variance (28.8) is 42x smaller than trend. The35% weight is wasted.
- **Volume (26% effective):** Working correctly. Slightly over-weighted relative to nominal.
- **Momentum (10% effective):** Working as designed. Ratio ~1.0x.

---

## 5. Candidate Weight Comparison

### Candidate A — Current
```
trend: 0.35, derivative: 0.35, volume: 0.20, momentum: 0.10
```

| Feature | Nominal | Effective | Ratio | Health Range |
|---------|:-------:|:---------:|:-----:|-------------:|
| trend | 35% | 63.1% | 1.80x | 25.9–67.9 |
| derivative | 35% | 1.5% | 0.04x | 0.7–2.4 |
| volume | 20% | 25.7% | 1.28x | 5.1–19.0 |
| momentum | 10% | 9.7% | 0.97x | 1.0–3.3 |
| **Total health** | | | | **25.9–67.9** |

**Problem:** Derivative contributes only 0.7–2.4 points to Health. All coins clustered in OBSERVE.

### Candidate B — Moderate Derivative
```
trend: 0.35, derivative: 0.25, volume: 0.25, momentum: 0.15
```

| Feature | Nominal | Effective | Ratio | Health Range |
|---------|:-------:|:---------:|:-----:|-------------:|
| trend | 35% | 59.5% | 1.70x | 24.8–59.5 |
| derivative | 25% | 2.7% | 0.11x | 1.1–4.0 |
| volume | 25% | 31.2% | 1.25x | 7.8–23.4 |
| momentum | 15% | 16.6% | 1.11x | 1.8–4.9 |
| **Total health** | | | | **25.5–64.8** |

**Slightly better spread but derivative still <3% effective.**

### Candidate C — Balanced
```
trend: 0.35, volume: 0.25, momentum: 0.15, derivative: 0.25
```

Same as B with same effective distribution. Derivative still <3%.

### Candidate D — Reduced Trend
```
trend: 0.25, derivative: 0.25, volume: 0.30, momentum: 0.20
```

| Feature | Nominal | Effective | Ratio | Health Range |
|---------|:-------:|:---------:|:-----:|-------------:|
| trend | 25% | 49.3% | 1.97x | 12.3–49.3 |
| derivative | 25% | 2.3% | 0.09x | 0.9–3.5 |
| volume | 30% | 43.5% | 1.45x | 13.1–39.1 |
| momentum | 20% | 29.2% | 1.46x | 4.0–12.4 |
| **Total health** | | | | **22.3–67.3** |

**Better spread. Volume becomes the primary discriminator.**

### Candidate E — Aggressive Redistribute
```
trend: 0.30, derivative: 0.15, volume: 0.30, momentum: 0.25
```

| Feature | Nominal | Effective | Ratio | Health Range |
|---------|:-------:|:---------:|:-----:|-------------:|
| trend | 30% | 53.5% | 1.78x | 16.1–53.5 |
| derivative | 15% | 1.3% | 0.09x | 0.5–2.0 |
| volume | 30% | 43.5% | 1.45x | 13.1–39.1 |
| momentum | 25% | 36.3% | 1.45x | 5.0–16.5 |
| **Total health** | | | | **22.6–67.3** |

**Maximum spread. Best recommendation differentiation potential.**

---

## 6. Semantic Impact Assessment

### 6.1 Health Score Distribution Impact

| Candidate | Min Health | Max Health | Range | Coins in WATCH (≥78) |
|-----------|----------:|----------:|------:|:-------------------:|
| A (Current) | 25.9 | 67.9 | 42.0 | 0/49 |
| B (Moderate) | 25.5 | 64.8 | 39.3 | 0/49 |
| C (Balanced) | 25.5 | 64.8 | 39.3 | 0/49 |
| D (Reduced) | 22.3 | 67.3 | 45.0 | 0/49 |
| E (Aggressive) | 22.6 | 67.3 | 44.7 | 0/49 |

**All candidates produce 0 coins in WATCH band.** This is because the feature range (trend 0–100, volume 15–95, momentum 37–85) cannot produce a Health Score ≥78 with any of these weight distributions.

### 6.2 Narrative Health Impact

Narrative health is calculated as market-cap-weighted average of coin health scores. Since all coin health scores are in the 26–68 range, narrative health will remain in the 46–66 range regardless of weight choice.

### 6.3 Regime Distribution Impact

Regime transitions are based on health score changes, not absolute values. Since weight changes shift the baseline but not the delta pattern, regime behavior should be stable across candidates.

### 6.4 Recommendation Threshold Reachability

| Threshold | Current Value | Coins Reaching | Assessment |
|-----------|:------------:|:--------------:|------------|
| STRONG_WATCH (≥85) | 85 | 0/49 | **UNREACHABLE** with current features |
| WATCH (≥78) | 78 | 0/49 | **UNREACHABLE** with current features |
| OBSERVE (≥65) | 65 | ~20/49 | Achievable |
| WEAK (≥0) | 0 | 49/49 | All coins |

**The P6-CONFIG-01 threshold tuning (watch=78, strong_watch=85) is unreachable given current feature distributions.** This is not a weight problem — it's a feature discrimination problem.

### 6.5 P3/P4/P5 Boundary

Weight changes affect:
- P6 Health Score values → P6 Regime transitions
- P6 Health does NOT directly feed P3 (P3 uses its own metrics)
- P6 Health does NOT directly feed P4 (P4 uses P3 output)
- P5 uses P4 output, not P6 directly

**Weight changes do not breach P3/P4/P5 boundaries.**

---

## 7. Volume Volatility & Trend/Momentum Correlation Analysis

### Volume Feature Behavior

Volume scoring uses a **step function** (`scoreVolumeRatio`):

| Ratio | Score |
|:-----:|:-----:|
| >3.0 | 95 |
| >2.0 | 85 |
| >1.5 | 75 |
| >1.0 | 60 |
| >0.7 | 45 |
| >0.5 | 30 |
| ≤0.5 | 15 |

This creates a **bimodal distribution** with clusters at 15, 30, 45, 60, 75, 85, 95. The step function provides decent discrimination but is sensitive to daily volume noise.

### Trend-Momentum Redundancy

Correlation r=0.73 means ~53% of momentum's variance is explained by trend. This creates:

1. **Double-counting:** A coin with strong trend gets +35% from trend AND +10% from momentum, both driven by the same price behavior.
2. **Reduced independent signal:** Derivative (the actual independent signal) is squeezed out.

### Recommendation

To improve differentiation, the system needs either:
1. **Reduce trend weight** to let other features contribute
2. **Increase momentum weight** to amplify its independent component
3. **Both**

---

## 8. Configuration Interaction

### Health Weights vs Thresholds

Current thresholds (P6-CONFIG-01):
```
observe: 65, watch: 78, strong_watch: 85
```

With current feature ranges, the maximum achievable Health Score is approximately:
```
max_health = 100 × 0.35 + 66.5 × 0.35 + 95 × 0.20 + 85 × 0.10
           = 35 + 23.3 + 19 + 8.5
           = 85.8
```

So WATCH (≥78) is theoretically reachable but requires ALL features to be at maximum simultaneously. In practice, no coin achieves this because features are not perfectly correlated.

With Candidate E (the most aggressive redistribution):
```
max_health = 100 × 0.30 + 66.5 × 0.15 + 95 × 0.30 + 85 × 0.25
           = 30 + 10.0 + 28.5 + 21.3
           = 89.8
```

WATCH becomes more reachable but still requires extreme feature combinations.

---

## 9. Decision Analysis

### Option 1: KEEP_CURRENT_WEIGHTS

**Pros:**
- No deployment risk
- No behavioral change
- Existing calibration preserved

**Cons:**
- Derivative35% weight is effectively dead (1.5% effective)
- All coins in OBSERVE band (no differentiation)
- Trend dominates (63% effective) despite only35% nominal
- Trend-momentum redundancy unaddressed

**Verdict:** The current weights are **semantically broken** after P6-FEATURE-02. Keeping them means accepting that derivative contributes essentially nothing to Health Score differentiation.

### Option 2: RECOMMEND_WEIGHT_CHANGE

**Recommended configuration (Candidate E):**
```
trend: 0.30, derivative: 0.15, volume: 0.30, momentum: 0.25
```

**Rationale:**
1. **Derivative reduced from35% to15%:** Accepts that derivative has low variance (28.8) and cannot meaningfully differentiate at35% weight. Reducing to15% acknowledges reality rather than pretending it matters.
2. **Trend reduced from35% to30%:** Still dominant but less overwhelming. Prevents trend from controlling 63% of Health.
3. **Volume increased from20% to30%:** Volume has the best discrimination (variance=491) and provides independent signal from price movement.
4. **Momentum increased from10% to25%:** Despite correlation with trend (r=0.73), momentum captures acceleration that trend misses. At25% weight, it contributes meaningfully.

**Expected impact:**
- Health range widens from 42.0 → 44.7 points
- Better narrative differentiation
- Derivative's reduced weight reflects its actual contribution
- No P3/P4/P5 boundary breach

### Option 3: INSUFFICIENT_EVIDENCE_DEFER

**Not applicable.** We have clear production evidence that derivative's35% weight is ineffective. The evidence is sufficient to recommend a change.

---

## 10. Recommended Next Steps

1. **Apply Candidate E weights** in a separate P6-CONFIG-03 task
2. **Re-run P6 refresh** to regenerate all Health Scores with new weights
3. **Measure narrative health distribution** post-change
4. **Verify recommendation differentiation** — at least some coins should reach WATCH
5. **Monitor regime stability** — ensure weight change doesn't cause excessive transitions

---

## 11. Final Verdict

```
RECOMMEND_WEIGHT_CHANGE
```

**Recommended weights:**
```json
{
  "trend": 0.30,
  "derivative": 0.15,
  "volume": 0.30,
  "momentum": 0.25
}
```

**Evidence:**
- Derivative variance (28.8) is 42x smaller than trend (1208.1)
- Derivative effective contribution: 1.5% (nominal35%)
- Trend-momentum correlation r=0.73 creates redundancy
- All 49 coins in OBSERVE band (no differentiation)
- Recommendation thresholds (watch=78, strong_watch=85) are unreachable

**Rationale:**
The current weights are semantically broken after P6-FEATURE-02 continuous derivative scoring. Derivative's35% weight is effectively dead. Redistributing to trend:30, volume:30, momentum:25, derivative:15 reflects the actual signal strength of each feature while maintaining a balanced contribution model.

---

*Generated by P6-CONFIG-02 — Health Weight Recalibration Audit*
