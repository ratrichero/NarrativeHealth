## Agent A: `02_Agent_Work_Pack/A_Database_Migration.md`

```markdown
# Agent A — Database Migration
# Sprint P0 | Task: P0B (Foundation)
# Reference: 01_P0_Implementation_Pack.md § 4, § 5.2

---

## Vai Trò

Agent A chịu trách nhiệm toàn bộ database layer:
- Migration files
- Drizzle schema updates
- Seed data
- Backfill scripts

Agent A phải hoàn thành TRƯỚC khi Agent B và C bắt đầu.

---

## Deliverables

### 1. Migration Files

Tạo 4 files trong `drizzle/migrations/`:

#### File: `0001_add_rule_versions.sql`

```sql
-- P0B: Add rule_versions table
-- Run this first - other migrations depend on it

CREATE TABLE IF NOT EXISTS rule_versions (
  id                          SERIAL PRIMARY KEY,
  version                     INTEGER NOT NULL,
  description                 TEXT,
  health_weights              JSONB NOT NULL DEFAULT '{"trend":0.35,"derivative":0.35,"volume":0.20,"momentum":0.10}',
  confidence_weights          JSONB NOT NULL DEFAULT '{"binance_spot":0.40,"binance_futures":0.40,"coingecko":0.20}',
  recommendation_thresholds   JSONB NOT NULL DEFAULT '{"strong_watch":90,"watch":80,"observe":65}',
  is_active                   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  activated_at                TIMESTAMP,
  
  CONSTRAINT rule_versions_version_unique UNIQUE (version)
);

-- Index for fast active lookup
CREATE INDEX idx_rule_versions_active
  ON rule_versions(is_active)
  WHERE is_active = TRUE;

-- Seed version 1
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
  'Initial default configuration - migrated from hardcoded values',
  '{"trend": 0.35, "derivative": 0.35, "volume": 0.20, "momentum": 0.10}',
  '{"binance_spot": 0.40, "binance_futures": 0.40, "coingecko": 0.20}',
  '{"strong_watch": 90, "watch": 80, "observe": 65}',
  TRUE,
  NOW()
) ON CONFLICT (version) DO NOTHING;
File: 0002_alter_health_scores.sql
SQL

-- P0B: Add rule_version_id to health_scores
-- Requires: 0001_add_rule_versions.sql

ALTER TABLE health_scores
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL;

