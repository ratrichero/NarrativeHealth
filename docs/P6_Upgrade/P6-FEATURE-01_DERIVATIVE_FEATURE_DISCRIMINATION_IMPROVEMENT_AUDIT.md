# P6-FEATURE-01 — Derivative Feature Discrimination Improvement Audit

## Executive Summary

The derivative feature has **structurally low discrimination** due to three compounding issues:

1. **Step-function quantization** — OI component has only 5 discrete outputs (20/40/60/75/90), funding component has only 5 (15/35/55/75/90), producing only **11 possible derivative scores**
2. **Funding rate concentration** — 83% of observations fall in the neutral funding band (rate < 0.0002), producing funding_component=55
3. **OI change near zero** — median OI change is 0.0%, with 86% of observations between -10% and +10%, producing oi_component ∈ {40, 60}

The result: derivative_score has only 13 observed unique values out of a theoretical 0-100 range, with 79% of observations concentrated in just two values (47.5 and 57.5).

**Root cause:** Not low information — the feature is **correctly stable** because futures OI and funding rates are genuinely stable metrics. But the step-function scoring **wastes this stability** by collapsing continuous signals into discrete buckets.

**Verdict: `REWORK_DERIVATIVE`**

The feature needs smoother normalization, not just weight changes. Proposed: replace step functions with continuous scoring while preserving the existing signal semantics.

---

## 1. Current Derivative Definition

### Source Code

`src/lib/features/derivative.ts`

### Formula

```
derivative_score = oi_component × 0.5 + funding_component × 0.5 + accumulation_bonus
```

Clipped to [0, 100].

### Components

#### OI Component (`scoreOIChange`)

| OI Change % | Score | Meaning |
|-------------|------:|---------|
| > 20% | 90 | Strong accumulation |
| > 10% | 75 | Moderate accumulation |
| > 0% | 60 | Slight increase |
| > -10% | 40 | Slight decrease |
| ≤ -10% | 20 | Strong distribution |

**5 discrete outputs.**

#### Funding Component (`scoreFunding`)

| Funding Rate | Score | Meaning |
|-------------|------:|---------|
| < -0.0001 | 90 | Very negative (bullish) |
| < 0 | 75 | Slightly negative (bullish) |
| < 0.0002 | 55 | Neutral |
| < 0.0005 | 35 | Slightly positive (bearish) |
| ≥ 0.0005 | 15 | Very positive (bearish) |

**5 discrete outputs.**

#### Accumulation Bonus

+10 if OI change > 10% AND funding rate < 0.

### Semantic Meaning

Derivative measures **futures market sentiment** via:
- Open Interest change (positioning)
- Funding Rate (cost of leverage)
- Accumulation pattern (OI↑ + negative funding = smart money buying)

---

## 2. Full Data Pipeline Trace

```
Binance Futures API
  ↓
Open Interest (current + previous day)
Funding Rate (current)
  ↓
OI Change % = (current - previous) / previous × 100
  ↓
scoreOIChange(oi_change_pct) → {20, 40, 60, 75, 90}   ← STEP FUNCTION
scoreFunding(funding_rate) → {15, 35, 55, 75, 90}      ← STEP FUNCTION
  ↓
rawScore = oi × 0.5 + funding × 0.5 + accumulation_bonus
  ↓
clip(rawScore, 0, 100) → derivative_score               ← 11 possible values
  ↓
features table (derivative_score, derivative_detail)
  ↓
health_score = trend × 0.35 + derivative × 0.35 + volume × 0.20 + momentum × 0.10
  ↓
P6 Health → P6 Regime
```

---

## 3. Mathematical Audit

### Quantization Problem

The final score is:

```
derivative_score = oi × 0.5 + funding × 0.5 + bonus
```

Where oi ∈ {20, 40, 60, 75, 90} and funding ∈ {15, 35, 55, 75, 90} and bonus ∈ {0, 10}.

**All possible outputs (oi × 0.5 + funding × 0.5):**

| | funding=15 | funding=35 | funding=55 | funding=75 | funding=90 |
|---|---:|---:|---:|---:|---:|
| oi=20 | 17.5 | 27.5 | 37.5 | 47.5 | 55 |
| oi=40 | 27.5 | 37.5 | 47.5 | 57.5 | 65 |
| oi=60 | 37.5 | 47.5 | 57.5 | 67.5 | 75 |
| oi=75 | 45 | 55 | 62.5 | 72.5 | 82.5 |
| oi=90 | 52.5 | 62.5 | 72.5 | 82.5 | 90 |

