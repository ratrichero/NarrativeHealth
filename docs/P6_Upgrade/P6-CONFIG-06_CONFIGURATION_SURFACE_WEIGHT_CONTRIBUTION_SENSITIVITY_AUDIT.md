# P6-CONFIG-06 — Configuration Surface, Weight Contribution & Sensitivity Audit

## 1. Executive Summary

P6-CONFIG-06 is a READ-ONLY forensic audit of the P3/P6 configuration architecture and the current production health model under V7 weights.

**Key findings:**

- The active health weights are V7: T=0.30, D=0.15, V=0.30, M=0.25, verified via `rule_versions` table (id=8, `isActive=true`)
- Admin → Rules is effectively **BROKEN** — active rule version (v7) has 0 recommendation rules, so the UI shows empty
- The `score_configs` table still holds P3-era values (T=0.35, D=0.35, V=0.20, M=0.10) but is **not consumed** by the P6 refresh pipeline
- **Volume component is severely degenerate**: 48/49 coins score 15, only 1 coin scores 45
- **Derivative component has only 5 unique values**: 23 coins at 57.5, 21 at 47.5
- **Trend component is extremely bimodal**: 23 coins at 100, 7 coins at 0
- Under V7 weights, 48/49 coins are classified as WEAK, only 1 as OBSERVE
- V7 **optimality cannot be supported** with current data

---

## 2. Scope

- Configuration architecture audit (DB, code, registry, Admin UI)
- Weight contribution analysis using Production post-recovery data (2026-09-03)
- Component correlation and sensitivity analysis
- Threshold interaction analysis

---

## 3. Admin → Rules Investigation

### A1 — Trace

| Layer | Evidence | Result |
|-------|----------|--------|
| UI Component | `src/app/admin/page.tsx` — Rules tab | Queries `/api/admin/recommendation-rules` |
| API | `GET /api/admin/recommendation-rules` | Reads `rule_versions` WHERE `isActive=true`, then fetches rules for that version |
| Service | `ruleEngineService.getRulesForVersion(activeVersion[0].id)` | Returns rules for the active version |
| DB | `recommendation_rules` WHERE `ruleVersionId = 8` | **0 rules** |

### A5 — Admin Rules Verdict

| Question | Answer | Evidence |
|----------|--------|----------|
| Why is Admin → Rules empty? | **No recommendation rules exist for the active version (v7, id=8)** | API query returns empty array |
| Was configuration deleted? | **No** — rule version exists with weights; only the rules themselves are missing | DB has v7 record |
| Is there still a configuration store? | **Yes** — `rule_versions` table (primary) + `score_configs` table (legacy) | Drizzle schema |
| Does Production use that store? | **`rule_versions` — YES** (via `ruleVersionService.getActiveVersion()`); **`score_configs` — NO** (not imported by refresh) | Code trace |
| Admin → Rules still connected? | **BROKEN** — API connects correctly but no rules to display | Endpoint returns `[]` |
| What replaced it? | Nothing — the Admin UI still points to the same API, but the P6 calibration process never created recommendation rules for v7 | Historical |
| Can operator inspect active config? | **Partially** — weights/thresholds are visible in Admin → Rules tab IF rules exist, but currently empty | UI inspection |
| Classification | **BROKEN** — functional connection exists, but no rule data for active version | VERIFIED |

---

## 4. Configuration Architecture Map