-- Backfill all existing records with version 1
UPDATE health_scores
  SET rule_version_id = (
    SELECT id FROM rule_versions WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_health_scores_rule_version
  ON health_scores(rule_version_id);
File: 0003_alter_recommendations.sql
SQL

-- P0B: Add rule_version_id to recommendations
-- Requires: 0001_add_rule_versions.sql

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL;

UPDATE recommendations
  SET rule_version_id = (
    SELECT id FROM rule_versions WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_recommendations_rule_version
  ON recommendations(rule_version_id);
File: 0004_alter_narrative_health.sql
SQL

-- P0A + P0B: Enhance narrative_health
-- Requires: 0001_add_rule_versions.sql

ALTER TABLE narrative_health
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS weighting_method VARCHAR(20)
    NOT NULL DEFAULT 'equal',
  ADD COLUMN IF NOT EXISTS weight_details JSONB;

-- Backfill version
UPDATE narrative_health
  SET rule_version_id = (
    SELECT id FROM rule_versions WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

-- Backfill weighting_method
UPDATE narrative_health
  SET weighting_method = 'equal'
  WHERE weighting_method IS NULL;

CREATE INDEX IF NOT EXISTS idx_narrative_health_rule_version
  ON narrative_health(rule_version_id);

CREATE INDEX IF NOT EXISTS idx_narrative_health_weighting
  ON narrative_health(weighting_method);
2. Drizzle Schema Updates
File: src/lib/db/schema.ts

Thêm vào cuối file (KHÔNG xóa existing schema):

TypeScript

// ─── Rule Versions (P0B) ───────────────────────────────

export const ruleVersions = pgTable('rule_versions', {
  id: serial('id').primaryKey(),
  version: integer('version').notNull().unique(),
  description: text('description'),
  healthWeights: jsonb('health_weights')
    .$type<{
      trend:      number;
      derivative: number;
      volume:     number;
      momentum:   number;
    }>()
    .notNull(),
  confidenceWeights: jsonb('confidence_weights')
    .$type<{
      binance_spot:    number;
      binance_futures: number;
      coingecko:       number;
    }>()
    .notNull(),
  recommendationThresholds: jsonb('recommendation_thresholds')
    .$type<{
      strong_watch: number;
      watch:        number;
      observe:      number;
    }>()
    .notNull(),
  isActive:    boolean('is_active').notNull().default(false),
  createdAt:   timestamp('created_at').notNull().defaultNow(),
  activatedAt: timestamp('activated_at'),
});

export type RuleVersion    = typeof ruleVersions.$inferSelect;
export type NewRuleVersion = typeof ruleVersions.$inferInsert;
Update existing tables (add new columns to existing pgTable definitions):

TypeScript

// Trong healthScores table definition, thêm:
ruleVersionId: integer('rule_version_id')
  .references(() => ruleVersions.id),

// Trong recommendations table definition, thêm:
ruleVersionId: integer('rule_version_id')
  .references(() => ruleVersions.id),

// Trong narrativeHealth table definition, thêm:
ruleVersionId: integer('rule_version_id')
  .references(() => ruleVersions.id),
weightingMethod: varchar('weighting_method', { length: 20 })
  .notNull()
  .default('equal'),
weightDetails: jsonb('weight_details')
  .$type<Record<string, {
    coinId:      number;
    symbol:      string;
    weight:      number;
    marketCap:   number | null;
    healthScore: number;
  }>>(),
3. Rollback Script
File: drizzle/rollback/P0_rollback.sql

SQL

-- P0 Rollback Script
-- Run in REVERSE ORDER if migration fails

-- Step 4: Revert narrative_health
ALTER TABLE narrative_health
  DROP COLUMN IF EXISTS weight_details,
  DROP COLUMN IF EXISTS weighting_method,
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_narrative_health_weighting;
DROP INDEX IF EXISTS idx_narrative_health_rule_version;

-- Step 3: Revert recommendations
ALTER TABLE recommendations
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_recommendations_rule_version;

-- Step 2: Revert health_scores
ALTER TABLE health_scores
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_health_scores_rule_version;

-- Step 1: Drop rule_versions (last, others reference it)
DROP INDEX IF EXISTS idx_rule_versions_active;
DROP TABLE IF EXISTS rule_versions;
Checklist Agent A
 4 migration files created in drizzle/migrations/
 Schema.ts updated với ruleVersions table
 Schema.ts updated với new columns trên 3 existing tables
 npx drizzle-kit push runs without error
 Verify: SELECT * FROM rule_versions; returns 1 row (version=1, is_active=true)
 Verify: backfill worked on all tables
 Rollback script tested (run and re-run migration)
 No existing data lost (row counts match before/after)
Handoff to Agent B & C
Sau khi hoàn thành, notify:

Agent B: DB ready, can start service layer
Agent C: DB ready, rule_version_id available in health_scores
text


---

## Agent B: `02_Agent_Work_Pack/B_Service_Layer.md`

```markdown
# Agent B — Service Layer
# Sprint P0 | Task: P0A + P0B Services
# Reference: 01_P0_Implementation_Pack.md § 5.1, § 5.2, § 5.3
# Depends on: Agent A complete

---

## Vai Trò

Agent B implement business logic:
- RuleVersionService (P0B)
- NarrativeHealthService with weighting (P0A)
- HealthTimelineService (P0C)
- Update refresh pipeline to use rule versions

---

## File Structure
src/lib/
├── types/
│ ├── rule-version.ts (NEW)
│ ├── narrative-health.ts (UPDATE)
│ └── health-timeline.ts (NEW)
├── services/
│ ├── rule-version.service.ts (NEW)
│ ├── health-timeline.service.ts (NEW)
│ └── narrative.service.ts (UPDATE)
└── scoring/
└── narrative-health.ts (NEW/UPDATE)

text


---

## Deliverable 1: Type Definitions

### File: `src/lib/types/rule-version.ts` (NEW)

```typescript
export interface RuleVersion {
  id:                       number;
  version:                  number;
  description:              string | null;
  healthWeights:            HealthWeights;
  confidenceWeights:        ConfidenceWeights;
  recommendationThresholds: RecommendationThresholds;
  isActive:                 boolean;
  createdAt:                Date;
  activatedAt:              Date | null;
}

export interface HealthWeights {
  trend:      number;
  derivative: number;
  volume:     number;
  momentum:   number;
}

export interface ConfidenceWeights {
  binance_spot:    number;
  binance_futures: number;
  coingecko:       number;
}

export interface RecommendationThresholds {
  strong_watch: number;
  watch:        number;
  observe:      number;
}

export interface CreateRuleVersionInput {
  description?:             string;
  healthWeights:            HealthWeights;
  confidenceWeights:        ConfidenceWeights;
  recommendationThresholds: RecommendationThresholds;
}
File: src/lib/types/health-timeline.ts (NEW)
TypeScript

export type HealthStatus =
  | 'STRONG'
  | 'HEALTHY'
  | 'NEUTRAL'
  | 'CAUTION'
  | 'WEAK';

export interface HealthTimelinePoint {
  date:        string;
  healthScore: number;
  status:      HealthStatus;
  change:      number | null;
}

export interface HealthTrend {
  direction: 'improving' | 'declining' | 'stable';
  slope:     number;
  change7d:  number;
  change30d: number;
}

export interface HealthTimeline {
  coinId:  number;
  symbol:  string;
  points:  HealthTimelinePoint[];
  trend:   HealthTrend;
}
Deliverable 2: RuleVersionService
File: src/lib/services/rule-version.service.ts (NEW)
TypeScript

import { db } from '@/lib/db';
import { ruleVersions } from '@/lib/db/schema';
import { eq, ne, max, desc } from 'drizzle-orm';
import type {
  RuleVersion,
  CreateRuleVersionInput,
  HealthWeights,
} from '@/lib/types/rule-version';

export class RuleVersionService {

  // ── GET ──────────────────────────────────────────

  async getActiveVersion(): Promise<RuleVersion> {
    const rows = await db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.isActive, true))
      .limit(1);

    if (!rows.length) {
      throw new Error(
        'No active rule version found. ' +
        'Run database seed or create a rule version first.'
      );
    }

    return this.mapRow(rows[0]);
  }

  async getAllVersions(): Promise<RuleVersion[]> {
    const rows = await db
      .select()
      .from(ruleVersions)
      .orderBy(desc(ruleVersions.version));

    return rows.map(r => this.mapRow(r));
  }

  async getVersionById(id: number): Promise<RuleVersion | null> {
    const rows = await db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.id, id))
      .limit(1);

    return rows.length ? this.mapRow(rows[0]) : null;
  }

  // ── CREATE ────────────────────────────────────────

  async createVersion(
    input: CreateRuleVersionInput,
    activateImmediately: boolean = false
  ): Promise<RuleVersion> {
    // Validate
    this.validateWeights(input.healthWeights, 'healthWeights');
    this.validateWeights(input.confidenceWeights, 'confidenceWeights');
    this.validateThresholds(input.recommendationThresholds);

    // Get next version number
    const result = await db
      .select({ maxVersion: max(ruleVersions.version) })
      .from(ruleVersions);
    const nextVersion = (result[0].maxVersion ?? 0) + 1;

    const [created] = await db
      .insert(ruleVersions)
      .values({
        version:                  nextVersion,
        description:              input.description ?? null,
        healthWeights:            input.healthWeights,
        confidenceWeights:        input.confidenceWeights,
        recommendationThresholds: input.recommendationThresholds,
        isActive:                 false,
        activatedAt:              null,
      })
      .returning();

    if (activateImmediately) {
      await this.activate(created.id);
      created.isActive    = true;
      created.activatedAt = new Date();
    }

    return this.mapRow(created);
  }

  // ── ACTIVATE ──────────────────────────────────────

  async activate(versionId: number): Promise<void> {
    // Verify version exists
    const exists = await this.getVersionById(versionId);
    if (!exists) {
      throw new Error(`Rule version ${versionId} not found`);
    }

    await db.transaction(async (tx) => {
      // Deactivate all
      await tx
        .update(ruleVersions)
        .set({ isActive: false })
        .where(ne(ruleVersions.id, versionId));

      // Activate target
      await tx
        .update(ruleVersions)
        .set({
          isActive:    true,
          activatedAt: new Date(),
        })
        .where(eq(ruleVersions.id, versionId));
    });
  }

  // ── VALIDATION ────────────────────────────────────

  private validateWeights(
    weights: Record<string, number>,
    fieldName: string
  ): void {
    const values = Object.values(weights);
    if (values.some(v => v < 0 || v > 1)) {
      throw new Error(`${fieldName}: all weights must be between 0 and 1`);
    }
    const sum = values.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(
        `${fieldName}: weights must sum to 1.0, got ${sum.toFixed(4)}`
      );
    }
  }

  private validateThresholds(
    thresholds: { strong_watch: number; watch: number; observe: number }
  ): void {
    if (thresholds.strong_watch <= thresholds.watch) {
      throw new Error('strong_watch must be greater than watch');
    }
    if (thresholds.watch <= thresholds.observe) {
      throw new Error('watch must be greater than observe');
    }
    if (thresholds.observe < 0 || thresholds.strong_watch > 100) {
      throw new Error('Thresholds must be between 0 and 100');
    }
  }

  // ── MAPPER ────────────────────────────────────────

  private mapRow(row: typeof ruleVersions.$inferSelect): RuleVersion {
    return {
      id:                       row.id,
      version:                  row.version,
      description:              row.description,
      healthWeights:            row.healthWeights as HealthWeights,
      confidenceWeights:        row.confidenceWeights as any,
      recommendationThresholds: row.recommendationThresholds as any,
      isActive:                 row.isActive,
      createdAt:                row.createdAt,
      activatedAt:              row.activatedAt,
    };
  }
}