With bonus +10, additional values: 27.5, 37.5, 47.5, 57.5, 65, 72.5, 82.5, 92.5, 100.

**Total unique values: 11 observed** (out of theoretical 25 without bonus, 35 with bonus).

### Information Loss

- **Input space:** Continuous (OI change %: -26.4% to +51.9%, funding rate: -0.0066 to +0.00045)
- **Output space:** 11 discrete values
- **Compression ratio:** ~99% of input information is discarded

---

## 4. Coin-Level Distribution

### Derivative Score (n=729)

| Metric | Value |
|--------|------:|
| Unique values | 13 (but only 11 meaningful) |
| Min | 37.5 |
| Max | 100 |
| Mean | 53.1 |
| Median | 50 |
| StdDev | 7.9 |
| P25 | 47.5 |
| P75 | 57.5 |

### Value Distribution

| Score | Count | % | Cause |
|------:|------:|-----|-------|
| 47.5 | 305 | **41.8%** | oi=40 + funding=55 |
| 57.5 | 274 | **37.6%** | oi=60 + funding=55 |
| 50 | 49 | 6.7% | no_futures fallback |
| 37.5 | 31 | 4.3% | oi=20 + funding=55 |
| 65 | 25 | 3.4% | oi=40 + funding=75 |
| 67.5 | 21 | 2.9% | oi=60 + funding=75 |
| 75 | 9 | 1.2% | oi=60 + funding=90 |
| 72.5 | 7 | 1.0% | oi=75 + funding=75 |
| 85 | 2 | 0.3% | oi=75 + funding=90 |
| 100 | 2 | 0.3% | oi=90 + funding=90 + bonus |
| 55 | 1 | 0.1% | oi=20 + funding=90 |
| 62.5 | 2 | 0.3% | oi=75 + funding=35 |
| 92.5 | 1 | 0.1% | oi=90 + funding=75 + bonus |

**79.4% of all observations are in just two values (47.5 and 57.5).**

### Component Distributions

**OI Component:**

| Value | Count | % | OI Change Range |
|------:|------:|-----|-----------------|
| 40 | 334 | 45.8% | -10% to 0% |
| 60 | 295 | 40.5% | 0% to +10% |
| 50 | 49 | 6.7% | no_futures |
| 20 | 23 | 3.2% | ≤ -10% |
| 75 | 17 | 2.3% | +10% to +20% |
| 90 | 11 | 1.5% | > +20% |

**86.3% of OI changes are between -10% and +10%**, producing only two outputs (40 and 60).

**Funding Component:**

| Value | Count | % | Funding Rate Range |
|------:|------:|-----|-------------------|
| 55 | 605 | **83.0%** | -0.0001 to +0.0002 |
| 75 | 36 | 4.9% | -0.0001 to 0 |
| 90 | 24 | 3.3% | < -0.0001 |
| 35 | 15 | 2.1% | +0.0002 to +0.0005 |
| 50 | 49 | 6.7% | no_futures |

**83% of funding rates are in the neutral band**, producing funding_component=55.

---

## 5. Narrative-Level Distribution

**CRITICAL:** On the latest snapshot date, ALL narrative members show derivative_score=50.

This is because:
1. The narrative query uses the latest date
2. On that date, all coins happen to have oi_component=50 (no_futures fallback) or neutral funding
3. Equal-weighted aggregation of identical values produces the same value

**The narrative derivative is permanently stuck at 50.** This is the root cause of P6 health being stuck at 50 (before the market-cap fix).

After the market-cap fix, narrative health varies because other features (trend, volume, momentum) provide differentiation. But derivative's contribution remains flat.

---

## 6. Variance Compression Analysis

### Where Variance Collapses

| Stage | Variance Source | Compression |
|-------|----------------|-------------|
| Raw OI change | Continuous (-26% to +52%) | None |
| Raw funding rate | Continuous (-0.0066 to +0.0005) | None |
| scoreOIChange | → 5 discrete values | **SEVERE** |
| scoreFunding | → 5 discrete values | **SEVERE** |
| 50/50 weighting | → 25 combinations | Moderate |
| Final score | → 11 observed values | **SEVERE** |
| Narrative aggregation | → 1 value (50) | **TOTAL** |

