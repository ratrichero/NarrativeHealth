Prompt Giao Việc Cho Agents - Sprint P0

🤖 AGENT E — Technical Fixes (Làm Trước, Độc Lập)
text

# AGENT E: TECHNICAL BUG FIXES
# Priority: HIGHEST - Làm ngay, không cần đợi agent khác
# Estimated time: 1-2 hours
# Files to modify: 2 files only

═══════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════

Bạn là developer fix 2 critical bugs trong Technical Analysis
engine của hệ thống Crypto Narrative Health Dashboard.

Đây là các bug ẢNH HƯỞNG TRỰC TIẾP đến kết quả phân tích:
- Bug 1: ADX signal luôn trả về BEARISH khi data không đủ
- Bug 2: Risk levels luôn dùng multiplier MAX cho mọi signal

QUAN TRỌNG: Chỉ sửa đúng những gì được chỉ định.
Không refactor, không thêm feature, không đổi logic khác.

═══════════════════════════════════════════════════════════
BUG #1: ADX Guard Fix
File: src/lib/technical-analysis/scoring.ts
═══════════════════════════════════════════════════════════

VẤN ĐỀ:
Trong function calcTrendIndicators(), ADX block có guard:

  if (isFinite(adxV)) {
    const direction = pdiV > mdiV ? 1 : -1;

Khi pdiV hoặc mdiV là NaN:
  - isFinite(NaN) = false → guard đúng nghĩa là sẽ skip
  - NHƯNG: isFinite(adxV) có thể = true
  - Khi đó: NaN > NaN = false → direction LUÔN = -1 (bearish)
  - Kết quả: ADX signal bị sai hướng

CÁCH FIX:
Tìm đoạn code này (trong calcTrendIndicators):

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

Thay thành:

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

THAY ĐỔI DUY NHẤT: Thêm "&& isFinite(pdiV) && isFinite(mdiV)"
vào điều kiện if. KHÔNG đổi gì khác.

═══════════════════════════════════════════════════════════
BUG #2: Strength Scale Fix
File: src/lib/technical-analysis/risk.ts
═══════════════════════════════════════════════════════════

VẤN ĐỀ:
Trong function calculateRiskLevels():

  const strength = Math.min(Math.abs(compositeScore) * 100, 100);

compositeScore đã ở scale [-100, +100].
Nhân thêm × 100 → strength luôn = 100 → luôn dùng multiplier cao nhất.

Ví dụ sai:
  compositeScore = 20  → 20 × 100 = 2000 → clip = 100 (SAI, nên là 20)
  compositeScore = 50  → 50 × 100 = 5000 → clip = 100 (SAI, nên là 50)
  compositeScore = 75  → 75 × 100 = 7500 → clip = 100 (SAI, nên là 75)

Hậu quả: getTpMultipliers() luôn nhận 100 → luôn trả [2.0, 4.0, 6.0]
Mọi trade dùng TP multiplier cao nhất dù signal yếu.

CÁCH FIX:
Tìm đoạn code này:

  // strength is abs(compositeScore) already on 0-100 scale
  const strength = Math.min(Math.abs(compositeScore) * 100, 100);

Thay thành:

  // compositeScore đã là scale [-100, +100], dùng trực tiếp
  const strength = Math.min(Math.abs(compositeScore), 100);

THAY ĐỔI DUY NHẤT: Bỏ "* 100". KHÔNG đổi gì khác.

═══════════════════════════════════════════════════════════
UNIT TESTS - Bắt buộc viết
═══════════════════════════════════════════════════════════

Tạo hoặc cập nhật file:
src/lib/technical-analysis/__tests__/risk.test.ts

Thêm test cases:

describe('calculateRiskLevels - Strength Scale', () => {

  it('compositeScore=20 → strength=20 → uses weak multipliers', () => {
    // strength=20 < 40 → slMult=1.5, tp1Mult=1.5
    // rrRatio = 1.5/1.5 = 1.0
    const result = calculateRiskLevels(mockData, 'LONG', 20);
    expect(result?.rrRatio).toBeCloseTo(1.0, 1);
  });

  it('compositeScore=50 → strength=50 → uses medium multipliers', () => {
    // strength=50, 40<=50<65 → slMult=1.8, tp1Mult=1.8
    // rrRatio = 1.8/1.8 = 1.0
    const result = calculateRiskLevels(mockData, 'LONG', 50);
    expect(result?.rrRatio).toBeCloseTo(1.0, 1);
  });

  it('compositeScore=75 → strength=75 → uses strong multipliers', () => {
    // strength=75 >= 65 → slMult=2.0, tp1Mult=2.0
    // rrRatio = 2.0/2.0 = 1.0
    const result = calculateRiskLevels(mockData, 'LONG', 75);
    expect(result?.rrRatio).toBeCloseTo(1.0, 1);
  });

  it('weak signal has smaller SL distance than strong signal', () => {
    const weakResult   = calculateRiskLevels(mockData, 'LONG', 20);
    const strongResult = calculateRiskLevels(mockData, 'LONG', 75);
    // slMult: 1.5 vs 2.0 → weak has smaller SL distance
    expect(weakResult?.slPct).toBeLessThan(strongResult?.slPct ?? 0);
  });

  it('negative compositeScore uses absolute value', () => {
    const longResult  = calculateRiskLevels(mockData, 'LONG',  75);
    const shortResult = calculateRiskLevels(mockData, 'SHORT', -75);
    expect(longResult?.rrRatio).toBe(shortResult?.rrRatio);
  });

  it('OLD BUG regression: weak score should NOT equal strong score TP', () => {
    const weakResult   = calculateRiskLevels(mockData, 'LONG', 20);
    const strongResult = calculateRiskLevels(mockData, 'LONG', 75);
    // With old bug: both had strength=100, same TP
    // With fix: different TP multipliers
    expect(weakResult?.tp1).not.toBeCloseTo(strongResult?.tp1 ?? 0, 0);
  });
});

═══════════════════════════════════════════════════════════
VERIFICATION STEPS
═══════════════════════════════════════════════════════════

Sau khi sửa, chạy:

1. TypeScript check:
   npx tsc --noEmit
   → Expected: 0 errors

2. Unit tests:
   npm test -- --testPathPattern="risk|scoring"
   → Expected: All pass

3. Verify grep:
   grep -n "isFinite(adxV) && isFinite(pdiV)" src/lib/technical-analysis/scoring.ts
   → Expected: Line found

   grep -n "Math.abs(compositeScore) \* 100" src/lib/technical-analysis/risk.ts
   → Expected: NOT found (line removed)

4. Build:
   npm run build
   → Expected: Success

═══════════════════════════════════════════════════════════
DELIVERABLES
═══════════════════════════════════════════════════════════

□ scoring.ts: 1 line changed (guard condition)
□ risk.ts: 1 line changed (remove * 100)
□ risk.test.ts: 6 test cases added
□ All tests passing
□ Build success
□ Report: "E-DONE" với summary của 2 changes

KHÔNG cần làm:
✗ Không refactor code khác
✗ Không thêm comments thừa
✗ Không đổi function signatures
✗ Không thêm feature mới

=============================================================================

🤖 AGENT A — Database Migration


# AGENT A: DATABASE MIGRATION
# Priority: HIGH - Phải hoàn thành trước Agent B và C
# Estimated time: 2-3 hours
# Depends on: Nothing (start immediately)

═══════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════

Bạn là database engineer setup schema changes cho Sprint P0
của hệ thống Crypto Narrative Health Dashboard.

Tech stack: PostgreSQL 15, Drizzle ORM 0.45.2, TypeScript
Migration style: SQL files + Drizzle schema update

Sprint P0 cần:
1. Bảng mới: rule_versions (track config versions)
2. Alter: health_scores thêm rule_version_id
3. Alter: recommendations thêm rule_version_id
4. Alter: narrative_health thêm 3 columns mới

QUAN TRỌNG:
- Mọi migration phải IDEMPOTENT (chạy nhiều lần không lỗi)
- Phải có rollback script
- Không được mất data cũ
- Backfill tất cả records cũ với default values

═══════════════════════════════════════════════════════════
TASK 1: Tạo Migration Files
═══════════════════════════════════════════════════════════

Tạo 4 files trong drizzle/migrations/ theo đúng thứ tự:

─────────────────────────────────────────────────────────
FILE 1: drizzle/migrations/0001_add_rule_versions.sql
─────────────────────────────────────────────────────────

Nội dung chính xác:

-- ============================================
-- P0B: Add rule_versions table
-- Sprint P0 | 2026-08-03
-- IDEMPOTENT: Safe to run multiple times
-- ============================================

CREATE TABLE IF NOT EXISTS rule_versions (
  id                          SERIAL PRIMARY KEY,
  version                     INTEGER NOT NULL,
  description                 TEXT,
  health_weights              JSONB NOT NULL
    DEFAULT '{"trend":0.35,"derivative":0.35,"volume":0.20,"momentum":0.10}',
  confidence_weights          JSONB NOT NULL
    DEFAULT '{"binance_spot":0.40,"binance_futures":0.40,"coingecko":0.20}',
  recommendation_thresholds   JSONB NOT NULL
    DEFAULT '{"strong_watch":90,"watch":80,"observe":65}',
  is_active                   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
  activated_at                TIMESTAMP,
  CONSTRAINT rule_versions_version_unique UNIQUE (version)
);

CREATE INDEX IF NOT EXISTS idx_rule_versions_active
  ON rule_versions(is_active)
  WHERE is_active = TRUE;

-- Seed version 1 (default config)
-- ON CONFLICT ensures idempotency
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
  '{"trend":0.35,"derivative":0.35,"volume":0.20,"momentum":0.10}',
  '{"binance_spot":0.40,"binance_futures":0.40,"coingecko":0.20}',
  '{"strong_watch":90,"watch":80,"observe":65}',
  TRUE,
  NOW()
) ON CONFLICT (version) DO NOTHING;