// Singleton export
export const ruleVersionService = new RuleVersionService();
Deliverable 3: Narrative Health with Weighting
File: src/lib/scoring/narrative-health.ts (NEW or UPDATE)
TypeScript

import type { RuleVersion } from '@/lib/types/rule-version';
import type {
  NarrativeHealthResult,
  CoinWeightDetail,
} from '@/lib/types/narrative-health';

export interface CoinHealthData {
  coinId:        number;
  symbol:        string;
  healthScore:   number;
  confidenceScore: number;
  marketCap:     number | null;  // From coin_metrics
}

export function calculateWeightedNarrativeHealth(
  narrativeId:  number,
  date:         string,
  coinScores:   CoinHealthData[],
  ruleVersionId: number,
  previousScore?: number
): NarrativeHealthResult {

  if (coinScores.length === 0) {
    throw new Error(`No coins found for narrative ${narrativeId}`);
  }

  // ── Step 1: Determine weighting method ──────────────

  const missingMcap = coinScores.filter(
    c => !c.marketCap || c.marketCap <= 0
  );

  let weightingMethod: 'market_cap' | 'equal';
  let weights: Map<number, number>;

  if (missingMcap.length > 0) {
    // Equal weight fallback
    weightingMethod = 'equal';
    const equalWeight = 1 / coinScores.length;
    weights = new Map(coinScores.map(c => [c.coinId, equalWeight]));
  } else {
    // Market cap weighted
    weightingMethod = 'market_cap';
    const totalMcap = coinScores.reduce((s, c) => s + c.marketCap!, 0);

    if (totalMcap === 0) {
      // Defensive fallback
      weightingMethod = 'equal';
      const equalWeight = 1 / coinScores.length;
      weights = new Map(coinScores.map(c => [c.coinId, equalWeight]));
    } else {
      weights = new Map(
        coinScores.map(c => [c.coinId, c.marketCap! / totalMcap])
      );
    }
  }

  // ── Step 2: Calculate weighted health ───────────────

  const weightedHealth = coinScores.reduce((sum, coin) => {
    const w = weights.get(coin.coinId) ?? 0;
    return sum + coin.healthScore * w;
  }, 0);

  // ── Step 3: Build weight_details ────────────────────

  const weightDetails: Record<string, CoinWeightDetail> = {};
  for (const coin of coinScores) {
    weightDetails[coin.symbol] = {
      coinId:      coin.coinId,
      symbol:      coin.symbol,
      weight:      Math.round((weights.get(coin.coinId) ?? 0) * 10000) / 10000,
      marketCap:   coin.marketCap,
      healthScore: coin.healthScore,
    };
  }

  // ── Step 4: Top & weakest ───────────────────────────

  const sorted = [...coinScores].sort(
    (a, b) => b.healthScore - a.healthScore
  );
  const topCoin     = sorted[0];
  const weakestCoin = sorted[sorted.length - 1];

  // ── Step 5: Average confidence ──────────────────────

  const avgConfidence = coinScores.reduce(
    (s, c) => s + c.confidenceScore, 0
  ) / coinScores.length;

  // ── Step 6: Score change ────────────────────────────

  const finalScore = Math.round(weightedHealth * 100) / 100;
  const scoreChange = previousScore !== undefined
    ? Math.round((finalScore - previousScore) * 100) / 100
    : null;

  return {
    narrativeId,
    date,
    healthScore:     finalScore,
    status:          scoreToStatus(finalScore),
    scoreChange,
    avgConfidence:   Math.round(avgConfidence * 100) / 100,
    topCoinId:       topCoin?.coinId ?? null,
    weakestCoinId:   weakestCoin?.coinId ?? null,
    ruleVersionId,
    weightingMethod,
    weightDetails,
  };
}

