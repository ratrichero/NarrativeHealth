# 📄 04_Verification_Pack.md

```markdown
# P0 Verification Pack
# System Verification After Sprint Completion
# Run after successful merge and deployment

---

## 1. DEPLOYMENT VERIFICATION

### 1.1 Build & Start

```bash
npm run build
# Expected: ✓ Compiled successfully

npm start
# Expected: Server starts on :3000

# Check build output
ls -la .next/standalone/
# Expected: Files present
1.2 Database State
SQL

-- Verify rule_versions table
SELECT id, version, description, is_active, activated_at
FROM rule_versions
ORDER BY version;
-- Expected: version=1, is_active=true, activated_at is set

-- Verify health_scores backfill
SELECT COUNT(*) as total,
       COUNT(rule_version_id) as with_version,
       COUNT(*) - COUNT(rule_version_id) as missing_version
FROM health_scores;
-- Expected: total = with_version, missing_version = 0

-- Verify narrative_health
SELECT COUNT(*) as total,
       COUNT(rule_version_id) as with_version,
       weighting_method,
       COUNT(*) as count
FROM narrative_health
GROUP BY weighting_method;
-- Expected: all records have rule_version_id

-- Verify recommendations
SELECT COUNT(*) as total,
       COUNT(rule_version_id) as with_version
FROM recommendations;
-- Expected: total = with_version
2. FEATURE VERIFICATION
2.1 P0A: Weighted Narrative Health
Test: API Response Contains New Fields
Bash

curl -s http://localhost:3000/api/narratives/1 | jq '.data.narrativeHealth'
Expected response includes:

JSON

{
  "weightingMethod": "market_cap",  // or "equal"
  "weightDetails": {
    "COIN_SYMBOL": {
      "coinId": 1,
      "symbol": "COIN",
      "weight": 0.65,
      "marketCap": 500000000,
      "healthScore": 85.5
    }
  }
}
Test: Weighted Score vs Simple Average
SQL

-- Get narrative with coins and their mcap
SELECT
  c.symbol,
  hs.health_score,
  cm.market_cap,
  nh.health_score as narrative_score,
  nh.weighting_method
FROM narrative_health nh
JOIN coin_narratives cn ON cn.narrative_id = nh.narrative_id
JOIN coins c ON c.id = cn.coin_id
JOIN health_scores hs ON hs.coin_id = c.id AND hs.date = nh.date
LEFT JOIN coin_metrics cm ON cm.coin_id = c.id AND cm.date = nh.date
WHERE nh.narrative_id = 1
  AND nh.date = CURRENT_DATE
ORDER BY cm.market_cap DESC NULLS LAST;
Manually verify:

 Narrative score ≠ simple average (if market caps differ significantly)
 Narrative score ≈ weighted average by market cap
 weighting_method = 'market_cap' if all coins have mcap
Test: Fallback to Equal Weight
SQL

-- Check if any narratives use equal weighting
SELECT narrative_id, weighting_method, weight_details
FROM narrative_health
WHERE weighting_method = 'equal'
  AND date = CURRENT_DATE;
If results exist, verify these coins have missing market cap:

SQL

SELECT c.symbol, cm.market_cap
FROM coin_narratives cn
JOIN coins c ON c.id = cn.coin_id
LEFT JOIN coin_metrics cm ON cm.coin_id = c.id AND cm.date = CURRENT_DATE
WHERE cn.narrative_id = [narrative_id_from_above];
2.2 P0B: Rule Version Tracking
Test: New Records Have Version ID
Bash

# Trigger a refresh
curl -X POST http://localhost:3000/api/refresh

# Wait for completion, then check
curl http://localhost:3000/api/refresh/status
After refresh completes:

SQL

-- Verify latest health scores have version
SELECT hs.date, hs.rule_version_id, rv.version, rv.is_active
FROM health_scores hs
JOIN rule_versions rv ON rv.id = hs.rule_version_id
WHERE hs.date = CURRENT_DATE
ORDER BY hs.id DESC
LIMIT 5;
-- Expected: rule_version_id = 1, version = 1, is_active = true
Test: Create New Rule Version
Bash

curl -X POST http://localhost:3000/api/admin/rule-versions \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Verification test version",
    "healthWeights": {
      "trend": 0.40,
      "derivative": 0.30,
      "volume": 0.20,
      "momentum": 0.10
    },
    "confidenceWeights": {
      "binance_spot": 0.40,
      "binance_futures": 0.40,
      "coingecko": 0.20
    },
    "recommendationThresholds": {
      "strong_watch": 90,
      "watch": 80,
      "observe": 65
    }
  }'
Expected response:

JSON

{
  "success": true,
  "data": {
    "id": 2,
    "version": 2,
    "isActive": false,
    "activatedAt": null
  }
}
Test: Activate New Version
Bash

# Get the ID from previous response
curl -X POST http://localhost:3000/api/admin/rule-versions/2/activate
Expected:

JSON

{
  "success": true,
  "data": { "activated": true, "version": 2 }
}
Verify in DB:

SQL

SELECT version, is_active, activated_at
FROM rule_versions
ORDER BY version;
-- Expected: v1 is_active=false, v2 is_active=true
Test: Validation Rejects Bad Weights
Bash

curl -X POST http://localhost:3000/api/admin/rule-versions \
  -H "Content-Type: application/json" \
  -d '{
    "healthWeights": {"trend":0.5,"derivative":0.5,"volume":0.2,"momentum":0.1},
    "confidenceWeights": {"binance_spot":0.40,"binance_futures":0.40,"coingecko":0.20},
    "recommendationThresholds": {"strong_watch":90,"watch":80,"observe":65}
  }'
Expected: HTTP 422 with error message about sum.

CLEANUP: Restore version 1 as active
Bash

curl -X POST http://localhost:3000/api/admin/rule-versions/1/activate
2.3 P0C: Health Timeline
Test: API Endpoint
Bash

# Coin timeline
curl -s "http://localhost:3000/api/coins/1/health-timeline?days=30" | \
  jq '{
    coinId: .data.coinId,
    symbol: .data.symbol,
    pointCount: (.data.points | length),
    trend: .data.trend,
    firstDate: .data.points[0].date,
    lastDate: .data.points[-1].date
  }'
Expected:

JSON

{
  "coinId": 1,
  "symbol": "COIN",
  "pointCount": 5,        // Whatever data exists
  "trend": {
    "direction": "improving|declining|stable",
    "slope": 0.5,
    "change7d": 2.3,
    "change30d": 5.1
  },
  "firstDate": "2026-07-01",
  "lastDate": "2026-08-03"
}
Test: Points in Ascending Order
Bash

curl -s "http://localhost:3000/api/coins/1/health-timeline?days=30" | \
  jq '.data.points | map(.date) | . as $dates |
      [range(1; length)] |
      map($dates[.] >= $dates[. - 1]) |
      all'
Expected: true (all dates in ascending order)

Test: Days Parameter Cap
Bash

# Request 200 days → should cap at 90
curl -s "http://localhost:3000/api/coins/1/health-timeline?days=200" | \
  jq '.data.points | length'
# Expected: at most 90 days of data
Test: UI Components Visible
Manual browser verification:

 Open Dashboard → Narrative cards → Sparkline visible (mini chart)
 Open Coin Detail page → "Health Timeline (30d)" section visible
 Trend arrow shows ↗ ↘ or →
 Hovering over chart shows tooltip with date/score/status
 Reference lines at 90/80/65/50 visible
2.4 P0D: ADX Guard Fix
Test: No NaN Signal from ADX
Bash

# Get technical analysis for any coin
curl -s "http://localhost:3000/api/coins/1/technical-analysis" | \
  jq '.data.timeframes | to_entries[] |
      .value.indicators[] |
      select(.name == "ADX(14)") |
      { signal: .signal, value: .value }'
Expected: signal is a finite number between -1 and 1 (not NaN, not -1 by default).

Verify in code:

Bash

grep -n "isFinite(adxV) && isFinite(pdiV) && isFinite(mdiV)" \
  src/lib/technical-analysis/scoring.ts
# Expected: line found (not "not found")
2.5 P0E: Strength Scale Fix
Test: TP Levels Vary by Signal Strength
Bash

# Get technical analysis and check risk levels
curl -s "http://localhost:3000/api/coins/1/technical-analysis" | \
  jq '.data | {
    compositeScore: .compositeScore,
    strength: .strength,
    tp1: .riskLevels.tp1,
    tp2: .riskLevels.tp2,
    tp3: .riskLevels.tp3,
    rrRatio: .riskLevels.rrRatio
  }'
Verify:

 strength = Math.abs(compositeScore) (not × 100)
 If strength < 40: rrRatio ≈ 1.0 (tp1M/slM = 1.5/1.5)
 If 40 ≤ strength < 65: rrRatio ≈ 1.0 (1.8/1.8)
 If strength ≥ 65: rrRatio = 1.0 (2.0/2.0)
Verify in code:

Bash

grep -n "Math.abs(compositeScore)" \
  src/lib/technical-analysis/risk.ts | grep -v "\* 100"
# Expected: line found without "* 100"
3. END-TO-END SCENARIO TEST
Scenario: Full P0 System Test
text

Setup:
  - Have at least 1 narrative with 3+ coins
  - Have at least 7 days of health score history
  - Coins have different market caps