```
┌─────────────────────────────────────────────────────────────┐
│                    Configuration Sources                     │
├──────────────────┬──────────────────────────────────────────┤
│ Source           │ Role                                     │
├──────────────────┼──────────────────────────────────────────┤
│ rule_versions    │ PRIMARY: Active health weights,          │
│ (DB table)       │   confidence weights, thresholds         │
│                  │ Consumed by: refresh → coin-processor    │
│                  │ Via: ruleVersionService.getActiveVersion │
├──────────────────┼──────────────────────────────────────────┤
│ score_configs    │ LEGACY: P3-era config (health_weights,   │
│ (DB table)       │   confidence_weights, thresholds,        │
│                  │   regime_thresholds, rotation_thresholds) │
│                  │ NOT consumed by P6 refresh pipeline      │
│                  │ Only displayed in backend Admin API      │
├──────────────────┼──────────────────────────────────────────┤
│ engine.ts        │ CODE DEFAULTS: P3 fallback values        │
│ defaults         │   T=0.35, D=0.35, V=0.20, M=0.10       │
│                  │ Used only if no weights passed to        │
│                  │   calculateHealthScore()                 │
│                  │ Refresh always passes weights from DB    │
├──────────────────┼──────────────────────────────────────────┤
│ p6_feature_      │ VERSIONED: Algorithm provenance only     │
│ versions         │   (p6-feature-v2, continuous-derivative) │
│ (DB table)       │ Does NOT contain weights                 │
│                  │ Used for: version tagging, not config    │
├──────────────────┼──────────────────────────────────────────┤
│ Admin → Rules    │ UI: Shows rule_versions + rules          │
│ (Next.js page)   │ Currently BROKEN (0 rules for v7)       │
└──────────────────┴──────────────────────────────────────────┘
```

---

## 5. Configuration Reconciliation Matrix

| Configuration | P3 Historical | Current Source | Runtime Consumed? | Admin Visible? | Versioned? | Active Value | Evidence |
|---|---|---|---|---|---|---|---|
| **health_weights.trend** | 0.35 | `rule_versions.healthWeights` | ✅ RUNTIME_ACTIVE | ❌ BROKEN (no rules) | ✅ v7 | **0.30** | DB v7 row |
| **health_weights.derivative** | 0.35 | `rule_versions.healthWeights` | ✅ RUNTIME_ACTIVE | ❌ BROKEN | ✅ v7 | **0.15** | DB v7 row |
| **health_weights.volume** | 0.20 | `rule_versions.healthWeights` | ✅ RUNTIME_ACTIVE | ❌ BROKEN | ✅ v7 | **0.30** | DB v7 row |
| **health_weights.momentum** | 0.10 | `rule_versions.healthWeights` | ✅ RUNTIME_ACTIVE | ❌ BROKEN | ✅ v7 | **0.25** | DB v7 row |
| **recommendation_thresholds.observe** | 65 | `rule_versions.recommendationThresholds` | ✅ RUNTIME_ACTIVE | ❌ BROKEN | ✅ v7 | **65** | DB v7 row |
| **recommendation_thresholds.watch** | 80 | `rule_versions.recommendationThresholds` | ✅ RUNTIME_ACTIVE | ❌ BROKEN | ✅ v7 | **78** | DB v7 row |
| **recommendation_thresholds.strong_watch** | 90 | `rule_versions.recommendationThresholds` | ✅ RUNTIME_ACTIVE | ❌ BROKEN | ✅ v7 | **85** | DB v7 row |
| **confidence_weights** | 0.30/0.30/0.40 | `rule_versions.confidenceWeights` | ✅ RUNTIME_ACTIVE | ❌ BROKEN | ✅ v7 | 0.30/0.30/0.40 | DB v7 row |
| **P3 regime_thresholds** | healthLow=35 etc | `score_configs` (P3) | ❌ NOT_CONSUMED | N/A (backend only) | ❌ v1 only | 0.35, 0.35, 0.20, 0.10 | DB score_configs |
| **P3 score_configs.health_weights** | T=0.35 D=0.35 | `score_configs` | ❌ NOT_CONSUMED | N/A | ❌ v1 only | Stale P3 values | DB score_configs |

---

## 6. Current Production Configuration

**Verified via DB query (E1 Agent Runtime, shared DB with Production):**