─────────────────────────────────────────────────────────
FILE 2: drizzle/migrations/0002_alter_health_scores.sql
─────────────────────────────────────────────────────────

-- ============================================
-- P0B: Add rule_version_id to health_scores
-- Requires: 0001_add_rule_versions.sql
-- IDEMPOTENT: IF NOT EXISTS guards
-- ============================================

ALTER TABLE health_scores
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL;

-- Backfill existing records with version 1
UPDATE health_scores
  SET rule_version_id = (
    SELECT id FROM rule_versions
    WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_health_scores_rule_version
  ON health_scores(rule_version_id);

─────────────────────────────────────────────────────────
FILE 3: drizzle/migrations/0003_alter_recommendations.sql
─────────────────────────────────────────────────────────

-- ============================================
-- P0B: Add rule_version_id to recommendations
-- Requires: 0001_add_rule_versions.sql
-- IDEMPOTENT: IF NOT EXISTS guards
-- ============================================

ALTER TABLE recommendations
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL;

UPDATE recommendations
  SET rule_version_id = (
    SELECT id FROM rule_versions
    WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_recommendations_rule_version
  ON recommendations(rule_version_id);

─────────────────────────────────────────────────────────
FILE 4: drizzle/migrations/0004_alter_narrative_health.sql
─────────────────────────────────────────────────────────

-- ============================================
-- P0A + P0B: Enhance narrative_health table
-- Requires: 0001_add_rule_versions.sql
-- Adds: rule_version_id, weighting_method, weight_details
-- ============================================

ALTER TABLE narrative_health
  ADD COLUMN IF NOT EXISTS rule_version_id INTEGER
    REFERENCES rule_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS weighting_method VARCHAR(20)
    NOT NULL DEFAULT 'equal',
  ADD COLUMN IF NOT EXISTS weight_details JSONB;

-- Backfill rule_version_id
UPDATE narrative_health
  SET rule_version_id = (
    SELECT id FROM rule_versions
    WHERE version = 1 LIMIT 1
  )
  WHERE rule_version_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_narrative_health_rule_version
  ON narrative_health(rule_version_id);

CREATE INDEX IF NOT EXISTS idx_narrative_health_weighting
  ON narrative_health(weighting_method);

═══════════════════════════════════════════════════════════
TASK 2: Tạo Rollback Script
═══════════════════════════════════════════════════════════

Tạo file: drizzle/rollback/P0_rollback.sql

Nội dung:

-- ============================================
-- P0 ROLLBACK SCRIPT
-- Run ONLY if migration fails
-- Execute in order shown below
-- ============================================

-- Step 4 first (reverse order, remove dependent columns)
ALTER TABLE narrative_health
  DROP COLUMN IF EXISTS weight_details,
  DROP COLUMN IF EXISTS weighting_method,
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_narrative_health_weighting;
DROP INDEX IF EXISTS idx_narrative_health_rule_version;

-- Step 3
ALTER TABLE recommendations
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_recommendations_rule_version;

-- Step 2
ALTER TABLE health_scores
  DROP COLUMN IF EXISTS rule_version_id;

DROP INDEX IF EXISTS idx_health_scores_rule_version;

-- Step 1 (last - other columns referenced it)
DROP INDEX IF EXISTS idx_rule_versions_active;
DROP TABLE IF EXISTS rule_versions;

═══════════════════════════════════════════════════════════
TASK 3: Update Drizzle Schema
═══════════════════════════════════════════════════════════

File: src/lib/db/schema.ts

Tìm phần cuối của file và THÊM (không xóa existing code):

// ─── Rule Versions (P0B) ─────────────────────────────────

export const ruleVersions = pgTable('rule_versions', {
  id: serial('id').primaryKey(),
  version: integer('version').notNull().unique(),
  description: text('description'),
  healthWeights: jsonb('health_weights')
    .$type<{
      trend: number;
      derivative: number;
      volume: number;
      momentum: number;
    }>()
    .notNull(),
  confidenceWeights: jsonb('confidence_weights')
    .$type<{
      binance_spot: number;
      binance_futures: number;
      coingecko: number;
    }>()
    .notNull(),
  recommendationThresholds: jsonb('recommendation_thresholds')
    .$type<{
      strong_watch: number;
      watch: number;
      observe: number;
    }>()
    .notNull(),
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  activatedAt: timestamp('activated_at'),
});

export type RuleVersion    = typeof ruleVersions.$inferSelect;
export type NewRuleVersion = typeof ruleVersions.$inferInsert;

Tìm existing healthScores table definition.
THÊM column vào cuối (trước closing parenthesis):

  ruleVersionId: integer('rule_version_id')
    .references(() => ruleVersions.id),

Tìm existing recommendations table definition.
THÊM column:

  ruleVersionId: integer('rule_version_id')
    .references(() => ruleVersions.id),

Tìm existing narrativeHealth table definition.
THÊM 3 columns:

  ruleVersionId: integer('rule_version_id')
    .references(() => ruleVersions.id),
  weightingMethod: varchar('weighting_method', { length: 20 })
    .notNull()
    .default('equal'),
  weightDetails: jsonb('weight_details')
    .$type<Record<string, {
      coinId: number;
      symbol: string;
      weight: number;
      marketCap: number | null;
      healthScore: number;
    }>>(),

═══════════════════════════════════════════════════════════
TASK 4: Chạy và Verify Migration
═══════════════════════════════════════════════════════════

Chạy các lệnh sau và báo cáo kết quả:

1. Push migration:
   npx drizzle-kit push
   → Expected: No errors

2. Verify DB state (chạy trong psql hoặc DB client):

   -- Check table exists
   SELECT EXISTS (
     SELECT FROM pg_tables
     WHERE tablename = 'rule_versions'
   );
   -- Expected: true

   -- Check seed data
   SELECT id, version, is_active, activated_at
   FROM rule_versions;
   -- Expected: 1 row, version=1, is_active=true

   -- Check backfill health_scores
   SELECT
     COUNT(*) as total,
     COUNT(rule_version_id) as with_version
   FROM health_scores;
   -- Expected: total = with_version

   -- Check backfill recommendations
   SELECT
     COUNT(*) as total,
     COUNT(rule_version_id) as with_version
   FROM recommendations;
   -- Expected: total = with_version

   -- Check narrative_health new columns
   SELECT
     COUNT(*) as total,
     COUNT(rule_version_id) as with_version,
     COUNT(CASE WHEN weighting_method = 'equal' THEN 1 END) as equal_weight
   FROM narrative_health;
   -- Expected: total = with_version, equal_weight = total

3. Test rollback (staging only):
   psql -f drizzle/rollback/P0_rollback.sql
   → Expected: No errors
   psql -f drizzle/migrations/0001_...sql  (re-run)
   psql -f drizzle/migrations/0002_...sql
   psql -f drizzle/migrations/0003_...sql
   psql -f drizzle/migrations/0004_...sql
   → Expected: Idempotent, no errors

4. TypeScript check:
   npx tsc --noEmit
   → Expected: 0 errors

═══════════════════════════════════════════════════════════
DELIVERABLES
═══════════════════════════════════════════════════════════

□ drizzle/migrations/0001_add_rule_versions.sql
□ drizzle/migrations/0002_alter_health_scores.sql
□ drizzle/migrations/0003_alter_recommendations.sql
□ drizzle/migrations/0004_alter_narrative_health.sql
□ drizzle/rollback/P0_rollback.sql
□ src/lib/db/schema.ts updated
□ Migration runs successfully
□ All verify queries return expected results
□ TypeScript check passes
□ Report: "A-DONE" với output của verify queries

NOTIFY khi xong: Agent B và Agent C có thể bắt đầu
🤖 AGENT B — Service Layer
text

# AGENT B: SERVICE LAYER
# Priority: HIGH
# Estimated time: 4-5 hours
# Depends on: Agent A complete (wait for "A-DONE" signal)

═══════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════

Bạn là backend engineer implement business logic services
cho Sprint P0 của Crypto Narrative Health Dashboard.

WAIT: Chỉ bắt đầu sau khi nhận được signal "A-DONE" từ Agent A.
DB schema phải exist trước khi viết services.

Bạn cần implement:
1. Type definitions (foundation cho tất cả)
2. RuleVersionService (P0B)
3. calculateWeightedNarrativeHealth (P0A)
4. HealthTimelineService (P0C)
5. Update refresh pipeline

═══════════════════════════════════════════════════════════
TASK 1: Type Definitions
═══════════════════════════════════════════════════════════

─────────────────────────────────────────────────────────
File MỚI: src/lib/types/rule-version.ts
─────────────────────────────────────────────────────────

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
  trend:      number;  // Must sum to 1.0 with others
  derivative: number;
  volume:     number;
  momentum:   number;
}

export interface ConfidenceWeights {
  binance_spot:    number;  // Must sum to 1.0
  binance_futures: number;
  coingecko:       number;
}

export interface RecommendationThresholds {
  strong_watch: number;  // e.g. 90
  watch:        number;  // e.g. 80
  observe:      number;  // e.g. 65
  // Rule: strong_watch > watch > observe
}

export interface CreateRuleVersionInput {
  description?:             string;
  healthWeights:            HealthWeights;
  confidenceWeights:        ConfidenceWeights;
  recommendationThresholds: RecommendationThresholds;
}

─────────────────────────────────────────────────────────
File MỚI: src/lib/types/health-timeline.ts
─────────────────────────────────────────────────────────

export type HealthStatus =
  | 'STRONG'    // 90-100
  | 'HEALTHY'   // 80-89
  | 'NEUTRAL'   // 65-79
  | 'CAUTION'   // 50-64
  | 'WEAK';     // 0-49

export interface HealthTimelinePoint {
  date:        string;       // YYYY-MM-DD
  healthScore: number;       // 0-100
  status:      HealthStatus;
  change:      number | null; // vs previous day
}

export interface HealthTrend {
  direction: 'improving' | 'declining' | 'stable';
  slope:     number;   // points per day (linear regression)
  change7d:  number;   // health change over 7 days
  change30d: number;   // health change over 30 days
}

export interface HealthTimeline {
  coinId:  number;
  symbol:  string;
  points:  HealthTimelinePoint[];
  trend:   HealthTrend;
}

─────────────────────────────────────────────────────────
File CẬP NHẬT: src/lib/types/narrative-health.ts
─────────────────────────────────────────────────────────

Thêm vào file existing (KHÔNG xóa types cũ):

export interface CoinWeightDetail {
  coinId:      number;
  symbol:      string;
  weight:      number;       // 0.0 - 1.0 (e.g. 0.65)
  marketCap:   number | null;
  healthScore: number;
}

export interface NarrativeHealthEnhanced {
  narrativeId:      number;
  date:             string;
  healthScore:      number;
  status:           HealthStatus;
  scoreChange:      number | null;
  avgConfidence:    number;
  topCoinId:        number | null;
  weakestCoinId:    number | null;
  ruleVersionId:    number;
  weightingMethod:  'market_cap' | 'equal';
  weightDetails:    Record<string, CoinWeightDetail>;
}

═══════════════════════════════════════════════════════════
TASK 2: RuleVersionService
═══════════════════════════════════════════════════════════

File MỚI: src/lib/services/rule-version.service.ts

Implement đầy đủ class với các methods:

CLASS: RuleVersionService

METHOD: getActiveVersion(): Promise<RuleVersion>
  - Query: SELECT * FROM rule_versions WHERE is_active = true LIMIT 1
  - Nếu không có kết quả: throw Error('No active rule version found.')
  - Return: mapped RuleVersion object

METHOD: getAllVersions(): Promise<RuleVersion[]>
  - Query: SELECT * FROM rule_versions ORDER BY version DESC
  - Return: array of RuleVersion

METHOD: getVersionById(id: number): Promise<RuleVersion | null>
  - Query: SELECT * FROM rule_versions WHERE id = ? LIMIT 1
  - Return: RuleVersion or null

METHOD: createVersion(input, activateImmediately?): Promise<RuleVersion>
  - Validate: healthWeights sum = 1.0 (±0.001 tolerance)
  - Validate: confidenceWeights sum = 1.0
  - Validate: strong_watch > watch > observe
  - Validate: all thresholds between 0 and 100
  - Get next version number: MAX(version) + 1
  - Insert new record (isActive = false by default)
  - If activateImmediately = true: call activate(newId)
  - Return: created RuleVersion

METHOD: activate(versionId: number): Promise<void>
  - Verify version exists (throw if not found)
  - Use DB TRANSACTION:
    1. UPDATE rule_versions SET is_active = false (all rows)
    2. UPDATE rule_versions SET is_active = true, activated_at = NOW()
       WHERE id = versionId
  - Transaction ensures atomicity (never 0 or 2 active versions)

PRIVATE METHOD: mapRow(dbRow): RuleVersion
  - Map DB snake_case to TypeScript camelCase
  - Parse JSONB fields with proper typing

PRIVATE METHOD: validateWeights(weights, fieldName): void
  - Check all values between 0 and 1
  - Check sum ≈ 1.0 (allow ±0.001 floating point tolerance)
  - Throw descriptive error if invalid

PRIVATE METHOD: validateThresholds(thresholds): void
  - Check: strong_watch > watch
  - Check: watch > observe
  - Check: observe >= 0
  - Check: strong_watch <= 100
  - Throw descriptive error if invalid

Export singleton:
  export const ruleVersionService = new RuleVersionService();

═══════════════════════════════════════════════════════════
TASK 3: Weighted Narrative Health
═══════════════════════════════════════════════════════════

File MỚI (hoặc UPDATE): src/lib/scoring/narrative-health.ts

Implement function:

export interface CoinHealthData {
  coinId:         number;
  symbol:         string;
  healthScore:    number;
  confidenceScore: number;
  marketCap:      number | null;
}

export function calculateWeightedNarrativeHealth(
  narrativeId:   number,
  date:          string,
  coinScores:    CoinHealthData[],
  ruleVersionId: number,
  previousScore?: number
): NarrativeHealthEnhanced

ALGORITHM (implement chính xác):

Step 1 - Kiểm tra missing market cap:
  const missingMcap = coinScores.filter(c => !c.marketCap || c.marketCap <= 0)
  
  IF missingMcap.length > 0 OR total_mcap = 0:
    weightingMethod = 'equal'
    equalWeight = 1 / coinScores.length
    weights = Map<coinId, equalWeight>
  ELSE:
    weightingMethod = 'market_cap'
    totalMcap = sum of all marketCap values
    weights = Map<coinId, coinMcap / totalMcap>

Step 2 - Tính weighted health score:
  weightedHealth = sum(coin.healthScore * weight[coin.coinId])

Step 3 - Build weightDetails JSON:
  For each coin:
    weightDetails[coin.symbol] = {
      coinId: coin.coinId,
      symbol: coin.symbol,
      weight: round(weight * 10000) / 10000,  // 4 decimal places
      marketCap: coin.marketCap,
      healthScore: coin.healthScore
    }

Step 4 - Find top/weakest:
  Sort coinScores by healthScore DESC
  topCoin = first
  weakestCoin = last

Step 5 - Average confidence:
  avgConfidence = sum(coin.confidenceScore) / count

Step 6 - Score change:
  IF previousScore provided:
    scoreChange = round((finalScore - previousScore) * 100) / 100
  ELSE:
    scoreChange = null

Step 7 - Return NarrativeHealthEnhanced object

HELPER function:
  export function scoreToStatus(score: number): HealthStatus
    >= 90 → 'STRONG'
    >= 80 → 'HEALTHY'
    >= 65 → 'NEUTRAL'
    >= 50 → 'CAUTION'
    else  → 'WEAK'

CRITICAL TEST CASE (verify your implementation):
  Input:
    coins = [
      { symbol: 'CARV',  healthScore: 95, marketCap: 500_000_000 },
      { symbol: 'BLUAI', healthScore: 93, marketCap: 200_000_000 },
      { symbol: 'TRUTH', healthScore: 15, marketCap:   5_000_000 },
    ]
  
  Expected:
    totalMcap = 705_000_000
    weights = CARV: 0.7092, BLUAI: 0.2837, TRUTH: 0.0071
    weightedHealth = 95×0.7092 + 93×0.2837 + 15×0.0071
                   = 67.37 + 26.38 + 0.11
                   = 93.86
    status = 'STRONG'  ← NOT 'NEUTRAL' (which simple avg=67.67 gives)

═══════════════════════════════════════════════════════════
TASK 4: HealthTimelineService
═══════════════════════════════════════════════════════════

File MỚI: src/lib/services/health-timeline.service.ts

CLASS: HealthTimelineService

METHOD: getCoinTimeline(coinId, days=30): Promise<HealthTimeline>
  
  1. Calculate sinceDate = today - days days (YYYY-MM-DD format)
  
  2. Query health_scores:
     SELECT date, health_score, status, score_change
     FROM health_scores
     WHERE coin_id = coinId AND date >= sinceDate
     ORDER BY date ASC

  3. Query coin symbol:
     SELECT symbol FROM coins WHERE id = coinId LIMIT 1

  4. Map to HealthTimelinePoint[]

  5. Calculate trend via calculateTrend(points)

  6. Return HealthTimeline

PRIVATE METHOD: calculateTrend(points): HealthTrend
  
  IF points.length < 2:
    return { direction: 'stable', slope: 0, change7d: 0, change30d: 0 }
  
  latest = points[points.length - 1].healthScore
  oldest = points[0].healthScore
  
  // 7-day change
  idx7d = Math.max(0, points.length - 7)
  change7d = latest - points[idx7d].healthScore
  
  // 30-day change
  change30d = latest - oldest
  
  // Linear slope on last 7 points (or all if < 7)
  recentPoints = points.slice(-7)
  slope = linearSlope(recentPoints.map((p, i) => [i, p.healthScore]))
  
  direction:
    slope > 0.5  → 'improving'
    slope < -0.5 → 'declining'
    else         → 'stable'
  
  Return:
    { direction, slope: round(slope, 2), change7d: round(7d, 2), change30d: round(30d, 2) }

PRIVATE METHOD: linearSlope(points: [number, number][]): number
  
  n = points.length
  IF n < 2: return 0
  
  // Least squares linear regression
  sumX  = Σ x_i
  sumY  = Σ y_i
  sumXY = Σ (x_i * y_i)
  sumX2 = Σ (x_i ^ 2)
  
  denom = n * sumX2 - sumX * sumX
  IF denom = 0: return 0
  
  return (n * sumXY - sumX * sumY) / denom

Export singleton:
  export const healthTimelineService = new HealthTimelineService();

═══════════════════════════════════════════════════════════
TASK 5: Update Refresh Pipeline
═══════════════════════════════════════════════════════════

Tìm file refresh pipeline (likely src/lib/refresh/ hoặc
src/app/api/refresh/route.ts hoặc similar).

TÌM chỗ global refresh function và THÊM:

  import { ruleVersionService } from '@/lib/services/rule-version.service';

  // Ở đầu refresh function, trước khi process coins:
  const activeVersion = await ruleVersionService.getActiveVersion();

  // Khi save health_scores, THÊM field:
  ruleVersionId: activeVersion.id,

  // Khi save recommendations, THÊM field:
  ruleVersionId: activeVersion.id,

  // Khi save narrative_health, THÊM fields:
  ruleVersionId: activeVersion.id,
  weightingMethod: narrativeHealthResult.weightingMethod,
  weightDetails: narrativeHealthResult.weightDetails,

  // Thay thế narrative health calculation:
  // CŨ: simple average
  // MỚI: dùng calculateWeightedNarrativeHealth()

═══════════════════════════════════════════════════════════
UNIT TESTS - Bắt buộc
═══════════════════════════════════════════════════════════

Tạo test files:

src/lib/services/__tests__/rule-version.service.test.ts
  - getActiveVersion throws khi không có active version
  - createVersion tăng version number đúng
  - activate dùng transaction, deactivate others
  - validateWeights reject sum != 1.0
  - validateWeights accept sum = 1.0 ± 0.001
  - validateThresholds reject strong_watch <= watch

src/lib/scoring/__tests__/narrative-health.test.ts
  - CARV/BLUAI/TRUTH test case: result ≈ 93.86 (STRONG)
  - Falls back to equal weight khi ANY coin missing mcap
  - Weight sum in weightDetails ≈ 1.0
  - topCoin = highest healthScore coin
  - weakestCoin = lowest healthScore coin
  - scoreChange calculated correctly

src/lib/services/__tests__/health-timeline.service.test.ts
  - Points returned in ASC date order
  - improving trend: slope > 0.5
  - declining trend: slope < -0.5
  - Handles < 7 data points
  - change7d uses correct reference point
  - Returns empty points gracefully (no throw)

═══════════════════════════════════════════════════════════
DELIVERABLES
═══════════════════════════════════════════════════════════

□ src/lib/types/rule-version.ts (NEW)
□ src/lib/types/health-timeline.ts (NEW)
□ src/lib/types/narrative-health.ts (UPDATED)
□ src/lib/services/rule-version.service.ts (NEW)
□ src/lib/scoring/narrative-health.ts (NEW/UPDATED)
□ src/lib/services/health-timeline.service.ts (NEW)
□ Refresh pipeline updated (add rule_version_id)
□ All unit tests written and passing
□ TypeScript: npx tsc --noEmit → 0 errors
□ npm test → all pass

□ Report "B-DONE" với:
  - Verify CARV/BLUAI/TRUTH test case output
  - List of all files modified
  - Any deviations from spec with reason

NOTIFY khi xong: Agent C và D có thể bắt đầu
🤖 AGENT C — API Routes
text

# AGENT C: API ROUTES
# Priority: HIGH
# Estimated time: 2-3 hours
# Depends on: Agent A + Agent B complete
#             Wait for "A-DONE" AND "B-DONE" signals

═══════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════

Bạn là API engineer tạo các endpoints mới cho Sprint P0
của Crypto Narrative Health Dashboard.

Tech stack: Next.js 16 API Routes, TypeScript

WAIT: Chỉ bắt đầu khi có cả "A-DONE" và "B-DONE".
Services phải exist trước khi build routes.

API RESPONSE FORMAT (bắt buộc nhất quán):
  Success: { success: true, data: ... }
  Error:   { success: false, error: "message" }

HTTP STATUS CODES:
  200 → GET success
  201 → POST success (create)
  400 → Invalid input (bad ID format, missing fields)
  404 → Resource not found
  422 → Validation error (weights sum, thresholds)
  500 → Unexpected server error

═══════════════════════════════════════════════════════════
TASK 1: Coin Health Timeline Endpoint
═══════════════════════════════════════════════════════════

File MỚI:
src/app/api/coins/[id]/health-timeline/route.ts

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { healthTimelineService } from '@/lib/services/health-timeline.service';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Validate coin ID
    const coinId = parseInt(params.id);
    if (isNaN(coinId) || coinId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid coin ID' },
        { status: 400 }
      );
    }

    // Parse and cap days parameter
    const daysParam = request.nextUrl.searchParams.get('days');
    const days = daysParam
      ? Math.min(Math.max(parseInt(daysParam) || 30, 1), 90)
      : 30;

    const timeline = await healthTimelineService.getCoinTimeline(coinId, days);

    return NextResponse.json({ success: true, data: timeline });

  } catch (error) {
    console.error('[GET /api/coins/[id]/health-timeline]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch health timeline' },
      { status: 500 }
    );
  }
}
═══════════════════════════════════════════════════════════
TASK 2: Narrative Health Timeline Endpoint
═══════════════════════════════════════════════════════════