Steps:
  1. Run global refresh
     POST /api/refresh
     Wait for completion
     
  2. Check narrative health is weighted
     GET /api/narratives/1
     → narrativeHealth.weightingMethod should be 'market_cap'
     → narrativeHealth.weightDetails should show all coins with weights
     
  3. Verify large-mcap coin dominates
     → Find coin with largest market cap
     → Its health score should have highest influence on narrative health
     
  4. Check rule version tracking
     SELECT hs.rule_version_id FROM health_scores 
     WHERE date = CURRENT_DATE LIMIT 1;
     → Should return 1 (or active version ID)
     
  5. View health timeline
     GET /api/coins/1/health-timeline
     → Returns points array in date order
     → Trend object calculated correctly
     
  6. Open UI
     → Narrative card shows sparkline ✓
     → Coin detail shows timeline ✓
     → Trend arrow shows correct direction ✓
     
  7. Create new rule version (test only)
     POST /api/admin/rule-versions
     → Version 2 created (inactive)
     
  8. Activate version 2
     POST /api/admin/rule-versions/2/activate
     → Version 2 active, version 1 inactive
     
  9. Run refresh again
     POST /api/refresh
     → New health_scores have rule_version_id = 2
     
  10. Restore version 1
      POST /api/admin/rule-versions/1/activate
4. PERFORMANCE VERIFICATION
4.1 Response Time Benchmarks
Bash

# Dashboard load time
time curl -s http://localhost:3000/api/dashboard > /dev/null
# Target: < 500ms

# Coin timeline
time curl -s "http://localhost:3000/api/coins/1/health-timeline?days=30" > /dev/null
# Target: < 200ms

# Narrative health
time curl -s http://localhost:3000/api/narratives/1 > /dev/null
# Target: < 300ms

# Rule versions list
time curl -s http://localhost:3000/api/admin/rule-versions > /dev/null
# Target: < 100ms
4.2 Database Query Performance
SQL

-- Check index usage for health timeline query
EXPLAIN ANALYZE
SELECT date, health_score, status, score_change
FROM health_scores
WHERE coin_id = 1
  AND date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date ASC;
-- Expected: Index Scan (not Seq Scan)

-- Check index usage for narrative health query
EXPLAIN ANALYZE
SELECT *
FROM narrative_health
WHERE narrative_id = 1
  AND date >= CURRENT_DATE - INTERVAL '30 days'
ORDER BY date ASC;
-- Expected: Index Scan
5. REGRESSION VERIFICATION
5.1 Existing Features Still Work
Bash

# Dashboard
curl -s http://localhost:3000/api/dashboard | jq '.success'
# Expected: true

# Coin list
curl -s http://localhost:3000/api/coins | jq '.success'
# Expected: true

# Narrative list
curl -s http://localhost:3000/api/narratives | jq '.success'
# Expected: true

# Refresh status
curl -s http://localhost:3000/api/refresh/status | jq '.success'
# Expected: true

# Admin logs
curl -s http://localhost:3000/api/admin/logs | jq '.success'
# Expected: true
5.2 Existing Data Integrity
SQL

-- Check no data was lost
SELECT
  (SELECT COUNT(*) FROM health_scores)   as health_scores_count,
  (SELECT COUNT(*) FROM recommendations) as recommendations_count,
  (SELECT COUNT(*) FROM narrative_health) as narrative_health_count,
  (SELECT COUNT(*) FROM coins)            as coins_count,
  (SELECT COUNT(*) FROM narratives)       as narratives_count;
-- Compare with pre-migration counts
6. SIGN-OFF
text

Verification completed by: _______________
Date: _______________
Environment: [ ] Staging  [ ] Production

Results:
  P0A Weighted Narrative Health:  [ ] PASS  [ ] FAIL
  P0B Rule Version Tracking:      [ ] PASS  [ ] FAIL
  P0C Health Timeline:            [ ] PASS  [ ] FAIL
  P0D ADX Guard Fix:              [ ] PASS  [ ] FAIL
  P0E Strength Scale Fix:         [ ] PASS  [ ] FAIL
  End-to-End Scenario:            [ ] PASS  [ ] FAIL
  Performance Benchmarks:         [ ] PASS  [ ] FAIL
  Regression Tests:               [ ] PASS  [ ] FAIL

Overall: [ ] VERIFIED - Ready for Production
         [ ] ISSUES FOUND - See notes below

Issues:
_________________________________________________
_________________________________________________
_________________________________________________

Approved by Tech Lead: _______________
Date: _______________
text


---

## Summary: File Structure
project/
├── 01_P0_Implementation_Pack.md
├── 02_Agent_Work_Pack/
│ ├── A_Database_Migration.md
│ ├── B_Service_Layer.md
│ ├── C_API_Routes.md
│ ├── D_Frontend_UI.md
│ └── E_Technical_Fixes.md
├── 03_Review_Pack.md
└── 04_Verification_Pack.md

text


**Recommended execution order:**
Day 1: Agent E (quick fixes, no deps) + Agent A (DB foundation)
Day 2: Agent B (services, depends on A) + Agent C (APIs, depends on A+B)
Day 3: Agent D (UI, depends on C) + Integration testing
Day 4: Tech Lead review (03_Review_Pack) + Verification (04_Verification_Pack)