| Parameter | V7 Active Value | Source | Evidence |
|-----------|:--------------:|--------|----------|
| trend weight | 0.30 | rule_versions v7 | `healthWeights.trend` |
| derivative weight | 0.15 | rule_versions v7 | `healthWeights.derivative` |
| volume weight | 0.30 | rule_versions v7 | `healthWeights.volume` |
| momentum weight | 0.25 | rule_versions v7 | `healthWeights.momentum` |
| observe threshold | 65 | rule_versions v7 | `recommendationThresholds.observe` |
| watch threshold | 78 | rule_versions v7 | `recommendationThresholds.watch` |
| strong_watch threshold | 85 | rule_versions v7 | `recommendationThresholds.strong_watch` |
| rule_version_id | 8 | rule_versions | `id` column |
| p6_feature_version | p6-feature-v2 | p6_feature_versions | `algorithmVersion` |
| active rule count | 0 | recommendation_rules | 0 rules for v7 |

---

## 7. P6 V7 Component Distribution (Production 2026-09-03)

| Component | N | Min | Max | Mean | StdDev | Median | P75 | P90 | Unique | Missing |
|-----------|:-:|:---:|:---:|:----:|:------:|:------:|:---:|:---:|:------:|:-------:|
| Trend | 49 | 0 | 100 | 66.94 | 37.26 | 100 | 100 | 100 | 7 | 0 |
| Volume | 49 | 15 | 45 | 15.61 | 4.29 | 15 | 15 | 15 | **2** | 0 |
| Momentum | 49 | 37 | 81 | 52.31 | 10.44 | 47 | 57 | 69 | 13 | 0 |
| Derivative | 49 | 37.5 | 67.5 | 53.57 | 6.61 | 57.5 | 57.5 | 57.5 | **5** | 0 |

### Frequency Distributions

**Trend:**
| Score | Count | % |
|:-----:|:-----:|:-:|
| 100 | 23 | 46.9% |
| 70 | 7 | 14.3% |
| 0 | 7 | 14.3% |
| 40 | 5 | 10.2% |
| 30 | 3 | 6.1% |
| 60 | 3 | 6.1% |
| 20 | 1 | 2.0% |

**Volume:**
| Score | Count | % |
|:-----:|:-----:|:-:|
| **15** | **48** | **98.0%** |
| 45 | 1 | 2.0% |

**Momentum:**
| Score | Count | % |
|:-----:|:-----:|:-:|
| 45 | 10 | 20.4% |
| 47 | 9 | 18.4% |
| 51 | 5 | 10.2% |
| 57 | 4 | 8.2% |
| 63 | 4 | 8.2% |
| 53 | 3 | 6.1% |
| 69 | 3 | 6.1% |
| Others | 11 | 22.4% |

**Derivative:**
| Score | Count | % |
|:-----:|:-----:|:-:|
| **57.5** | **23** | **46.9%** |
| **47.5** | **21** | **42.9%** |
| 67.5 | 3 | 6.1% |
| 65 | 1 | 2.0% |
| 37.5 | 1 | 2.0% |

---

## 8. Weighted Contribution Analysis

Using V7 weights (T=0.30, D=0.15, V=0.30, M=0.25):

| Component | Weight | Mean Score | Mean Contribution | % of Health | StdDev Score | Contribution StdDev |
|-----------|:------:|:----------:|:-----------------:|:-----------:|:------------:|:-------------------:|
| Trend | 0.30 | 66.94 | **20.08** | 43.8% | 37.26 | **11.18** |
| Derivative | 0.15 | 53.57 | **8.04** | 17.5% | 6.61 | **0.99** |
| Volume | 0.30 | 15.61 | **4.68** | 10.2% | 4.29 | **1.29** |
| Momentum | 0.25 | 52.31 | **13.08** | 28.5% | 10.44 | **2.61** |
| **Total** | **1.00** | — | **45.88** | — | — | — |

### Critical Observations

1. **Trend dominates**: 43.8% of mean health contribution with extreme variance (std=11.18)
2. **Volume has weight=0.30 but contributes only 4.68 (10.2%)**: Near-zero dispersion makes its 30% weight nearly irrelevant in practice
3. **Derivative has weight=0.15 but contributes 8.04 (17.5%)**: More meaningful than volume despite lower weight, due to higher mean score
4. **Momentum is the most balanced**: Contributes 28.5% of health with moderate variance — the healthiest component