export function scoreToStatus(score: number): HealthStatus {
  if (score >= 90) return 'STRONG';
  if (score >= 80) return 'HEALTHY';
  if (score >= 65) return 'NEUTRAL';
  if (score >= 50) return 'CAUTION';
  return 'WEAK';
}

type HealthStatus = 'STRONG' | 'HEALTHY' | 'NEUTRAL' | 'CAUTION' | 'WEAK';
Deliverable 4: HealthTimelineService
File: src/lib/services/health-timeline.service.ts (NEW)
TypeScript

import { db } from '@/lib/db';
import { healthScores, coins } from '@/lib/db/schema';
import { eq, and, gte, asc } from 'drizzle-orm';
import type {
  HealthTimeline,
  HealthTimelinePoint,
  HealthTrend,
  HealthStatus,
} from '@/lib/types/health-timeline';

export class HealthTimelineService {

  async getCoinTimeline(
    coinId: number,
    days:   number = 30
  ): Promise<HealthTimeline> {
    const sinceDate = this.daysAgoStr(days);

    // Fetch health score history
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
          gte(healthScores.date, sinceDate)
        )
      )
      .orderBy(asc(healthScores.date));

    // Fetch coin symbol
    const coinRows = await db
      .select({ symbol: coins.symbol })
      .from(coins)
      .where(eq(coins.id, coinId))
      .limit(1);

    const symbol = coinRows[0]?.symbol ?? '';

    // Build points
    const points: HealthTimelinePoint[] = records.map(r => ({
      date:        r.date,
      healthScore: Number(r.healthScore),
      status:      (r.status ?? 'NEUTRAL') as HealthStatus,
      change:      r.scoreChange ? Number(r.scoreChange) : null,
    }));

    return {
      coinId,
      symbol,
      points,
      trend: this.calculateTrend(points),
    };
  }

  // ── Trend Calculation ──────────────────────────────

  private calculateTrend(points: HealthTimelinePoint[]): HealthTrend {
    if (points.length < 2) {
      return { direction: 'stable', slope: 0, change7d: 0, change30d: 0 };
    }

    const latest  = points[points.length - 1].healthScore;
    const oldest  = points[0].healthScore;

    // 7-day reference point
    const idx7d   = Math.max(0, points.length - 7);
    const change7d = latest - points[idx7d].healthScore;

    // 30-day change
    const change30d = latest - oldest;

    // Linear slope on last 7 (or all) points
    const recentPoints = points.slice(-7);
    const slope = this.linearSlope(
      recentPoints.map((p, i) => [i, p.healthScore] as [number, number])
    );

    return {
      direction: slope >  0.5 ? 'improving'
               : slope < -0.5 ? 'declining'
               : 'stable',
      slope:    Math.round(slope * 100) / 100,
      change7d: Math.round(change7d * 100) / 100,
      change30d: Math.round(change30d * 100) / 100,
    };
  }

  private linearSlope(points: [number, number][]): number {
    const n = points.length;
    if (n < 2) return 0;

    const sumX  = points.reduce((s, [x])    => s + x,     0);
    const sumY  = points.reduce((s, [, y])  => s + y,     0);
    const sumXY = points.reduce((s, [x, y]) => s + x * y, 0);
    const sumX2 = points.reduce((s, [x])    => s + x * x, 0);

    const denom = n * sumX2 - sumX * sumX;
    return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  }

  private daysAgoStr(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  }
}

export const healthTimelineService = new HealthTimelineService();
Deliverable 5: Update Refresh Pipeline
File: src/lib/refresh/pipeline.ts (UPDATE existing file)
TypeScript

// Tìm hàm xử lý global refresh
// Thêm rule version loading:

import { ruleVersionService } from '@/lib/services/rule-version.service';

async function runGlobalRefresh() {
  // ... existing code ...
  
  // ADD: Load active rule version
  const activeVersion = await ruleVersionService.getActiveVersion();
  
  // Truyền activeVersion vào các bước tính toán:
  // - calculateHealthScore(features, activeVersion.healthWeights)
  // - generateRecommendation(health, activeVersion.recommendationThresholds)
  
  // Khi save health_scores:
  await db.insert(healthScores).values({
    // ... existing fields ...
    ruleVersionId: activeVersion.id,  // ADD THIS
  });
  
  // Khi save recommendations:
  await db.insert(recommendations).values({
    // ... existing fields ...
    ruleVersionId: activeVersion.id,  // ADD THIS
  });
}
Checklist Agent B
 src/lib/types/rule-version.ts created
 src/lib/types/health-timeline.ts created
 src/lib/types/narrative-health.ts updated
 RuleVersionService implemented với all methods
 HealthTimelineService implemented
 calculateWeightedNarrativeHealth() implemented
 Refresh pipeline updated to use rule_version_id
 Unit tests viết và pass:
 rule-version.service.test.ts
 health-timeline.service.test.ts
 narrative-health.test.ts
 No TypeScript errors
Handoff to Agent C & D
Agent C: Services ready, can build API routes
Agent D: Timeline service ready, can build UI
text


---

## Agent C: `02_Agent_Work_Pack/C_API_Routes.md`

```markdown
# Agent C — API Routes
# Sprint P0 | Task: API Endpoints
# Reference: 01_P0_Implementation_Pack.md § 3.4
# Depends on: Agent A + Agent B complete

---

## Vai Trò

Agent C implement tất cả API endpoints mới:
- Health timeline endpoints
- Rule version management endpoints
- Update narrative health response format

---

## Deliverables

### 1. GET /api/coins/[id]/health-timeline

File: `src/app/api/coins/[id]/health-timeline/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { healthTimelineService } from '@/lib/services/health-timeline.service';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const coinId = parseInt(params.id);
    if (isNaN(coinId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid coin ID' },
        { status: 400 }
      );
    }

    const daysParam = request.nextUrl.searchParams.get('days');
    const days = daysParam ? Math.min(parseInt(daysParam) || 30, 90) : 30;

    const timeline = await healthTimelineService.getCoinTimeline(coinId, days);

    return NextResponse.json({ success: true, data: timeline });

  } catch (error) {
    console.error('[health-timeline] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch health timeline' },
      { status: 500 }
    );
  }
}
2. GET /api/narratives/[id]/health-timeline
File: src/app/api/narratives/[id]/health-timeline/route.ts