File MỚI:
src/app/api/narratives/[id]/health-timeline/route.ts

TypeScript

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { narrativeHealth } from '@/lib/db/schema';
import { eq, and, gte, asc } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const narrativeId = parseInt(params.id);
    if (isNaN(narrativeId) || narrativeId <= 0) {
      return NextResponse.json(
        { success: false, error: 'Invalid narrative ID' },
        { status: 400 }
      );
    }

    const daysParam = request.nextUrl.searchParams.get('days');
    const days = daysParam
      ? Math.min(Math.max(parseInt(daysParam) || 30, 1), 90)
      : 30;

    // Calculate since date
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
    console.error('[GET /api/narratives/[id]/health-timeline]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch narrative timeline' },
      { status: 500 }
    );
  }
}
═══════════════════════════════════════════════════════════
TASK 3: Rule Versions CRUD Endpoints
═══════════════════════════════════════════════════════════

─────────────────────────────────────────────────────────
File MỚI: src/app/api/admin/rule-versions/route.ts
─────────────────────────────────────────────────────────

Implement 2 handlers:

GET handler:

Call ruleVersionService.getAllVersions()
Return { success: true, data: versions[] }
On error: 500
POST handler:

Parse body: { description?, healthWeights, confidenceWeights,
recommendationThresholds, activateImmediately? }
Validate required fields present (400 if missing)
Call ruleVersionService.createVersion(input, activateImmediately)
Return { success: true, data: version } with status 201
On validation error (weight sum): status 422
On other error: 500
─────────────────────────────────────────────────────────
File MỚI: src/app/api/admin/rule-versions/[id]/route.ts
─────────────────────────────────────────────────────────

