# P0 Implementation Pack
# Sprint: Health Score & Narrative Improvements
# Version: 1.0
# Date: 2026-08-03
# Status: Ready for Development

---

## 1. SPRINT OVERVIEW

### 1.1 Mục Tiêu

Sprint P0 giải quyết 5 vấn đề critical được xác định
sau review kiến trúc hiện tại:

| ID  | Vấn đề                              | Impact  |
|-----|-------------------------------------|---------|
| P0A | Weighted Narrative Health           | HIGH    |
| P0B | Rule Version Tracking               | HIGH    |
| P0C | Health Timeline & Sparkline         | MEDIUM  |
| P0D | scoring.ts ADX Guard Fix            | MEDIUM  |
| P0E | risk.ts Strength Scale Fix          | HIGH    |

### 1.2 Định Nghĩa Done

Sprint P0 hoàn thành khi:
- [ ] Tất cả 5 task pass unit test
- [ ] Migration chạy thành công trên staging
- [ ] Dashboard hiển thị weighted narrative health
- [ ] Rule version tracking hoạt động
- [ ] Health timeline hiển thị trên coin detail page
- [ ] Tech Lead review pass (03_Review_Pack.md)
- [ ] Verification pass (04_Verification_Pack.md)

### 1.3 Out of Scope (Không làm trong P0)

- Indicator table (P1)
- Multi-condition Rule Engine (P1)
- Morning Snapshot normalization (P1)
- Decision Engine layer (P2)
- Event Engine (Phase 2)

---

## 2. KIẾN TRÚC THAY ĐỔI

### 2.1 Trước P0
Feature Scores
↓
Health Score (simple average) ← Không weighted
↓
Recommendation (single threshold) ← Không versioned
↓
Narrative Health (coin average) ← Không weighted

text


### 2.2 Sau P0
Feature Scores
↓
Health Score + rule_version_id ← Track version
↓
Recommendation + rule_version_id ← Track version
↓
Narrative Health ← Weighted by market cap

weighting_method
weight_details JSON
↓
Health Timeline ← UI component mới
(sparkline trên narrative card)
(full chart trên coin detail)
text


### 2.3 Database Changes

#### Bảng mới: `rule_versions`