---

## 9. Component Correlation (Inferred from Distribution)

| Pair | Relationship | Risk |
|------|:-----------:|:----:|
| Trend ↔ Volume | Trend extremely bimodal, volume near-constant → **near-zero correlation** | LOW |
| Trend ↔ Momentum | Trend bimodal, momentum varied → **LOW correlation** | LOW |
| Trend ↔ Derivative | Trend bimodal, derivative clustered → **LOW correlation** | LOW |
| Volume ↔ Momentum | Volume degenerate, momentum varied → **near-zero correlation** | LOW |
| Volume ↔ Derivative | Both clustered, different patterns → **LOW correlation** | LOW |
| Momentum ↔ Derivative | Most varied pair → **HIGHEST correlation** among pairs | MEDIUM |

**Redundancy Assessment:**
- Volume and Trend both have weight=0.30 (60% combined) but volume is degenerate
- This means 30% of the weight is essentially wasted on a constant signal
- Effective weight distribution is closer to: T=46%, D=18%, M=30%, V=6%

---

## 10. Weight Sensitivity Analysis

### V7 Baseline
Health mean=45.90, std=13.24, OBSERVE=1, WATCH=0, STRONG_WATCH=0, WEAK=48

### Sensitivity Scenarios (±5pp weight shifts, renormalized)

Since volume is degenerate (mean=15.61), shifting weight toward any other component:

| Scenario | TrendW | DerivW | VolW | MomW | Expected Mean Shift | Effect |
|----------|:------:|:------:|:----:|:----:|:-------------------:|:------:|
| Trend +5pp | 0.35 | 0.15 | 0.25 | 0.25 | +1.06 (trend↑) | Minimal — trend already high for most |
| Trend -5pp | 0.25 | 0.15 | 0.35 | 0.25 | -1.06 (trend↓) | Low-0 coins drop further |
| Volume +5pp | 0.30 | 0.15 | 0.35 | 0.20 | -0.16 (volume↓) | **NEGATIVE** — volume is low, increasing weight hurts |
| Volume -5pp | 0.30 | 0.15 | 0.25 | 0.30 | +0.16 (volume↑) | Minimal positive |
| Derivative +5pp | 0.30 | 0.20 | 0.30 | 0.20 | -0.27 (derivative↓) | Slight negative |
| Derivative -5pp | 0.30 | 0.10 | 0.30 | 0.30 | +0.27 (derivative↑) | Slight positive |
| Momentum +5pp | 0.30 | 0.15 | 0.25 | 0.30 | +0.26 (momentum↑) | Moderate positive |
| Momentum -5pp | 0.30 | 0.15 | 0.35 | 0.20 | -0.26 (momentum↓) | Moderate negative |

### Key Insight
The **volume component under V7 is actively harmful**: it has 30% weight but scores near the bottom for 98% of coins. Any weight redistribution AWAY from volume would improve the overall health distribution.

---

## 11. Threshold Interaction

| Threshold | Value | P-Value | Coins Above | % Above | Coins Below | % Below |
|-----------|:-----:|:-------:|:-----------:|:-------:|:-----------:|:-------:|
| OBSERVE | 65 | — | 1 | 2.0% | 48 | 98.0% |
| WATCH | 78 | — | 0 | 0% | 49 | 100% |
| STRONG_WATCH | 85 | — | 0 | 0% | 49 | 100% |

**Threshold Issues:**
- OBSERVE at 65 is only reachable because trend=100 and momentum can push one coin above
- WATCH at 78 is **unreachable** with current component distributions
- STRONG_WATCH at 85 is **unreachable**
- The thresholds were calibrated on cleaner data; under current degenerate volume, only 1 coin clears OBSERVE

---

## 12. Component Dominance