GET handler:

Parse and validate ID
Call ruleVersionService.getVersionById(id)
If null: 404
Return { success: true, data: version }
─────────────────────────────────────────────────────────
File MỚI: src/app/api/admin/rule-versions/[id]/activate/route.ts
─────────────────────────────────────────────────────────

POST handler:

Parse and validate ID (400 if invalid)
Call ruleVersionService.activate(id)
If version not found: 404
Fetch updated version
Return:
{
success: true,
data: {
activated: true,
version: number,
activatedAt: string (ISO)
}
}
On error: 500
═══════════════════════════════════════════════════════════
TASK 4: Manual Testing
═══════════════════════════════════════════════════════════

Sau khi implement, test từng endpoint:

Bash

# Start dev server
npm run dev

# Test 1: Coin timeline
curl -s "http://localhost:3000/api/coins/1/health-timeline?days=30" | \
  python3 -m json.tool
# Verify: success=true, data.points is array, data.trend exists

# Test 2: Coin timeline - invalid ID
curl -s "http://localhost:3000/api/coins/abc/health-timeline" | \
  python3 -m json.tool
# Verify: success=false, HTTP 400

# Test 3: Narrative timeline
curl -s "http://localhost:3000/api/narratives/1/health-timeline" | \
  python3 -m json.tool