```sql
CREATE TABLE rule_versions (
  id                        SERIAL PRIMARY KEY,
  version                   INTEGER NOT NULL UNIQUE,
  description               TEXT,
  health_weights            JSONB NOT NULL,
  confidence_weights        JSONB NOT NULL,
  recommendation_thresholds JSONB NOT NULL,
  is_active                 BOOLEAN DEFAULT FALSE,
  created_at                TIMESTAMP DEFAULT NOW(),
  activated_at              TIMESTAMP
);
Alter existing tables:
SQL

-- health_scores
ALTER TABLE health_scores
  ADD COLUMN rule_version_id INTEGER REFERENCES rule_versions(id);

-- recommendations
ALTER TABLE recommendations
  ADD COLUMN rule_version_id INTEGER REFERENCES rule_versions(id);

-- narrative_health
ALTER TABLE narrative_health
  ADD COLUMN rule_version_id   INTEGER REFERENCES rule_versions(id),
  ADD COLUMN weighting_method  VARCHAR(20) DEFAULT 'market_cap',
  ADD COLUMN weight_details    JSONB;
2.4 Flow Thay Đổi
Narrative Health Calculation (P0A)
text

BEFORE:
  narrative_health = avg(all coin health scores)

AFTER:
  Step 1: Get market cap for each coin in narrative
  Step 2: Calculate weight_i = mcap_i / Σ(mcap)
  Step 3: narrative_health = Σ(health_i × weight_i)
  Step 4: Fallback to equal weight nếu thiếu mcap

Fallback logic:
  IF any coin missing mcap:
    weight = 1 / total_coins (equal weight)
    weighting_method = 'equal'
  ELSE:
    weighting_method = 'market_cap'
Rule Version Tracking (P0B)
text

BEFORE:
  refresh() → calculate → save(health_scores)

AFTER:
  refresh() 
    → get_active_rule_version()
    → calculate(using version.weights)
    → save(health_scores, rule_version_id=version.id)
    → save(recommendations, rule_version_id=version.id)
    → save(narrative_health, rule_version_id=version.id)

Admin changes config:
    → create_new_rule_version()
    → set_active(new_version)
    → old data retains old version_id
Health Timeline (P0C)
text

BEFORE:
  Coin Detail page → no timeline

AFTER:
  Narrative Card → Sparkline (7 days)
  Coin Detail    → Full timeline chart (30 days)
                → Trend arrow + direction label
  
Data source: health_scores table (already exists)
No new DB table needed.
3. INTERFACES & CONTRACTS
3.1 RuleVersion Interface
TypeScript

// src/lib/types/rule-version.ts

export interface RuleVersion {
  id:                        number;
  version:                   number;
  description:               string | null;
  healthWeights:             HealthWeights;
  confidenceWeights:         ConfidenceWeights;
  recommendationThresholds:  RecommendationThresholds;
  isActive:                  boolean;
  createdAt:                 Date;
  activatedAt:               Date | null;
}

export interface HealthWeights {
  trend:       number;  // sum must = 1.0
  derivative:  number;
  volume:      number;
  momentum:    number;
}

export interface ConfidenceWeights {
  binance_spot:    number;  // sum must = 1.0
  binance_futures: number;
  coingecko:       number;
}

export interface RecommendationThresholds {
  strong_watch:  number;  // default: 90
  watch:         number;  // default: 80
  observe:       number;  // default: 65
}
3.2 Narrative Health Enhanced Interface
TypeScript

// src/lib/types/narrative-health.ts

export interface NarrativeHealthResult {
  narrativeId:        number;
  date:               string;
  healthScore:        number;
  status:             HealthStatus;
  scoreChange:        number | null;
  avgConfidence:      number;
  topCoinId:          number | null;
  weakestCoinId:      number | null;
  ruleVersionId:      number;
  weightingMethod:    'market_cap' | 'equal';
  weightDetails:      Record<string, CoinWeightDetail>;
}

export interface CoinWeightDetail {
  coinId:       number;
  symbol:       string;
  weight:       number;      // 0.0 - 1.0
  marketCap:    number | null;
  healthScore:  number;
}

export type HealthStatus =
  | 'STRONG'   // 90-100
  | 'HEALTHY'  // 80-89
  | 'NEUTRAL'  // 65-79
  | 'CAUTION'  // 50-64
  | 'WEAK';    // 0-49
3.3 Health Timeline Interface
TypeScript

// src/lib/types/health-timeline.ts

export interface HealthTimelinePoint {
  date:        string;      // YYYY-MM-DD
  healthScore: number;
  status:      HealthStatus;
  change:      number | null;
}

export interface HealthTimeline {
  coinId:     number;
  symbol:     string;
  points:     HealthTimelinePoint[];
  trend:      HealthTrend;
}

export interface HealthTrend {
  direction:  'improving' | 'declining' | 'stable';
  slope:      number;      // points per day
  change7d:   number;      // health change over 7 days
  change30d:  number;      // health change over 30 days
}
3.4 API Contracts
GET /api/coins/[id]/health-timeline
TypeScript

// Request params:
// days?: number (default: 30, max: 90)

// Response:
{
  success: true,
  data: HealthTimeline
}

// Error:
{
  success: false,
  error: string
}
GET /api/narratives/[id]/health-timeline
TypeScript

// Request params:
// days?: number (default: 30)

// Response:
{
  success: true,
  data: {
    narrativeId: number,
    points: Array<{
      date: string,
      healthScore: number,
      status: HealthStatus,
      coinBreakdown: Record<string, number>  // symbol → health
    }>
  }
}
GET /api/admin/rule-versions
TypeScript

// Response:
{
  success: true,
  data: RuleVersion[]
}
POST /api/admin/rule-versions
TypeScript

// Request body:
{
  description?: string,
  healthWeights: HealthWeights,
  confidenceWeights: ConfidenceWeights,
  recommendationThresholds: RecommendationThresholds,
  activateImmediately?: boolean  // default: false
}

// Response:
{
  success: true,
  data: RuleVersion
}
POST /api/admin/rule-versions/[id]/activate
TypeScript

// Response:
{
  success: true,
  data: { activated: true, version: number }
}
4. MIGRATION PLAN
4.1 Migration Files
text

drizzle/migrations/
├── 0001_add_rule_versions.sql
├── 0002_alter_health_scores.sql
├── 0003_alter_recommendations.sql
└── 0004_alter_narrative_health.sql
4.2 Migration Content
0001_add_rule_versions.sql
SQL

-- Create rule_versions table
CREATE TABLE IF NOT EXISTS rule_versions (
  id                          SERIAL PRIMARY KEY,
  version                     INTEGER NOT NULL UNIQUE,
  description                 TEXT,
  health_weights              JSONB NOT NULL DEFAULT '{}',
  confidence_weights          JSONB NOT NULL DEFAULT '{}',
  recommendation_thresholds   JSONB NOT NULL DEFAULT '{}',
  is_active                   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  activated_at                TIMESTAMP
);

CREATE INDEX idx_rule_versions_active
  ON rule_versions(is_active)
  WHERE is_active = TRUE;

-- Seed version 1 (default config, activated)
INSERT INTO rule_versions (
  version,
  description,
  health_weights,
  confidence_weights,
  recommendation_thresholds,
  is_active,
  activated_at
) VALUES (
  1,
  'Initial default configuration',
  '{"trend": 0.35, "derivative": 0.35, "volume": 0.20, "momentum": 0.10}',
  '{"binance_spot": 0.40, "binance_futures": 0.40, "coingecko": 0.20}',
  '{"strong_watch": 90, "watch": 80, "observe": 65}',
  TRUE,
  NOW()
);
0002_alter_health_scores.sql
SQL

ALTER TABLE health_scores
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id);

-- Backfill existing records with version 1
UPDATE health_scores
  SET rule_version_id = 1
  WHERE rule_version_id IS NULL;

CREATE INDEX idx_health_scores_rule_version
  ON health_scores(rule_version_id);
0003_alter_recommendations.sql
SQL

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id);

UPDATE recommendations
  SET rule_version_id = 1
  WHERE rule_version_id IS NULL;

CREATE INDEX idx_recommendations_rule_version
  ON recommendations(rule_version_id);
0004_alter_narrative_health.sql
SQL

ALTER TABLE narrative_health
  ADD COLUMN IF NOT EXISTS rule_version_id  INTEGER
    REFERENCES rule_versions(id),
  ADD COLUMN IF NOT EXISTS weighting_method VARCHAR(20)
    NOT NULL DEFAULT 'equal',
  ADD COLUMN IF NOT EXISTS weight_details   JSONB;

-- Backfill
UPDATE narrative_health
  SET rule_version_id  = 1,
      weighting_method = 'equal'
  WHERE rule_version_id IS NULL;

CREATE INDEX idx_narrative_health_rule_version
  ON narrative_health(rule_version_id);
4.3 Drizzle Schema Updates
TypeScript

// src/lib/db/schema.ts additions

export const ruleVersions = pgTable('rule_versions', {
  id:                       serial('id').primaryKey(),
  version:                  integer('version').notNull().unique(),
  description:              text('description'),
  healthWeights:            jsonb('health_weights').notNull(),
  confidenceWeights:        jsonb('confidence_weights').notNull(),
  recommendationThresholds: jsonb('recommendation_thresholds').notNull(),
  isActive:                 boolean('is_active').notNull().default(false),
  createdAt:                timestamp('created_at').notNull().defaultNow(),
  activatedAt:              timestamp('activated_at'),
});

// Update healthScores table
export const healthScores = pgTable('health_scores', {
  // ... existing fields ...
  ruleVersionId: integer('rule_version_id')
    .references(() => ruleVersions.id),
});

// Update recommendations table
export const recommendations = pgTable('recommendations', {
  // ... existing fields ...
  ruleVersionId: integer('rule_version_id')
    .references(() => ruleVersions.id),
});

// Update narrativeHealth table
export const narrativeHealth = pgTable('narrative_health', {
  // ... existing fields ...
  ruleVersionId:   integer('rule_version_id')
    .references(() => ruleVersions.id),
  weightingMethod: varchar('weighting_method', { length: 20 })
    .notNull().default('equal'),
  weightDetails:   jsonb('weight_details'),
});
5. IMPLEMENTATION DETAILS
5.1 Weighted Narrative Health Algorithm
TypeScript

// src/lib/scoring/narrative-health.ts

export async function calculateNarrativeHealth(
  narrativeId: number,
  date: string,
  coinScores: CoinHealthData[],
  ruleVersion: RuleVersion
): Promise<NarrativeHealthResult> {

  // Step 1: Attempt market cap weighting
  const withMcap = coinScores.filter(c => c.marketCap && c.marketCap > 0);
  const withoutMcap = coinScores.filter(c => !c.marketCap || c.marketCap <= 0);

  let weightingMethod: 'market_cap' | 'equal';
  let weights: Map<number, number>;

  if (withoutMcap.length > 0) {
    // Fallback: equal weight for ALL coins
    weightingMethod = 'equal';
    const equalWeight = 1 / coinScores.length;
    weights = new Map(coinScores.map(c => [c.coinId, equalWeight]));
  } else {
    // Market cap weighting
    weightingMethod = 'market_cap';
    const totalMcap = coinScores.reduce((s, c) => s + c.marketCap!, 0);
    weights = new Map(coinScores.map(c => [
      c.coinId,
      c.marketCap! / totalMcap
    ]));
  }

  // Step 2: Weighted health score
  const weightedHealth = coinScores.reduce((sum, coin) => {
    const w = weights.get(coin.coinId) ?? 0;
    return sum + (coin.healthScore * w);
  }, 0);

  // Step 3: Build weight_details for transparency
  const weightDetails: Record<string, CoinWeightDetail> = {};
  for (const coin of coinScores) {
    weightDetails[coin.symbol] = {
      coinId:      coin.coinId,
      symbol:      coin.symbol,
      weight:      weights.get(coin.coinId) ?? 0,
      marketCap:   coin.marketCap ?? null,
      healthScore: coin.healthScore,
    };
  }

  // Step 4: Find top and weakest coins
  const sorted = [...coinScores].sort((a, b) => b.healthScore - a.healthScore);
  const topCoin = sorted[0];
  const weakestCoin = sorted[sorted.length - 1];

  // Step 5: Average confidence
  const avgConfidence = coinScores.reduce(
    (s, c) => s + c.confidenceScore, 0
  ) / coinScores.length;

  return {
    narrativeId,
    date,
    healthScore:     Math.round(weightedHealth * 100) / 100,
    status:          healthToStatus(weightedHealth),
    scoreChange:     null,  // Calculated separately
    avgConfidence,
    topCoinId:       topCoin?.coinId ?? null,
    weakestCoinId:   weakestCoin?.coinId ?? null,
    ruleVersionId:   ruleVersion.id,
    weightingMethod,
    weightDetails,
  };
}

function healthToStatus(score: number): HealthStatus {
  if (score >= 90) return 'STRONG';
  if (score >= 80) return 'HEALTHY';
  if (score >= 65) return 'NEUTRAL';
  if (score >= 50) return 'CAUTION';
  return 'WEAK';
}
5.2 Rule Version Service
TypeScript

// src/lib/services/rule-version.service.ts

export class RuleVersionService {

  async getActiveVersion(): Promise<RuleVersion> {
    const version = await db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.isActive, true))
      .limit(1);

    if (!version.length) {
      throw new Error('No active rule version found. Run seed first.');
    }

    return mapToRuleVersion(version[0]);
  }

  async createVersion(
    data: CreateRuleVersionInput,
    activateImmediately: boolean = false
  ): Promise<RuleVersion> {

    // Validate weights sum to 1.0
    validateWeights(data.healthWeights);
    validateWeights(data.confidenceWeights);

    // Get next version number
    const latest = await db
      .select({ maxVersion: max(ruleVersions.version) })
      .from(ruleVersions);
    const nextVersion = (latest[0].maxVersion ?? 0) + 1;

    const [created] = await db
      .insert(ruleVersions)
      .values({
        version:                  nextVersion,
        description:              data.description ?? null,
        healthWeights:            data.healthWeights,
        confidenceWeights:        data.confidenceWeights,
        recommendationThresholds: data.recommendationThresholds,
        isActive:                 false,
        activatedAt:              null,
      })
      .returning();

    if (activateImmediately) {
      await this.activate(created.id);
    }

    return mapToRuleVersion(created);
  }

  async activate(versionId: number): Promise<void> {
    await db.transaction(async (tx) => {
      // Deactivate all other versions
      await tx
        .update(ruleVersions)
        .set({ isActive: false })
        .where(ne(ruleVersions.id, versionId));

      // Activate target version
      await tx
        .update(ruleVersions)
        .set({ isActive: true, activatedAt: new Date() })
        .where(eq(ruleVersions.id, versionId));
    });
  }
}

function validateWeights(weights: Record<string, number>): void {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1.0) > 0.001) {
    throw new Error(`Weights must sum to 1.0, got ${sum}`);
  }
}
5.3 Health Timeline Service
TypeScript

// src/lib/services/health-timeline.service.ts

export class HealthTimelineService {

  async getCoinTimeline(
    coinId: number,
    days: number = 30
  ): Promise<HealthTimeline> {

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const records = await db
      .select({
        date:        healthScores.date,
        healthScore: healthScores.healthScore,
        status:      healthScores.status,
        scoreChange: healthScores.scoreChange,
      })
      .from(healthScores)
      .where(
        and(
          eq(healthScores.coinId, coinId),
          gte(healthScores.date, sinceStr)
        )
      )
      .orderBy(asc(healthScores.date));

    const coin = await db
      .select({ symbol: coins.symbol })
      .from(coins)
      .where(eq(coins.id, coinId))
      .limit(1);

    const points: HealthTimelinePoint[] = records.map(r => ({
      date:        r.date,
      healthScore: Number(r.healthScore),
      status:      r.status as HealthStatus,
      change:      r.scoreChange ? Number(r.scoreChange) : null,
    }));

    return {
      coinId,
      symbol:  coin[0]?.symbol ?? '',
      points,
      trend:   this.calculateTrend(points),
    };
  }

  private calculateTrend(points: HealthTimelinePoint[]): HealthTrend {
    if (points.length < 2) {
      return { direction: 'stable', slope: 0, change7d: 0, change30d: 0 };
    }

    const latest = points[points.length - 1].healthScore;

    // 7-day change
    const point7d = points.length >= 7
      ? points[points.length - 7]
      : points[0];
    const change7d = latest - point7d.healthScore;

    // 30-day change
    const change30d = latest - points[0].healthScore;

    // Slope (linear regression on last 7 points)
    const recentPoints = points.slice(-7);
    const slope = this.linearSlope(
      recentPoints.map((p, i) => [i, p.healthScore])
    );

    return {
      direction: slope > 0.5 ? 'improving'
               : slope < -0.5 ? 'declining'
               : 'stable',
      slope:     Math.round(slope * 100) / 100,
      change7d:  Math.round(change7d * 100) / 100,
      change30d: Math.round(change30d * 100) / 100,
    };
  }

  private linearSlope(points: [number, number][]): number {
    const n = points.length;
    if (n < 2) return 0;
    const sumX  = points.reduce((s, [x]) => s + x, 0);
    const sumY  = points.reduce((s, [, y]) => s + y, 0);
    const sumXY = points.reduce((s, [x, y]) => s + x * y, 0);
    const sumX2 = points.reduce((s, [x]) => s + x * x, 0);
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }
}
5.4 Technical Analysis Fixes
Fix P0D: ADX Guard in scoring.ts
TypeScript

// FIND in calcTrendIndicators():
if (isFinite(adxV)) {

// REPLACE WITH:
if (isFinite(adxV) && isFinite(pdiV) && isFinite(mdiV)) {
Fix P0E: Strength Scale in risk.ts
TypeScript

// FIND:
const strength = Math.min(Math.abs(compositeScore) * 100, 100);

// REPLACE WITH:
// compositeScore đã là scale [-100, +100]
const strength = Math.min(Math.abs(compositeScore), 100);
6. UI COMPONENTS
6.1 HealthSparkline Component
TypeScript

// src/components/health-sparkline.tsx

interface HealthSparklineProps {
  data:    HealthTimelinePoint[];
  width?:  number;   // default: 80
  height?: number;   // default: 32
  trend:   HealthTrend;
}

// Renders:
// - Mini line chart (last 7 days)
// - Trend arrow icon (↗ ↘ →)
// - 7d change label (+5.2 or -3.1)
6.2 HealthTimeline Component (Full)
TypeScript

// src/components/health-timeline.tsx

interface HealthTimelineProps {
  coinId:  number;
  days?:   number;  // default: 30
}

// Renders:
// - Area chart (Recharts AreaChart)
// - X axis: dates
// - Y axis: 0-100
// - Color zones: red(<50) yellow(50-65) orange(65-80) green(>80)
// - Tooltip with score, status, change
// - Trend summary card at top
6.3 Trend Arrow Component
TypeScript

// src/components/trend-arrow.tsx

interface TrendArrowProps {
  direction:  'improving' | 'declining' | 'stable';
  change7d:   number;
  size?:      'sm' | 'md' | 'lg';
}

// Renders:
// improving → ↗ text-green-500
// declining → ↘ text-red-500
// stable    → → text-gray-400
// + change value: "+5.2" or "-3.1"
7. DEPENDENCY MAP
text

P0A (Weighted Narrative Health)
  REQUIRES:
    - coin_metrics.market_cap (already collected)
    - narrative_health table (already exists)
    - CoinGecko market cap in refresh pipeline
  BLOCKS:
    - Nothing

P0B (Rule Version Tracking)
  REQUIRES:
    - Migration 0001 (rule_versions table)
    - Migrations 0002-0004 (alter tables)
  BLOCKS:
    - P0A (narrative_health.rule_version_id)
    - Admin UI for rule versions

P0C (Health Timeline)
  REQUIRES:
    - health_scores table (already exists, has data)
    - No DB changes needed
  BLOCKS:
    - Nothing

P0D (ADX Guard Fix)
  REQUIRES:
    - scoring.ts current file
  BLOCKS:
    - Nothing (independent bug fix)

P0E (Strength Scale Fix)
  REQUIRES:
    - risk.ts current file
  BLOCKS:
    - Nothing (independent bug fix)

RECOMMENDED ORDER:
  1. P0D + P0E (quick fixes, no dependencies)
  2. P0B migration (foundation for versioning)
  3. P0A (requires P0B for rule_version_id)
  4. P0C (independent, parallel with P0A)
8. TESTING REQUIREMENTS
8.1 Unit Tests Required
text

src/lib/scoring/__tests__/
  narrative-health.test.ts   → P0A
  rule-version.test.ts       → P0B
  health-timeline.test.ts    → P0C

src/lib/technical-analysis/__tests__/
  scoring.test.ts            → P0D (ADX guard)
  risk.test.ts               → P0E (strength scale)
8.2 Test Cases Per Task
P0A - Weighted Narrative Health
TypeScript

describe('calculateNarrativeHealth', () => {
  it('uses market_cap weighting when all coins have mcap')
  it('falls back to equal weight when any coin missing mcap')
  it('large mcap coin dominates score correctly')
  it('identifies top and weakest coin correctly')
  it('handles single coin narrative')
  it('handles all coins with same mcap (equal weights)')
  it('weight details sum to approximately 1.0')
  // Critical regression test:
  it('CARV=95 BLUAI=93 TRUTH=15 with mcap gives HEALTHY not NEUTRAL', () => {
    // CARV mcap=500M, BLUAI=200M, TRUTH=5M
    // Expected: ~92 (HEALTHY), not 67 (NEUTRAL)
  })
})
P0B - Rule Version
TypeScript

describe('RuleVersionService', () => {
  it('getActiveVersion returns single active version')
  it('throws when no active version exists')
  it('createVersion increments version number')
  it('activate deactivates all other versions')
  it('activate sets activatedAt timestamp')
  it('validates health weights sum to 1.0')
  it('rejects weights not summing to 1.0')
  it('new version is not active by default')
  it('activateImmediately option works correctly')
})
P0C - Health Timeline
TypeScript

describe('HealthTimelineService', () => {
  it('returns points in ascending date order')
  it('respects days parameter')
  it('calculates improving trend correctly')
  it('calculates declining trend correctly')
  it('calculates stable trend correctly')
  it('handles less than 7 days of data')
  it('change7d calculated from correct reference point')
  it('handles single data point gracefully')
})
P0D - ADX Guard
TypeScript

describe('rsiSmoothMapping', () => {
  // existing tests pass
})
describe('ADX guard', () => {
  it('does not emit ADX indicator when plusDI is NaN')
  it('does not emit ADX indicator when minusDI is NaN')
  it('direction is correct when both DI values finite')
})
P0E - Strength Scale
TypeScript

describe('calculateRiskLevels strength', () => {
  it('compositeScore=75 gives strength=75 (not 7500)', () => {
    const result = calculateRiskLevels(mockData, 'LONG', 75);
    // TP multipliers should be [2.0, 4.0, 6.0] (strength >= 65)
    expect(result?.tp1).toBe(price + 2.0 * atr);
  })
  it('compositeScore=50 gives strength=50', () => {
    // TP multipliers should be [1.8, 3.2, 5.0] (40 <= strength < 65)
  })
  it('compositeScore=20 gives strength=20', () => {
    // TP multipliers should be [1.5, 2.5, 4.0] (strength < 40)
  })
  it('negative compositeScore uses absolute value', () => {
    // compositeScore=-75 → strength=75
  })
})
9. ROLLBACK PLAN
text

Nếu migration thất bại:

Step 1: Revert migrations (reverse order)
  psql -c "ALTER TABLE narrative_health
           DROP COLUMN IF EXISTS rule_version_id,
           DROP COLUMN IF EXISTS weighting_method,
           DROP COLUMN IF EXISTS weight_details;"
  psql -c "ALTER TABLE recommendations
           DROP COLUMN IF EXISTS rule_version_id;"
  psql -c "ALTER TABLE health_scores
           DROP COLUMN IF EXISTS rule_version_id;"
  psql -c "DROP TABLE IF EXISTS rule_versions;"

Step 2: Revert code changes (git)
  git revert HEAD~n  (n = number of P0 commits)

Step 3: Restart services
  npm run build && npm start

Nếu production deploy thất bại:
  git revert + redeploy previous build
  DB rollback script above
  Notify stakeholders
10. ACCEPTANCE CRITERIA
P0A - Weighted Narrative Health
 Narrative health dùng market cap weight khi available
 Fallback về equal weight khi thiếu market cap
 weighting_method field được lưu đúng giá trị
 weight_details JSON chứa đủ thông tin per coin
 UI hiển thị "Weighted by Market Cap" hoặc "Equal Weight"
 Test case CARV/BLUAI/TRUTH pass
P0B - Rule Version Tracking
 rule_versions table tồn tại với seed data
 health_scores.rule_version_id được populate
 recommendations.rule_version_id được populate
 narrative_health.rule_version_id được populate
 Admin UI hiển thị version history
 Activate version deactivates all others
 Existing data backfilled với version 1
P0C - Health Timeline
 /api/coins/[id]/health-timeline trả data đúng
 Sparkline hiển thị trên Narrative card
 Full timeline chart trên Coin Detail page
 Trend direction (↗↘→) hiển thị đúng
 7d change và 30d change chính xác
P0D - ADX Guard
 Không có NaN-direction bug trong ADX calculation
 isFinite(pdiV) && isFinite(mdiV) guard exists
 Build passes TypeScript check
P0E - Strength Scale
 compositeScore * 100 line removed
 Strength trực tiếp từ Math.abs(compositeScore)
 TP multiplier tiers hoạt động đúng
 Test cases với score 75/50/20 pass