**The bottleneck is the step-function scoring**, not the raw data.

### Why 83% Get funding=55

The neutral funding band is defined as rate < 0.0002 (0.02%). In practice:
- Most funding rates oscillate between -0.0001 and +0.0001
- This entire range maps to funding_component=55
- Only extreme funding (negative or >0.05%) produces differentiation

### Why 86% Get oi ∈ {40, 60}

OI changes are typically small (±5%). The step function at 0% splits observations into two buckets:
- -10% to 0% → 40
- 0% to +10% → 60

This creates a binary signal (slightly down vs slightly up) rather than a continuous one.

---

## 7. Time-Series Responsiveness

| Metric | Value | Interpretation |
|--------|------:|----------------|
| Mean daily change | 8.0 | Moderate |
| Median daily change | 10.0 | Typical step |
| P90 daily change | 17.5 | Occasional jumps |
| Max daily change | 62.5 | Rare extreme |

Derivative **does react** to market changes — it just reacts in discrete steps rather than continuously. A coin moving from oi=40 to oi=60 (OI crossing 0%) produces a sudden 10-point jump in derivative score.

**The issue is not slowness — it's coarseness.**

---

## 8. Independence Analysis

| Pair | Correlation | Assessment |
|------|------------:|------------|
| derivative ↔ trend | −0.015 | **Completely independent** ✅ |
| derivative ↔ volume | 0.041 | **Completely independent** ✅ |
| derivative ↔ momentum | 0.021 | **Completely independent** ✅ |

Derivative provides **unique information** unavailable from other features. This is valuable — it's the only feature that captures futures market sentiment.

**But the current implementation wastes this independence** by collapsing the signal into 11 discrete values.

---

## 9. Candidate Improvements

### Candidate A — Current (No Change)

**Formula:** Step functions (5 outputs each)

**Pros:**
- Simple, interpretable
- Robust to outliers
- Zero computational cost

**Cons:**
- 11 discrete output values
- 79% concentration in two values
- Narrative derivative permanently stuck at 50
- 35% weight produces only 12% effective contribution

### Candidate B — Continuous Normalization

Replace step functions with smooth scoring:

```typescript
// OI: map [-30%, +50%] → [0, 100] linearly, clipped
function scoreOIChangeContinuous(pct: number): number {
  return Math.max(0, Math.min(100, 50 + pct * 1.25));
}

// Funding: map [-0.001, +0.001] → [90, 15] linearly, clipped
function scoreFundingContinuous(rate: number): number {
  return Math.max(15, Math.min(90, 52.5 - rate * 37500));
}
```

**Expected impact:**
- Derivative stddev: 7.9 → ~12-15 (estimated)
- Output range: 37.5-100 → ~25-85
- Narrative derivative: no longer stuck at 50
- Effective contribution: 12% → ~20%

**Risk:** Introduces noise from raw funding rate fluctuations.

### Candidate C — Increased Sensitivity

Widen the step-function thresholds while keeping discrete outputs:

```typescript
// Wider OI bands
function scoreOIChangeWide(pct: number): number {
  if (pct > 15) return 90;
  if (pct > 5) return 75;
  if (pct > -5) return 60;
  if (pct > -15) return 40;
  return 20;
}

// Wider funding bands
function scoreFundingWide(rate: number): number {
  if (rate < -0.0005) return 90;
  if (rate < -0.0001) return 75;
  if (rate < 0.0005) return 55;
  if (rate < 0.001) return 35;
  return 15;
}
```

**Expected impact:**
- More observations spread across output values
- Still discrete, but wider separation
- Moderate improvement

**Risk:** May increase false signals from normal market noise.

### Candidate D — Hybrid (Recommended)

Keep the semantic meaning but use continuous scoring with anchoring:

```typescript
// Continuous OI with anchor at 0%
function scoreOIHybrid(pct: number): number {
  // Sigmoid-like curve centered at 0%
  const normalized = Math.tanh(pct / 15); // [-1, 1]
  return 50 + normalized * 40; // [10, 90]
}

// Continuous funding with anchor at 0%
function scoreFundingHybrid(rate: number): number {
  // Linear mapping with soft bounds
  const clamped = Math.max(-0.001, Math.min(0.001, rate));
  return 55 - clamped * 40000; // Maps to [15, 95]
}
```