# Verify: success=true, data.points array

# Test 4: List rule versions
curl -s "http://localhost:3000/api/admin/rule-versions" | \
  python3 -m json.tool
# Verify: success=true, data is array with 1 item (version 1)

# Test 5: Create version - valid weights
curl -X POST "http://localhost:3000/api/admin/rule-versions" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Test version from Agent C",
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
  }' | python3 -m json.tool
# Verify: success=true, data.version=2, data.isActive=false, HTTP 201

# Test 6: Create version - invalid weights (sum != 1)
curl -X POST "http://localhost:3000/api/admin/rule-versions" \
  -H "Content-Type: application/json" \
  -d '{
    "healthWeights": {"trend":0.5,"derivative":0.5,"volume":0.2,"momentum":0.1},
    "confidenceWeights": {"binance_spot":0.40,"binance_futures":0.40,"coingecko":0.20},
    "recommendationThresholds": {"strong_watch":90,"watch":80,"observe":65}
  }' | python3 -m json.tool
# Verify: success=false, HTTP 422, error mentions "sum"

# Test 7: Activate version 2
curl -X POST "http://localhost:3000/api/admin/rule-versions/2/activate" | \
  python3 -m json.tool
# Verify: success=true, data.activated=true, data.version=2

# Test 8: Activate non-existent version
curl -X POST "http://localhost:3000/api/admin/rule-versions/999/activate" | \
  python3 -m json.tool