TypeScript

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { narrativeHealth, coins, coinNarratives } from '@/lib/db/schema';
import { eq, and, gte, asc } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const narrativeId = parseInt(params.id);
    if (isNaN(narrativeId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid narrative ID' },
        { status: 400 }
      );
    }

    const daysParam = request.nextUrl.searchParams.get('days');
    const days = daysParam ? Math.min(parseInt(daysParam) || 30, 90) : 30;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    // Fetch narrative health history
    const records = await db
      .select({
        date:            narrativeHealth.date,
        healthScore:     narrativeHealth.healthScore,
        status:          narrativeHealth.status,
        scoreChange:     narrativeHealth.scoreChange,
        weightingMethod: narrativeHealth.weightingMethod,
        weightDetails:   narrativeHealth.weightDetails,
      })
      .from(narrativeHealth)
      .where(
        and(
          eq(narrativeHealth.narrativeId, narrativeId),
          gte(narrativeHealth.date, sinceStr)
        )
      )
      .orderBy(asc(narrativeHealth.date));

    return NextResponse.json({
      success: true,
      data: {
        narrativeId,
        points: records.map(r => ({
          date:            r.date,
          healthScore:     Number(r.healthScore),
          status:          r.status,
          change:          r.scoreChange ? Number(r.scoreChange) : null,
          weightingMethod: r.weightingMethod,
        })),
      },
    });

  } catch (error) {
    console.error('[narrative health-timeline] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch narrative health timeline' },
      { status: 500 }
    );
  }
}
3. Rule Version API Routes
GET + POST /api/admin/rule-versions
File: src/app/api/admin/rule-versions/route.ts

TypeScript

import { NextRequest, NextResponse } from 'next/server';
import { ruleVersionService } from '@/lib/services/rule-version.service';

// GET: List all versions
export async function GET() {
  try {
    const versions = await ruleVersionService.getAllVersions();
    return NextResponse.json({ success: true, data: versions });
  } catch (error) {
    console.error('[rule-versions GET] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch rule versions' },
      { status: 500 }
    );
  }
}

// POST: Create new version
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      description,
      healthWeights,
      confidenceWeights,
      recommendationThresholds,
      activateImmediately = false,
    } = body;

    // Validate required fields
    if (!healthWeights || !confidenceWeights || !recommendationThresholds) {
      return NextResponse.json(
        { success: false, error: 'Missing required weight configurations' },
        { status: 400 }
      );
    }

    const version = await ruleVersionService.createVersion(
      { description, healthWeights, confidenceWeights, recommendationThresholds },
      activateImmediately
    );

    return NextResponse.json(
      { success: true, data: version },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('[rule-versions POST] Error:', error);
    if (error.message?.includes('must sum to 1.0') ||
        error.message?.includes('must be greater than')) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 422 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to create rule version' },
      { status: 500 }
    );
  }
}
POST /api/admin/rule-versions/[id]/activate
File: src/app/api/admin/rule-versions/[id]/activate/route.ts

TypeScript

import { NextRequest, NextResponse } from 'next/server';
import { ruleVersionService } from '@/lib/services/rule-version.service';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const versionId = parseInt(params.id);
    if (isNaN(versionId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid version ID' },
        { status: 400 }
      );
    }

    await ruleVersionService.activate(versionId);

    const activated = await ruleVersionService.getVersionById(versionId);

    return NextResponse.json({
      success: true,
      data: {
        activated: true,
        version:   activated?.version,
        activatedAt: activated?.activatedAt,
      },
    });

  } catch (error: any) {
    console.error('[rule-versions activate] Error:', error);
    if (error.message?.includes('not found')) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { success: false, error: 'Failed to activate rule version' },
      { status: 500 }
    );
  }
}
Checklist Agent C
 GET /api/coins/[id]/health-timeline implemented
 GET /api/narratives/[id]/health-timeline implemented
 GET /api/admin/rule-versions implemented
 POST /api/admin/rule-versions implemented
 POST /api/admin/rule-versions/[id]/activate implemented
 All routes return { success: true/false, data/error }
 HTTP status codes đúng (200, 201, 400, 404, 422, 500)
 Error messages clear và actionable
 Input validation on all POST routes
 Manual test với curl hoặc Postman
Test Commands
Bash

# Test health timeline
curl http://localhost:3000/api/coins/1/health-timeline?days=30

# Test narrative timeline
curl http://localhost:3000/api/narratives/1/health-timeline

# Test rule versions list
curl http://localhost:3000/api/admin/rule-versions

# Test create version
curl -X POST http://localhost:3000/api/admin/rule-versions \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Test version",
    "healthWeights": {"trend":0.35,"derivative":0.35,"volume":0.20,"momentum":0.10},
    "confidenceWeights": {"binance_spot":0.40,"binance_futures":0.40,"coingecko":0.20},
    "recommendationThresholds": {"strong_watch":90,"watch":80,"observe":65}
  }'

# Test activate
curl -X POST http://localhost:3000/api/admin/rule-versions/1/activate
text


---

## Agent D: `02_Agent_Work_Pack/D_Frontend_UI.md`

```markdown
# Agent D — Frontend UI
# Sprint P0 | Task: P0C UI Components
# Reference: 01_P0_Implementation_Pack.md § 6
# Depends on: Agent C (API routes ready)

---

## Vai Trò

Agent D implement UI components:
- HealthSparkline (mini chart cho Narrative card)
- HealthTimeline (full chart cho Coin Detail page)
- TrendArrow component
- Update Narrative card
- Update Coin Detail page
- Admin UI: Rule Version management tab

---

## Deliverable 1: TrendArrow Component

File: `src/components/ui/trend-arrow.tsx`

```typescript
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendArrowProps {
  direction: 'improving' | 'declining' | 'stable';
  change7d:  number;
  size?:     'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const sizeMap = {
  sm:  'h-3 w-3',
  md:  'h-4 w-4',
  lg:  'h-5 w-5',
};