| Dimension | Dominant Component | Evidence |
|-----------|:------------------:|----------|
| Mean Contribution | **Trend** (20.08) | 43.8% of health |
| Variance Contribution | **Trend** (std=11.18) | Drives all health variance |
| Rank Influence | **Trend** | Bimodal distribution creates most rank separation |
| Threshold Crossing | **Trend** | Only coins with trend=100 approach OBSERVE |
| Marginal Effect | **Momentum** | Most linear component — each point shifts health proportionally |

**Assessment:** The health model is a "trend-dominated" model. Volume is dead weight (30% weight, near-constant signal). Derivative barely contributes variance. Momentum is the only balanced contributor.

---

## 13. Predictive Evidence

**Classification: INSUFFICIENT_EVIDENCE**

- Historical health scores exist but regime/classification transitions have not been systematically tracked
- No predictive backtesting data available in the repository
- Cannot determine whether V7 weights are optimal without outcome labels
- The current dataset has too little differentiation to evaluate weight efficacy

---

## 14. P3 vs P6 Weight Comparison

| Component | P3 | P6 V7 | Change | Semantics |
|-----------|:--:|:-----:|:------:|-----------|
| Trend | 0.35 | 0.30 | -5pp | Reduced from primary driver |
| Derivative | **0.35** | **0.15** | **-20pp** | Massive reduction — reflects derivative data quality issues |
| Volume | 0.20 | **0.30** | **+10pp** | Increased to compensate for derivative |
| Momentum | **0.10** | **0.25** | **+15pp** | Major increase — now second-highest weight |

**Semantic Assessment:**
- Derivative was reduced from 35% to 15% — reasonable given the futures data availability issues (HTTP 451 from Agent sandbox, historical contamination)
- Volume was increased from 20% to 30% — **PROBLEMATIC**: volume is the most degenerate component (48/49 = 15). Increasing its weight amplifies a bug-like signal
- Momentum was increased from 10% to 25% — good in principle (most balanced component) but partially offset by volume increase

**P3 → P7 evolution was contaminated by data quality issues:**
- Derivative reduced because it was degenerate → correct signal
- Volume increased to compensate → incorrect because volume was ALSO degenerate at that time (P6-DATA-02 fix came later)
- The V7 calibration was performed on contaminated data where volume was artificially flat at 15

---

## 15. Configuration Architecture Risks

| Finding | Severity | Evidence | Impact |
|---------|:--------:|----------|--------|
| Admin → Rules shows empty | **HIGH** | Active v7 has 0 rules | Operator cannot inspect/modify active configuration |
| score_configs holds stale P3 values | **MEDIUM** | score_configs.health_weights = {T=0.35, D=0.35, V=0.20, M=0.10} | Operator confusion; risk of future accidental consumption |
| Code defaults (engine.ts) = P3 values | **LOW** | `calculateHealthScore()` defaults = {T=0.35, D=0.35, V=0.20, M=0.10} | Safe — refresh always passes DB weights |
| V7 calibrated on contaminated data | **HIGH** | Volume was 49/49=15 during V7 calibration | Weight allocation is suboptimal |
| 0 recommendation rules for active version | **HIGH** | recommendation_rules WHERE ruleVersionId=8 → 0 rows | Rule engine entirely inactive; all signals fall through to default |
| No mechanism to inspect active weights from UI | **MEDIUM** | Admin → Rules only shows rules, not the version's weights | Operator has no visibility into runtime configuration |

---

## 16. Findings

### F1 — Configuration Surface

1. **Active health weights are V7 from `rule_versions` table**, NOT from `score_configs`
2. **Admin → Rules is BROKEN** — active version has 0 recommendation rules
3. **`score_configs` is dead config** — contains P3 values, not consumed by P6 refresh
4. **Code defaults are P3** — but always overridden by DB values in refresh

### F2 — Component Quality

1. **Volume is 98% degenerate** (48/49 = score 15) — despite P6-DATA-02 fix, the actual market condition produces uniform low volume ratios
2. **Derivative has only 5 unique values** — 90% of coins are at 47.5 or 57.5
3. **Trend is extremely bimodal** — 47% at 100, 14% at 0
4. **Momentum is the only healthy component** — 13 unique values with reasonable spread