# Verify: success=false, HTTP 404

# CLEANUP: Restore version 1
curl -X POST "http://localhost:3000/api/admin/rule-versions/1/activate"
═══════════════════════════════════════════════════════════
DELIVERABLES
═══════════════════════════════════════════════════════════

□ src/app/api/coins/[id]/health-timeline/route.ts
□ src/app/api/narratives/[id]/health-timeline/route.ts
□ src/app/api/admin/rule-versions/route.ts
□ src/app/api/admin/rule-versions/[id]/route.ts
□ src/app/api/admin/rule-versions/[id]/activate/route.ts
□ All 8 manual tests pass (với expected results)
□ TypeScript: npx tsc --noEmit → 0 errors
□ npm run build → success

□ Report "C-DONE" với:

Output của tất cả 8 test cases
Any issues found
NOTIFY khi xong: Agent D có thể tiếp tục

text


---

## 🤖 AGENT D — Frontend UI
AGENT D: FRONTEND UI COMPONENTS
Priority: MEDIUM
Estimated time: 4-5 hours
Depends on: Agent C complete (wait for "C-DONE")
═══════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════

Bạn là frontend engineer implement UI components cho Sprint P0
của Crypto Narrative Health Dashboard.

Tech stack:

Next.js 16 (React 19)
TypeScript
Tailwind CSS 4
Recharts 3.x
TanStack Query 5.x (useQuery)
WAIT: Chỉ bắt đầu sau "C-DONE" (API routes phải ready).

DESIGN PRINCIPLES:

Dark theme (consistent với existing UI, gray-800/gray-900)
Compact: components không chiếm quá nhiều space
Responsive: works trên mobile và desktop
Loading state luôn có
Error state luôn có
isAnimationActive={false} cho charts (performance)
═══════════════════════════════════════════════════════════
TASK 1: TrendArrow Component (Simple, start here)
═══════════════════════════════════════════════════════════

File MỚI: src/components/ui/trend-arrow.tsx

TypeScript

'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendArrowProps {
  direction: 'improving' | 'declining' | 'stable';
  change7d:  number;
  size?:     'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const ICON_SIZE = { sm: 'h-3 w-3', md: 'h-4 w-4', lg: 'h-5 w-5' };
const TEXT_SIZE = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' };