const textSizeMap = {
  sm:  'text-xs',
  md:  'text-sm',
  lg:  'text-base',
};

export function TrendArrow({
  direction,
  change7d,
  size = 'md',
  showLabel = true,
}: TrendArrowProps) {
  const config = {
    improving: {
      icon:  TrendingUp,
      color: 'text-green-500',
      label: `+${change7d.toFixed(1)}`,
    },
    declining: {
      icon:  TrendingDown,
      color: 'text-red-500',
      label: `${change7d.toFixed(1)}`,
    },
    stable: {
      icon:  Minus,
      color: 'text-gray-400',
      label: `${change7d > 0 ? '+' : ''}${change7d.toFixed(1)}`,
    },
  }[direction];

  const Icon = config.icon;

  return (
    <span className={cn('inline-flex items-center gap-1', config.color)}>
      <Icon className={sizeMap[size]} />
      {showLabel && (
        <span className={cn('font-medium tabular-nums', textSizeMap[size])}>
          {config.label}
        </span>
      )}
    </span>
  );
}
Deliverable 2: HealthSparkline Component
File: src/components/ui/health-sparkline.tsx

TypeScript

'use client';

import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendArrow } from './trend-arrow';
import type { HealthTimelinePoint, HealthTrend } from '@/lib/types/health-timeline';

interface HealthSparklineProps {
  points: HealthTimelinePoint[];
  trend:  HealthTrend;
  width?:  number;
  height?: number;
}

function getLineColor(trend: HealthTrend['direction']): string {
  return trend === 'improving' ? '#22c55e'
       : trend === 'declining' ? '#ef4444'
       : '#94a3b8';
}