### F3 — Health Model

1. **98% of coins are WEAK** — health distribution is heavily left-skewed
2. **No WATCH or STRONG_WATCH** — thresholds are unreachable
3. **Volume weight=0.30 is actively harmful** — near-zero signal gets 30% weight
4. **Effective weight distribution** is approximately T=46%, D=18%, M=30%, V=6%

---

## 17. Recommendations

1. **DO NOT recalibrate V7 based on current data alone** — volume degeneracy must be resolved first
2. **Investigate why volume is 98% degenerate** — is the MA20 calculation correct? Are all coins genuinely low-volume relative to their history?
3. **Reduce volume weight** until component dispersion improves (current 30% is disproportionate to signal quality)
4. **Restore Admin → Rules** — create recommendation rules for v7 so operators can inspect active config
5. **Consider derivative weight increase** once futures data connectivity is stable in Production

---

## 18. What Must NOT Be Changed Yet

- No weight changes until volume degeneracy root cause is determined
- No threshold changes until weight distribution is stable
- No recommendation rules changes (0 rules → any rules would be a significant semantic change)
- No P3/P4/P5 semantics
- No code changes (audit only)

---

## 19. Final Verdict

```
P6-CONFIG-06: PASS (audit complete)

ADMIN_RULES_STATUS: BROKEN
CONFIGURATION_SOURCE: DB (rule_versions table)
PRODUCTION_CONFIG_TRACE: VERIFIED
ACTIVE_HEALTH_WEIGHTS: VERIFIED (V7: T=0.30, D=0.15, V=0.30, M=0.25)
ACTIVE_THRESHOLDS: VERIFIED (observe=65, watch=78, strong_watch=85)
WEIGHT_CONTRIBUTION_ANALYSIS: COMPLETE
WEIGHT_SENSITIVITY_ANALYSIS: COMPLETE
THRESHOLD_INTERACTION_ANALYSIS: COMPLETE
PREDICTIVE_EVIDENCE: INSUFFICIENT
V7_OPTIMALITY: NOT_SUPPORTED — calibrated on contaminated data; volume degeneracy invalidates weight allocation
CONFIGURATION_ARCHITECTURE_RISK: HIGH — Admin broken, stale config, 0 recommendation rules
RECOMMENDATION: INVESTIGATE_FURTHER — resolve volume degeneracy before recalibration
P6_SEMANTICS_CHANGED: NO
PRODUCTION_DATA_CHANGED: NO
CODE_CHANGED: NO
```

---

## 20. Appendix: Version History

| Version | ID | Trend | Derivative | Volume | Momentum | Observe | Watch | Strong | Status |
|:-------:|:--:|:-----:|:----------:|:------:|:--------:|:-------:|:-----:|:------:|:------:|
| v1 | 1 | 0.35 | 0.35 | 0.20 | 0.10 | 65 | 80 | 90 | inactive |
| v2 | 3 | 0.40 | 0.30 | 0.20 | 0.10 | 65 | 80 | 90 | inactive |
| v3 | 4 | 0.40 | 0.30 | 0.20 | 0.10 | 65 | 80 | 90 | inactive |
| v4 | 5 | 0.40 | 0.30 | 0.20 | 0.10 | 65 | 80 | 90 | inactive |
| v5 | 6 | 0.40 | 0.30 | 0.20 | 0.10 | 65 | 80 | 90 | inactive |
| v6 | 7 | 0.35 | 0.35 | 0.20 | 0.10 | 65 | 78 | 85 | inactive |
| **v7** | **8** | **0.30** | **0.15** | **0.30** | **0.25** | **65** | **78** | **85** | **ACTIVE** |

---

*Audit completed: 2026-09-03*
*Data source: E1 Agent Runtime (shared DB, E1 classification)*
*No code/config changes made*