export function TrendArrow({
  direction,
  change7d,
  size = 'md',
  showLabel = true,
}: TrendArrowProps) {
  const isPos = change7d >= 0;
  const label = `${isPos ? '+' : ''}${change7d.toFixed(1)}`;

  if (direction === 'improving') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-green-500')}>
        <TrendingUp className={ICON_SIZE[size]} />
        {showLabel && <span className={cn('font-medium tabular-nums', TEXT_SIZE[size])}>{label}</span>}
      </span>
    );
  }

  if (direction === 'declining') {
    return (
      <span className={cn('inline-flex items-center gap-1 text-red-500')}>
        <TrendingDown className={ICON_SIZE[size]} />
        {showLabel && <span className={cn('font-medium tabular-nums', TEXT_SIZE[size])}>{label}</span>}
      </span>
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1 text-gray-400')}>
      <Minus className={ICON_SIZE[size]} />
      {showLabel && <span className={cn('font-medium tabular-nums', TEXT_SIZE[size])}>{label}</span>}
    </span>
  );
}
═══════════════════════════════════════════════════════════
TASK 2: HealthSparkline Component
═══════════════════════════════════════════════════════════

File MỚI: src/components/ui/health-sparkline.tsx

TypeScript

'use client';

import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts';
import { TrendArrow } from './trend-arrow';
import type { HealthTimelinePoint, HealthTrend } from '@/lib/types/health-timeline';

interface HealthSparklineProps {
  points:  HealthTimelinePoint[];
  trend:   HealthTrend;
  width?:  number;
  height?: number;
}

function trendColor(direction: HealthTrend['direction']): string {
  if (direction === 'improving') return '#22c55e';
  if (direction === 'declining') return '#ef4444';
  return '#94a3b8';
}

const SparkTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as HealthTimelinePoint;
  return (
    <div className="rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg border border-gray-700">
      <div className="text-gray-400">{p.date}</div>
      <div className="font-bold">{p.healthScore.toFixed(1)}</div>
      <div style={{ color: '#94a3b8' }}>{p.status}</div>
    </div>
  );
};