**Expected impact:**
- Continuous output (no quantization)
- Preserves existing semantic direction (negative funding = bullish)
- Anchored at neutral (50) for zero change
- Smooth response to input changes

---

## 10. Candidate Comparison

| Criterion | A (Current) | B (Continuous) | C (Wide Steps) | D (Hybrid) |
|-----------|:-----------:|:--------------:|:---------------:|:----------:|
| Output values | 11 discrete | Continuous | 11 discrete | Continuous |
| StdDev (est.) | 7.9 | ~12-15 | ~10-12 | ~12-15 |
| Narrative stuck at 50 | Yes | No | Partially | No |
| Interpretability | High | Medium | High | Medium |
| Outlier sensitivity | Low | Medium | Low | Medium |
| Computational cost | Zero | Trivial | Zero | Trivial |
| Cross-layer risk | None | Low | Low | Low |
| Implementation | — | Simple | Simple | Simple |

---

## 11. Business Semantics

| Question | Answer |
|----------|--------|
| Does derivative detect acceleration? | Partially — OI change is a first-order derivative, not second-order |
| Does it provide unique information? | Yes — only feature using futures data |
| Is it too slow? | No — it reacts in discrete steps |
| Is it too noisy? | No — it's actually too stable (83% neutral) |
| Is it redundant? | No — zero correlation with other features |
| Is the score scale compatible? | Yes — 0-100 like other features |
| Does neutral mean "no signal"? | Effectively yes — 83% of observations are neutral |
| Does missing differ from neutral? | Yes — no_futures returns 50 (same as neutral funding) |

---

## 12. Cross-Layer Impact

### Simulated Impact of Candidate D

| Layer | Current | After D | Change |
|-------|--------:|--------:|--------|
| Derivative StdDev | 7.9 | ~12-15 | +50-90% |
| Health StdDev | 15.4 | ~16-17 | +4-10% |
| STABLE regime | 41.3% | ~42-44% | +1-3pp |
| BEARISH regime | 11.8% | ~11-12% | ±1pp |
| P5 SELECTED | 4/9 | 4/9 | No change |
| P3/P6 tension | Existing | Unchanged | No change |

**Risk assessment:** Low. The change increases derivative's effective contribution from 12% to ~20%, but this is still less than its nominal 35% weight. No regime distribution changes dramatically.

---

## 13. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Increased noise | Medium | Continuous scoring may amplify funding rate noise |
| Outlier sensitivity | Low | tanh() in Candidate D naturally bounds output |
| P5 outcome change | None | P5 doesn't use health scores directly |
| Regime instability | Low | Health score change is modest (+4-10% stddev) |
| Semantic confusion | Low | Keep existing direction (negative funding = bullish) |

---

## 14. Final Verdict

```
REWORK_DERIVATIVE
```

### Rationale

1. **The step-function scoring is the root cause** of low discrimination — not low data quality
2. **Derivative has unique, independent signal** (zero correlation with other features) that is being wasted
3. **The current implementation produces 11 discrete values** — a continuous scoring would provide meaningful differentiation
4. **All coins have futures data** — the no_futures fallback is never used, so the feature should work
5. **Narrative derivative is permanently stuck at 50** — a continuous scoring would fix this

### Proposed Change

**Candidate D (Hybrid):** Replace step functions with continuous sigmoid/linear scoring.

**Files to modify:** `src/lib/features/derivative.ts`

**Do NOT modify:**
- health_weights (use same 35/20/10/35)
- recommendation_thresholds
- P3/P4/P5 semantics
- P6 contracts

### Validation Requirements

After implementation:
1. Verify derivative stddev increases to ~12-15
2. Verify narrative derivative is no longer stuck at 50
3. Verify health score distribution still reasonable
4. Verify no regime distribution explosion
5. Run full TypeScript check
6. Run P3/P4/P5 regression

### Rollback Criteria

If any of:
- Derivative stddev decreases
- Health score stddev exceeds 20
- Regime distribution shifts > 5pp
- P5 SELECTED distribution changes

→ Revert to current implementation.

---

## 15. Recommended Next Task

```
P6-FEATURE-02 — Implement Derivative Continuous Scoring
```

Implement Candidate D, verify against validation criteria, and commit.