export function HealthSparkline({
  points,
  trend,
  width  = 80,
  height = 32,
}: HealthSparklineProps) {
  // Use last 7 points
  const data = points.slice(-7);

  if (data.length === 0) {
    return (
      <span className="text-xs text-gray-400">No data</span>
    );
  }

  const color = getLineColor(trend.direction);

  return (
    <div className="flex items-center gap-2">
      {/* Mini chart */}
      <div style={{ width, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="healthScore"
              stroke={color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as HealthTimelinePoint;
                return (
                  <div className="rounded bg-gray-900 px-2 py-1 text-xs text-white shadow">
                    <div>{p.date}</div>
                    <div>Score: {p.healthScore.toFixed(1)}</div>
                    <div>{p.status}</div>
                  </div>
                );
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Trend arrow */}
      <TrendArrow
        direction={trend.direction}
        change7d={trend.change7d}
        size="sm"
      />
    </div>
  );
}
Deliverable 3: HealthTimeline Full Chart
File: src/components/health-timeline.tsx

TypeScript

'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { TrendArrow } from '@/components/ui/trend-arrow';
import type { HealthTimeline } from '@/lib/types/health-timeline';

interface HealthTimelineProps {
  coinId: number;
  days?:  number;
}

async function fetchTimeline(
  coinId: number,
  days: number
): Promise<HealthTimeline> {
  const res = await fetch(
    `/api/coins/${coinId}/health-timeline?days=${days}`
  );
  if (!res.ok) throw new Error('Failed to fetch timeline');
  const json = await res.json();
  return json.data;
}

const STATUS_COLORS = {
  STRONG:  '#22c55e',
  HEALTHY: '#84cc16',
  NEUTRAL: '#f59e0b',
  CAUTION: '#f97316',
  WEAK:    '#ef4444',
} as const;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900 p-3 shadow-lg">
      <p className="mb-1 text-xs text-gray-400">{label}</p>
      <p className="text-sm font-bold text-white">
        Score: {Number(d.healthScore).toFixed(1)}
      </p>
      <p className="text-xs" style={{ color: STATUS_COLORS[d.status as keyof typeof STATUS_COLORS] ?? '#fff' }}>
        {d.status}
      </p>
      {d.change !== null && (
        <p className={`text-xs ${d.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {d.change >= 0 ? '+' : ''}{Number(d.change).toFixed(1)} vs prev
        </p>
      )}
    </div>
  );
};

export function HealthTimeline({ coinId, days = 30 }: HealthTimelineProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['health-timeline', coinId, days],
    queryFn:  () => fetchTimeline(coinId, days),
    staleTime: 5 * 60 * 1000,  // 5 minutes
  });

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="text-sm text-gray-400">Loading timeline...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="text-sm text-red-400">Failed to load timeline</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Trend Summary */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-300">
          Health Timeline ({days}d)
        </h3>
        <div className="flex items-center gap-3 text-sm">
          <TrendArrow
            direction={data.trend.direction}
            change7d={data.trend.change7d}
            size="sm"
          />
          <span className="text-gray-400 text-xs">
            30d: {data.trend.change30d >= 0 ? '+' : ''}{data.trend.change30d.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data.points}
            margin={{ top: 5, right: 5, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="healthGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              tickFormatter={(v: string) => v.slice(5)} // MM-DD
              tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: '#9CA3AF', fontSize: 11 }}
              tickLine={false}
            />
            {/* Status zones */}
            <ReferenceLine y={90} stroke="#22c55e" strokeDasharray="2 4" strokeOpacity={0.4} label={{ value: 'STRONG', fill: '#22c55e', fontSize: 9 }} />
            <ReferenceLine y={80} stroke="#84cc16" strokeDasharray="2 4" strokeOpacity={0.4} />
            <ReferenceLine y={65} stroke="#f59e0b" strokeDasharray="2 4" strokeOpacity={0.4} />
            <ReferenceLine y={50} stroke="#ef4444" strokeDasharray="2 4" strokeOpacity={0.4} />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="healthScore"
              stroke="#22c55e"
              strokeWidth={2}
              fill="url(#healthGradient)"
              dot={false}
              activeDot={{ r: 4, fill: '#22c55e' }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Reference lines legend */}
      <div className="flex gap-4 text-xs text-gray-500">
        <span><span className="text-green-500">●</span> 90 Strong</span>
        <span><span className="text-lime-500">●</span> 80 Healthy</span>
        <span><span className="text-amber-500">●</span> 65 Neutral</span>
        <span><span className="text-red-500">●</span> 50 Caution</span>
      </div>
    </div>
  );
}
Deliverable 4: Update Narrative Card
File: Update src/components/narrative-card.tsx (or equivalent)

TypeScript

// Thêm vào NarrativeCard component:

// 1. Fetch sparkline data
const { data: timeline } = useQuery({
  queryKey: ['health-timeline', narrative.id, 7],
  queryFn:  () => fetch(`/api/coins/${topCoinId}/health-timeline?days=7`)
                   .then(r => r.json())
                   .then(j => j.data),
  enabled: !!topCoinId,
  staleTime: 5 * 60 * 1000,
});

// 2. Thêm vào render:
{timeline && (
  <div className="mt-2">
    <HealthSparkline
      points={timeline.points}
      trend={timeline.trend}
      width={80}
      height={28}
    />
  </div>
)}

// 3. Hiển thị weighting method badge:
{narrative.weightingMethod === 'market_cap' ? (
  <span className="text-xs text-blue-400">⚖️ Market Cap Weighted</span>
) : (
  <span className="text-xs text-gray-500">= Equal Weighted</span>
)}
Deliverable 5: Update Coin Detail Page
File: Update src/app/coin/[id]/page.tsx

TypeScript

// Thêm HealthTimeline section:

import { HealthTimeline } from '@/components/health-timeline';

// Trong JSX, sau Score Breakdown section:
<section className="rounded-xl border border-gray-700 bg-gray-800/50 p-6">
  <HealthTimeline coinId={coin.id} days={30} />
</section>
Deliverable 6: Admin Rule Versions Tab
File: Update src/app/admin/page.tsx

TypeScript

// Thêm tab "Rule Versions" vào Admin Panel

// Tab content:
function RuleVersionsTab() {
  const { data: versions } = useQuery({
    queryKey: ['rule-versions'],
    queryFn:  () => fetch('/api/admin/rule-versions')
                     .then(r => r.json())
                     .then(j => j.data),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Rule Versions</h2>
        <button className="btn-primary">New Version</button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-gray-400">
            <th className="py-2 text-left">Version</th>
            <th className="py-2 text-left">Description</th>
            <th className="py-2 text-left">Status</th>
            <th className="py-2 text-left">Activated</th>
            <th className="py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {versions?.map((v: any) => (
            <tr key={v.id} className="border-b border-gray-800">
              <td className="py-3 font-mono">v{v.version}</td>
              <td className="py-3 text-gray-300">{v.description ?? '—'}</td>
              <td className="py-3">
                {v.isActive ? (
                  <span className="rounded-full bg-green-900/50 px-2 py-0.5 text-xs text-green-400">
                    Active
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-400">
                    Inactive
                  </span>
                )}
              </td>
              <td className="py-3 text-gray-400 text-xs">
                {v.activatedAt
                  ? new Date(v.activatedAt).toLocaleDateString()
                  : '—'}
              </td>
              <td className="py-3">
                {!v.isActive && (
                  <button
                    className="text-xs text-blue-400 hover:text-blue-300"
                    onClick={() => activateVersion(v.id)}
                  >
                    Activate
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
Checklist Agent D
 TrendArrow component implemented
 HealthSparkline component implemented
 HealthTimeline full chart implemented
 Narrative card updated với sparkline
 Narrative card hiển thị weighting method badge
 Coin Detail page có HealthTimeline section
 Admin panel có Rule Versions tab
 All components responsive
 Dark mode consistent với existing UI
 No console errors
 Loading states handled
 Error states handled
text


---

## Agent E: `02_Agent_Work_Pack/E_Technical_Fixes.md`

```markdown
# Agent E — Technical Fixes
# Sprint P0 | Task: P0D + P0E (Quick Fixes)
# Reference: 01_P0_Implementation_Pack.md § 5.4
# Depends on: Nothing (independent)

---

## Vai Trò

Agent E fix 2 bugs critical trong Technical Analysis engine.
Đây là các bug fix độc lập, không cần đợi Agent khác.
Nên làm NGAY khi sprint bắt đầu.

---

## Fix P0D: ADX Guard in scoring.ts

### Problem

```typescript
// CURRENT CODE (BUG):
if (isFinite(adxV)) {
  const strength  = Math.min(adxV / 50, 1.0);
  const direction = pdiV > mdiV ? 1 : -1;
  // ↑ NaN > NaN = false → direction always -1 when DI values are NaN!
Root Cause
isFinite(NaN) returns false, so when adxV is finite but pdiV
or mdiV is NaN, the guard passes but direction calculation is wrong.
NaN > NaN evaluates to false, so direction is always -1 (bearish).

Fix
File: src/lib/technical-analysis/scoring.ts

Find function calcTrendIndicators.
Find the ADX block (around line with adxFull).

FIND:

TypeScript

if (isFinite(adxV)) {
  const strength  = Math.min(adxV / 50, 1.0);
  const direction = pdiV > mdiV ? 1 : -1;
  const adxSig    = clip(direction * strength * 0.85, -1, 1);
  results.push({
    name:        "ADX(14)",
    value:       adxV,
    signal:      adxSig,
    weight:      0.28,
    description:
      `ADX=${adxV.toFixed(1)} +DI=${pdiV.toFixed(1)} -DI=${mdiV.toFixed(1)}` +
      ` | ${adxV > 25 ? "Strong Trend" : "Weak/Range"}`,
  });
}
REPLACE WITH:

TypeScript

if (isFinite(adxV) && isFinite(pdiV) && isFinite(mdiV)) {
  const strength  = Math.min(adxV / 50, 1.0);
  const direction = pdiV > mdiV ? 1 : -1;
  const adxSig    = clip(direction * strength * 0.85, -1, 1);
  results.push({
    name:        "ADX(14)",
    value:       adxV,
    signal:      adxSig,
    weight:      0.28,
    description:
      `ADX=${adxV.toFixed(1)} +DI=${pdiV.toFixed(1)} -DI=${mdiV.toFixed(1)}` +
      ` | ${adxV > 25 ? "Strong Trend" : "Weak/Range"}`,
  });
}
Change summary: Add && isFinite(pdiV) && isFinite(mdiV) to the guard.

Fix P0E: Strength Scale in risk.ts
Problem
TypeScript

// CURRENT CODE (BUG):
const strength = Math.min(Math.abs(compositeScore) * 100, 100);
// compositeScore is already [-100, +100] scale!
// Math.abs(75) * 100 = 7500 → clipped to 100
// Result: strength ALWAYS = 100 for any non-zero score
// → getTpMultipliers() ALWAYS returns [2.0, 4.0, 6.0]
// → All trades use max TP multipliers regardless of signal strength
Root Cause
compositeScore from the scoring pipeline is already on -100 → +100 scale.
Multiplying by 100 again causes the value to always exceed 100,
making all signals appear "strong" when many are actually weak.

Fix
File: src/lib/technical-analysis/risk.ts

Find function calculateRiskLevels.

FIND:

TypeScript

// strength is abs(compositeScore) already on 0-100 scale
const strength = Math.min(Math.abs(compositeScore) * 100, 100);
REPLACE WITH:

TypeScript

// compositeScore is already on [-100, +100] scale
// Use absolute value directly, no multiplication needed
const strength = Math.min(Math.abs(compositeScore), 100);
Change summary: Remove * 100 multiplication.

Verification Tests
Test P0D: ADX Guard
File: src/lib/technical-analysis/__tests__/scoring.test.ts

TypeScript

describe('calcTrendIndicators - ADX Guard', () => {
  it('should NOT emit ADX indicator when plusDI is NaN', () => {
    // Create mock data where ADX computes but DI values are NaN
    // (edge case with very early data points)
    const mockData = createMockKlineData(15); // fewer than period
    const results = calcTrendIndicatorsExposed(mockData);
    const adxResult = results.find(r => r.name === 'ADX(14)');
    
    // Should not have ADX with NaN direction
    if (adxResult) {
      expect(adxResult.signal).toBeFinite();
      expect([-1, 0, 1]).toContainEqual(
        adxResult.signal > 0 ? 1 : adxResult.signal < 0 ? -1 : 0
      );
    }
  });

  it('should emit correct direction when all DI values are finite', () => {
    const mockData = createMockBullishKlineData(50);
    const results = calcTrendIndicatorsExposed(mockData);
    const adxResult = results.find(r => r.name === 'ADX(14)');
    
    if (adxResult) {
      // Bullish data → positive signal
      expect(adxResult.signal).toBeGreaterThan(0);
    }
  });
});
Test P0E: Strength Scale
File: src/lib/technical-analysis/__tests__/risk.test.ts

TypeScript

describe('calculateRiskLevels - Strength Scale', () => {
  const mockData = createMockKlineData(50);

  it('compositeScore=75 → strength=75 → uses [2.0,4.0,6.0] multipliers', () => {
    const result = calculateRiskLevels(mockData, 'LONG', 75);
    expect(result).not.toBeUndefined();
    
    if (result) {
      const price = mockData[mockData.length - 1].close;
      const atrVal = /* calculated ATR value */;
      
      // strength=75 >= 65 → sl_mult=2.0, tp1_mult=2.0
      expect(result.tp1).toBeCloseTo(price + 2.0 * atrVal, 2);
    }
  });

  it('compositeScore=50 → strength=50 → uses [1.8,3.2,5.0] multipliers', () => {
    const result = calculateRiskLevels(mockData, 'LONG', 50);
    expect(result).not.toBeUndefined();
    
    if (result) {
      const price = mockData[mockData.length - 1].close;
      const atrVal = /* calculated ATR value */;
      
      // strength=50 >= 40 → sl_mult=1.8, tp1_mult=1.8
      expect(result.tp1).toBeCloseTo(price + 1.8 * atrVal, 2);
    }
  });

  it('compositeScore=20 → strength=20 → uses [1.5,2.5,4.0] multipliers', () => {
    const result = calculateRiskLevels(mockData, 'LONG', 20);
    expect(result).not.toBeUndefined();
    
    if (result) {
      const price = mockData[mockData.length - 1].close;
      const atrVal = /* calculated ATR value */;
      
      // strength=20 < 40 → sl_mult=1.5, tp1_mult=1.5
      expect(result.tp1).toBeCloseTo(price + 1.5 * atrVal, 2);
    }
  });

  it('compositeScore=-75 → absolute value 75 → same as +75', () => {
    const resultPos = calculateRiskLevels(mockData, 'LONG', 75);
    const resultNeg = calculateRiskLevels(mockData, 'SHORT', -75);
    
    // Both should use same multiplier tier
    expect(resultPos?.rrRatio).toBe(resultNeg?.rrRatio);
  });

  it('OLD BUG: should NOT always return max multipliers', () => {
    // With old bug: compositeScore=20 * 100 = 2000, clipped to 100
    // → always strength=100 → always [2.0,4.0,6.0]
    // With fix: compositeScore=20 → strength=20 → [1.5,2.5,4.0]
    const weakResult = calculateRiskLevels(mockData, 'LONG', 20);
    const strongResult = calculateRiskLevels(mockData, 'LONG', 75);
    
    // Weak signal should have smaller TP ratio than strong
    expect(weakResult?.rrRatio).toBeLessThan(strongResult?.rrRatio ?? 0);
  });
});
Checklist Agent E
 scoring.ts ADX guard updated (3 conditions not 1)
 risk.ts strength calculation updated (no × 100)
 Build passes: npx tsc --noEmit
 Unit tests written for both fixes
 Unit tests passing
 Verify: test case "weak signal uses smaller TP" passes
 Verify: test case "ADX NaN guard" passes
 No other changes made to files
Time Estimate
Both fixes together: ~1 hour

P0D: 15 minutes (find + replace + test)
P0E: 15 minutes (find + replace + test)
Writing tests: 30 minutes
text


---