export function HealthSparkline({
  points,
  trend,
  width  = 80,
  height = 32,
}: HealthSparklineProps) {
  const data = points.slice(-7);

  if (data.length === 0) {
    return <span className="text-xs text-gray-500">No data</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <div style={{ width, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <Line
              type="monotone"
              dataKey="healthScore"
              stroke={trendColor(trend.direction)}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip content={<SparkTooltip />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <TrendArrow direction={trend.direction} change7d={trend.change7d} size="sm" />
    </div>
  );
}
═══════════════════════════════════════════════════════════
TASK 3: HealthTimeline Full Chart
═══════════════════════════════════════════════════════════

File MỚI: src/components/health-timeline.tsx

Implement component với:

TypeScript

'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer
} from 'recharts';
import { TrendArrow } from '@/components/ui/trend-arrow';
import type { HealthTimeline } from '@/lib/types/health-timeline';

interface HealthTimelineProps {
  coinId: number;
  days?:  number;  // default: 30
}
FETCH FUNCTION:

TypeScript

async function fetchTimeline(coinId: number, days: number): Promise<HealthTimeline> {
  const res = await fetch(`/api/coins/${coinId}/health-timeline?days=${days}`);
  if (!res.ok) throw new Error('Failed to fetch');
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}
QUERY CONFIG:

TypeScript

const { data, isLoading, error } = useQuery({
  queryKey: ['health-timeline', coinId, days],
  queryFn:  () => fetchTimeline(coinId, days ?? 30),
  staleTime: 5 * 60 * 1000,  // 5 min cache
});
LOADING STATE: Render div với text "Loading timeline..." (height 48)
ERROR STATE: Render div với text "Failed to load timeline" (text-red-400)

CHART REQUIREMENTS:

AreaChart từ Recharts
Y axis domain: [0, 100]
X axis: show date MM-DD format (slice(5) from YYYY-MM-DD)
4 ReferenceLine ngang tại: y=90, y=80, y=65, y=50
Gradient fill: green → transparent
isAnimationActive={false}
Custom tooltip showing: date, score, status, change
REFERENCE LINES (visual zones):
y=90: stroke="#22c55e" label="STRONG"
y=80: stroke="#84cc16"
y=65: stroke="#f59e0b"
y=50: stroke="#ef4444"
All: strokeDasharray="2 4" strokeOpacity=0.4

LAYOUT STRUCTURE:

<div className="space-y-3"> {/* Header row */} <div className="flex justify-between"> <h3>Health Timeline ({days}d)</h3> <div> TrendArrow + 30d change </div> </div>
text

{/* Chart */}
<div className="h-48"> ... </div>

{/* Legend */}
<div className="flex gap-4 text-xs text-gray-500">
  90 STRONG | 80 HEALTHY | 65 NEUTRAL | 50 CAUTION
</div>
</div>
═══════════════════════════════════════════════════════════
TASK 4: Update Narrative Card
═══════════════════════════════════════════════════════════

Tìm file Narrative Card component (check existing codebase).

THÊM 2 things:

Sparkline (nếu có topCoinId):
Fetch timeline cho top coin trong narrative
Render HealthSparkline (width=80, height=28)
Cache key: ['health-timeline', topCoinId, 7]
Weighting Method Badge:
Sau health score, thêm small badge:
TypeScript

{narrative.weightingMethod === 'market_cap' ? (
  <span className="text-xs text-blue-400 flex items-center gap-1">
    <span>⚖️</span> Market Cap Weighted
  </span>
) : (
  <span className="text-xs text-gray-500">= Equal Weighted</span>
)}
NOTE: Nếu API chưa trả weightingMethod,
thêm field vào narrative API response
hoặc display chỉ khi field exists.

═══════════════════════════════════════════════════════════
TASK 5: Update Coin Detail Page
═══════════════════════════════════════════════════════════

Tìm file Coin Detail page: src/app/coin/[id]/page.tsx
(hoặc equivalent trong codebase)

THÊM HealthTimeline section:

TypeScript

import { HealthTimeline } from '@/components/health-timeline';

// Sau Score Breakdown section, thêm:
<section className="rounded-xl border border-gray-700 bg-gray-800/50 p-6">
  <HealthTimeline coinId={coin.id} days={30} />
</section>
═══════════════════════════════════════════════════════════
TASK 6: Admin Rule Versions Tab
═══════════════════════════════════════════════════════════

Tìm Admin Panel page: src/app/admin/page.tsx
(hoặc equivalent)

THÊM tab "Rule Versions":

Tab button: "Rule Versions"

Tab content component:

TypeScript

function RuleVersionsTab() {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/admin/rule-versions')
      .then(r => r.json())
      .then(j => { setVersions(j.data); setLoading(false); });
  }, []);

  const handleActivate = async (id: number) => {
    await fetch(`/api/admin/rule-versions/${id}/activate`, {
      method: 'POST'
    });
    // Refetch list
    fetch('/api/admin/rule-versions')
      .then(r => r.json())
      .then(j => setVersions(j.data));
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Rule Versions</h2>
        <span className="text-xs text-gray-400">
          Config versions track which rules generated each score
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-700 text-left text-gray-400">
            <th className="pb-2">Version</th>
            <th className="pb-2">Description</th>
            <th className="pb-2">Weights</th>
            <th className="pb-2">Status</th>
            <th className="pb-2">Activated</th>
            <th className="pb-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {versions.map((v: any) => (
            <tr key={v.id} className="border-b border-gray-800 py-2">
              <td className="py-3 font-mono text-white">v{v.version}</td>
              <td className="py-3 text-gray-300 text-xs">
                {v.description ?? '—'}
              </td>
              <td className="py-3 text-xs text-gray-400">
                T:{v.healthWeights.trend}
                D:{v.healthWeights.derivative}
                V:{v.healthWeights.volume}
                M:{v.healthWeights.momentum}
              </td>
              <td className="py-3">
                {v.isActive ? (
                  <span className="rounded-full bg-green-900/50 px-2 py-0.5
                                   text-xs font-medium text-green-400">
                    ● Active
                  </span>
                ) : (
                  <span className="rounded-full bg-gray-700 px-2 py-0.5
                                   text-xs text-gray-400">
                    Inactive
                  </span>
                )}
              </td>
              <td className="py-3 text-xs text-gray-500">
                {v.activatedAt
                  ? new Date(v.activatedAt).toLocaleDateString('vi-VN')
                  : '—'}
              </td>
              <td className="py-3">
                {!v.isActive && (
                  <button
                    onClick={() => handleActivate(v.id)}
                    className="text-xs text-blue-400 hover:text-blue-300
                               underline underline-offset-2"
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
═══════════════════════════════════════════════════════════
VERIFICATION CHECKLIST (Manual browser test)
═══════════════════════════════════════════════════════════

Test trong browser sau khi implement:

□ TrendArrow: Render improving/declining/stable với màu đúng
□ HealthSparkline: Hiển thị mini chart, trend arrow đúng màu
□ Narrative card: Sparkline visible (nếu có data)
□ Narrative card: Weighting badge hiển thị
□ Coin Detail: Timeline section visible
□ Coin Detail: Reference lines tại 90/80/65/50 có labels
□ Coin Detail: Tooltip hiển thị date/score/status khi hover
□ Coin Detail: Trend header với 7d và 30d change
□ Admin Panel: "Rule Versions" tab exists
□ Admin Panel: Table shows v1 as Active
□ Admin Panel: Activate button works (try v2 if exists)
□ No console errors
□ Loading skeleton hiển thị trước data
□ Error state hiển thị nếu API fail (test with wrong coinId)

═══════════════════════════════════════════════════════════
DELIVERABLES
═══════════════════════════════════════════════════════════

□ src/components/ui/trend-arrow.tsx (NEW)
□ src/components/ui/health-sparkline.tsx (NEW)
□ src/components/health-timeline.tsx (NEW)
□ Narrative card updated (sparkline + weighting badge)
□ Coin Detail page updated (timeline section)
□ Admin panel updated (Rule Versions tab)
□ TypeScript: npx tsc --noEmit → 0 errors
□ npm run build → success
□ All browser verification items checked

□ Report "D-DONE" với:

Screenshot hoặc text description của từng UI component
Any UX decisions made (with reasoning)
Any API response fields missing/unexpected
NOTIFY khi xong: Tech Lead có thể bắt đầu review

text


---

## 📋 ORCHESTRATION PROMPT — Tech Lead / Project Lead
ORCHESTRATION: Sprint P0 Execution Plan
Dành cho: Tech Lead / Project Lead điều phối agents
═══════════════════════════════════════════════════════════
EXECUTION ORDER & DEPENDENCIES
═══════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────┐
│ DAY 1 (Parallel) │
│ │
│ Agent E ──────────────────────────────────── E-DONE │
│ (scoring.ts + risk.ts fixes) │
│ │
│ Agent A ──────────────────────────────────── A-DONE │
│ (DB migrations) │
└─────────────────────────────────────────────────────────┘
↓ (wait for A-DONE)
┌─────────────────────────────────────────────────────────┐
│ DAY 2 (Parallel after A-DONE) │
│ │
│ Agent B ──────────────────────────────────── B-DONE │
│ (Services) ↑ │
│ requires A-DONE │
└─────────────────────────────────────────────────────────┘
↓ (wait for B-DONE)
┌─────────────────────────────────────────────────────────┐
│ DAY 3 (Parallel after B-DONE) │
│ │
│ Agent C ──────────────────────────────────── C-DONE │
│ (API Routes) ↑ │
│ requires B-DONE │
└─────────────────────────────────────────────────────────┘
↓ (wait for C-DONE)
┌─────────────────────────────────────────────────────────┐
│ DAY 3-4 │
│ │
│ Agent D ──────────────────────────────────── D-DONE │
│ (Frontend) ↑ │
│ requires C-DONE │
└─────────────────────────────────────────────────────────┘
↓
┌─────────────────────────────────────────────────────────┐
│ DAY 4: Review + Verification │
│ │
│ Tech Lead: Run 03_Review_Pack.md checklist │
│ QA: Run 04_Verification_Pack.md │
└─────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════
SIGNALS TO WATCH FOR
═══════════════════════════════════════════════════════════

"E-DONE" → scoring.ts + risk.ts fixes + tests passing
"A-DONE" → DB migrations done + verify queries run
"B-DONE" → Services done + unit tests passing + CARV test pass
"C-DONE" → API routes done + 8 manual tests pass
"D-DONE" → UI components done + browser check pass

═══════════════════════════════════════════════════════════
BLOCKERS ESCALATION
═══════════════════════════════════════════════════════════

IF Agent A blocked (DB issue):
→ Check PostgreSQL connection
→ Check drizzle-kit version compatibility
→ Manual SQL fallback

IF Agent B blocked (service import error):
→ Check if Agent A schema.ts export is correct
→ Check ruleVersions table name matches schema

IF Agent C blocked (route not found):
→ Check Next.js app router file structure
→ Verify params type matches Next.js version

IF Agent D blocked (Recharts issue):
→ Check Recharts 3.x API (may differ from 2.x)
→ Fallback: simpler chart using CSS/SVG

═══════════════════════════════════════════════════════════
QUICK VERIFICATION COMMANDS (run after all agents done)
═══════════════════════════════════════════════════════════

1. TypeScript
npx tsc --noEmit

Expected: 0 errors
2. Build
npm run build

Expected: Success
3. Unit tests
npm test

Expected: All pass
4. DB state
psql $DATABASE_URL -c "
SELECT version, is_active, activated_at
FROM rule_versions ORDER BY version;
"

Expected: version=1, is_active=true
5. API smoke test
curl -s localhost:3000/api/coins/1/health-timeline |
jq '.success'

Expected: true
6. Weighted narrative check
curl -s localhost:3000/api/narratives/1 |
jq '.data.narrativeHealth.weightingMethod'

Expected: "market_cap" or "equal"
7. Regression: dashboard still works
curl -s localhost:3000/api/dashboard | jq '.success'

Expected: true