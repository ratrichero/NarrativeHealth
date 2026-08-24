import {
  pgTable,
  serial,
  bigserial,
  bigint,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  date,
  decimal,
  jsonb,
  real,
  primaryKey,
  index,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ==================== NARRATIVE ====================
export const narratives = pgTable("narratives", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==================== COIN ====================
export const coins = pgTable("coins", {
  id: serial("id").primaryKey(),
  symbol: varchar("symbol", { length: 20 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  binanceSpotSymbol: varchar("binance_spot_symbol", { length: 30 }),
  binanceFuturesSymbol: varchar("binance_futures_symbol", { length: 30 }),
  coingeckoId: varchar("coingecko_id", { length: 100 }),
  hasFutures: boolean("has_futures").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==================== COIN_NARRATIVE (Many-to-Many) ====================
export const coinNarratives = pgTable(
  "coin_narratives",
  {
    coinId: integer("coin_id")
      .notNull()
      .references(() => coins.id, { onDelete: "cascade" }),
    narrativeId: integer("narrative_id")
      .notNull()
      .references(() => narratives.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.coinId, table.narrativeId] }),
  })
);

// ==================== MARKET_PRICE_DAILY ====================
export const marketPriceDaily = pgTable(
  "market_price_daily",
  {
    id: serial("id").primaryKey(),
    coinId: integer("coin_id")
      .notNull()
      .references(() => coins.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    open: decimal("open", { precision: 24, scale: 8 }).notNull(),
    high: decimal("high", { precision: 24, scale: 8 }).notNull(),
    low: decimal("low", { precision: 24, scale: 8 }).notNull(),
    close: decimal("close", { precision: 24, scale: 8 }).notNull(),
    volume: decimal("volume", { precision: 24, scale: 2 }).notNull(),
    quoteVolume: decimal("quote_volume", { precision: 24, scale: 2 }),
    volume24h: decimal("volume_24h", { precision: 24, scale: 2 }),
    source: varchar("source", { length: 50 }).default("binance").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    coinDateIdx: index("market_price_coin_date_idx").on(table.coinId, table.date),
    uniqueCoinDate: unique("market_price_unique").on(table.coinId, table.date),
  })
);

// ==================== COIN_METRICS ====================
export const coinMetrics = pgTable(
  "coin_metrics",
  {
    id: serial("id").primaryKey(),
    coinId: integer("coin_id")
      .notNull()
      .references(() => coins.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    openInterest: decimal("open_interest", { precision: 24, scale: 2 }),
    fundingRate: decimal("funding_rate", { precision: 18, scale: 8 }),
    marketCap: decimal("market_cap", { precision: 24, scale: 2 }),
    fullyDilutedValuation: decimal("fully_diluted_valuation", { precision: 24, scale: 2 }),
    circulatingSupply: decimal("circulating_supply", { precision: 24, scale: 2 }),
    totalSupply: decimal("total_supply", { precision: 24, scale: 2 }),
    source: varchar("source", { length: 50 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    coinDateSourceIdx: index("coin_metrics_idx").on(table.coinId, table.date, table.source),
    uniqueCoinDateSource: unique("coin_metrics_unique").on(table.coinId, table.date, table.source),
  })
);

// ==================== SOURCE_STATUS ====================
export const sourceStatus = pgTable(
  "source_status",
  {
    id: serial("id").primaryKey(),
    source: varchar("source", { length: 50 }).notNull(),
    coinId: integer("coin_id").references(() => coins.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 20 }).notNull(), // OK, PARTIAL, FAILED
    lastSuccess: timestamp("last_success"),
    lastAttempt: timestamp("last_attempt").notNull(),
    errorMessage: text("error_message"),
    recordsCollected: integer("records_collected").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sourceIdx: index("source_status_idx").on(table.source, table.coinId),
    uniqueSourceCoin: unique("source_status_unique").on(table.source, table.coinId),
  })
);

// ==================== FEATURE_VERSION ====================
export const featureVersions = pgTable("feature_versions", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull(),
  description: text("description"),
  algorithm: jsonb("algorithm"), // Store algorithm details
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ==================== FEATURE ====================
export const features = pgTable(
  "features",
  {
    id: serial("id").primaryKey(),
    coinId: integer("coin_id")
      .notNull()
      .references(() => coins.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    versionId: integer("version_id")
      .notNull()
      .references(() => featureVersions.id),
    trendScore: real("trend_score"),
    derivativeScore: real("derivative_score"),
    volumeScore: real("volume_score"),
    momentumScore: real("momentum_score"),
    trendDetail: jsonb("trend_detail"),
    derivativeDetail: jsonb("derivative_detail"),
    volumeDetail: jsonb("volume_detail"),
    momentumDetail: jsonb("momentum_detail"),
    confidenceScore: real("confidence_score"),
    dataCompleteness: real("data_completeness"),
    missingSources: jsonb("missing_sources"),
    sourceProvenance: jsonb("source_provenance"),
    calculatedAt: timestamp("calculated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    coinDateIdx: index("features_coin_date_idx").on(table.coinId, table.date),
    uniqueFeature: unique("features_unique").on(table.coinId, table.date, table.versionId),
  })
);

// ==================== HEALTH_SCORE ====================
export const healthScores = pgTable(
  "health_scores",
  {
    id: serial("id").primaryKey(),
    coinId: integer("coin_id")
      .notNull()
      .references(() => coins.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    healthScore: real("health_score").notNull(),
    previousScore: real("previous_score"),
    scoreChange: real("score_change"),
    status: varchar("status", { length: 20 }).notNull(), // STRONG, HEALTHY, NEUTRAL, CAUTION, WEAK
    confidenceScore: real("confidence_score"),
    weightBreakdown: jsonb("weight_breakdown"), // { trend: 35, derivative: 28, ... }
    ruleVersionId: integer("rule_version_id")
      .references(() => ruleVersions.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    coinDateIdx: index("health_scores_idx").on(table.coinId, table.date),
    uniqueHealth: unique("health_scores_unique").on(table.coinId, table.date),
  })
);

// ==================== RECOMMENDATION ====================
export const recommendations = pgTable(
  "recommendations",
  {
    id: serial("id").primaryKey(),
    coinId: integer("coin_id")
      .notNull()
      .references(() => coins.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    signal: varchar("signal", { length: 30 }).notNull(), // STRONG_WATCH, WATCH, OBSERVE, WEAK
    reason: text("reason").notNull(),
    reasonBreakdown: jsonb("reason_breakdown"),
    healthScoreId: integer("health_score_id").references(() => healthScores.id),
    ruleVersionId: integer("rule_version_id")
      .references(() => ruleVersions.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    coinDateIdx: index("recommendations_idx").on(table.coinId, table.date),
    uniqueRec: unique("recommendations_unique").on(table.coinId, table.date),
  })
);

// ==================== NARRATIVE_HEALTH ====================
export const narrativeHealth = pgTable(
  "narrative_health",
  {
    id: serial("id").primaryKey(),
    narrativeId: integer("narrative_id")
      .notNull()
      .references(() => narratives.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    healthScore: real("health_score").notNull(),
    previousScore: real("previous_score"),
    scoreChange: real("score_change"),
    status: varchar("status", { length: 20 }).notNull(),
    coinCount: integer("coin_count").notNull(),
    topCoinId: integer("top_coin_id").references(() => coins.id),
    weakestCoinId: integer("weakest_coin_id").references(() => coins.id),
    avgConfidence: real("avg_confidence"),
    coinBreakdown: jsonb("coin_breakdown"), // Array of { coinId, score, weight }
    ruleVersionId: integer("rule_version_id")
      .references(() => ruleVersions.id),
    weightingMethod: varchar("weighting_method", { length: 20 })
      .notNull()
      .default("equal"),
    weightDetails: jsonb("weight_details")
      .$type<Record<string, {
        coinId: number;
        symbol: string;
        weight: number;
        marketCap: number | null;
        healthScore: number;
      }>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    narrativeDateIdx: index("narrative_health_idx").on(table.narrativeId, table.date),
    uniqueNarrativeHealth: unique("narrative_health_unique").on(table.narrativeId, table.date),
  })
);

// ─── Rule Versions (P0B) ─────────────────────────────────

export const ruleVersions = pgTable("rule_versions", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull().unique(),
  description: text("description"),
  healthWeights: jsonb("health_weights")
    .$type<{
      trend: number;
      derivative: number;
      volume: number;
      momentum: number;
    }>()
    .notNull(),
  confidenceWeights: jsonb("confidence_weights")
    .$type<{
      binance_spot: number;
      binance_futures: number;
      coingecko: number;
    }>()
    .notNull(),
  recommendationThresholds: jsonb("recommendation_thresholds")
    .$type<{
      strong_watch: number;
      watch: number;
      observe: number;
    }>()
    .notNull(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  activatedAt: timestamp("activated_at"),
});

export type RuleVersion = typeof ruleVersions.$inferSelect;
export type NewRuleVersion = typeof ruleVersions.$inferInsert;

// ==================== MORNING_SNAPSHOT ====================
export const morningSnapshots = pgTable("morning_snapshots", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  snapshotData: jsonb("snapshot_data").notNull(), // Full dashboard state
  narrativeCount: integer("narrative_count").notNull(),
  coinCount: integer("coin_count").notNull(),
  avgHealthScore: real("avg_health_score"),
  topNarrativeId: integer("top_narrative_id").references(() => narratives.id),
  alertCount: integer("alert_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ==================== INDICATORS ====================
export const indicators = pgTable("indicators", {
  id: serial("id").primaryKey(),
  coinId: integer("coin_id")
    .notNull()
    .references(() => coins.id, { onDelete: "cascade" }),
  date: date("date").notNull(),
  timeframe: varchar("timeframe", { length: 10 }).notNull(),
  indicatorType: varchar("indicator_type", { length: 50 }).notNull(),
  indicatorValue: decimal("indicator_value", { precision: 20, scale: 8 }),
  indicatorMeta: jsonb("indicator_meta"),
  source: varchar("source", { length: 30 }),
  calculatedAt: timestamp("calculated_at").notNull().defaultNow(),
}, (table) => ({
  coinDateTypeIdx: index("indicators_coin_date_type_idx").on(table.coinId, table.date, table.indicatorType),
  indicatorsUnique: unique("indicators_unique").on(table.coinId, table.date, table.timeframe, table.indicatorType),
}));

// ==================== RECOMMENDATION_RULES ====================
export const recommendationRules = pgTable("recommendation_rules", {
  id: serial("id").primaryKey(),
  ruleVersionId: integer("rule_version_id")
    .notNull()
    .references(() => ruleVersions.id),
  priority: integer("priority").notNull().default(50),
  signal: varchar("signal", { length: 20 }).notNull(),
  logicOperator: varchar("logic_operator", { length: 5 })
    .notNull().default("AND"),
  conditions: jsonb("conditions").notNull(),
  reasonTemplate: text("reason_template").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  versionActiveIdx: index("rec_rules_version_active_idx").on(table.ruleVersionId, table.isActive),
  priorityIdx: index("rec_rules_priority_idx").on(table.priority),
}));

// ==================== MORNING_SNAPSHOT_HEADERS ====================
export const morningSnapshotHeaders = pgTable("morning_snapshot_headers", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  totalCoins: integer("total_coins"),
  avgHealthScore: decimal("avg_health_score", { precision: 5, scale: 2 }),
  topNarrativeId: integer("top_narrative_id").references(() => narratives.id),
  alertCount: integer("alert_count").default(0),
  ruleVersionId: integer("rule_version_id").references(() => ruleVersions.id),
  timezone: varchar("timezone", { length: 50 })
    .default("Asia/Ho_Chi_Minh"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ==================== MORNING_SNAPSHOT_COINS ====================
export const morningSnapshotCoins = pgTable("morning_snapshot_coins", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => morningSnapshotHeaders.id, { onDelete: "cascade" }),
  coinId: integer("coin_id").notNull().references(() => coins.id),
  healthScore: decimal("health_score", { precision: 5, scale: 2 }),
  scoreChange: decimal("score_change", { precision: 5, scale: 2 }),
  signal: varchar("signal", { length: 20 }),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
}, (table) => ({
  snapshotCoinUnique: unique("snapshot_coin_unique").on(table.snapshotId, table.coinId),
  snapshotIdx: index("snapshot_coins_snapshot_idx").on(table.snapshotId),
}));

// ==================== MORNING_SNAPSHOT_NARRATIVES ====================
export const morningSnapshotNarratives = pgTable("morning_snapshot_narratives", {
  id: serial("id").primaryKey(),
  snapshotId: integer("snapshot_id")
    .notNull()
    .references(() => morningSnapshotHeaders.id, { onDelete: "cascade" }),
  narrativeId: integer("narrative_id").notNull()
    .references(() => narratives.id),
  healthScore: decimal("health_score", { precision: 5, scale: 2 }),
  scoreChange: decimal("score_change", { precision: 5, scale: 2 }),
  coinCount: integer("coin_count"),
  topCoinId: integer("top_coin_id").references(() => coins.id),
  weakestCoinId: integer("weakest_coin_id").references(() => coins.id),
  weightingMethod: varchar("weighting_method", { length: 20 }),
}, (table) => ({
  snapshotNarrativeUnique: unique("snapshot_narrative_unique").on(table.snapshotId, table.narrativeId),
  snapshotIdx: index("snapshot_narratives_snapshot_idx").on(table.snapshotId),
}));

// ==================== SCORE_CONFIG ====================
export const scoreConfigs = pgTable("score_configs", {
  id: serial("id").primaryKey(),
  configType: varchar("config_type", { length: 50 }).notNull(), // health_weights, recommendation_thresholds, confidence_weights
  configKey: varchar("config_key", { length: 100 }).notNull(),
  configValue: jsonb("config_value").notNull(),
  version: integer("version").default(1).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ==================== WATCHLIST ====================
export const watchlists = pgTable(
  "watchlists",
  {
    id: serial("id").primaryKey(),
    coinId: integer("coin_id")
      .notNull()
      .references(() => coins.id, { onDelete: "cascade" }),
    note: text("note"),
    priority: integer("priority").default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    uniqueWatchlist: unique("watchlist_unique").on(table.coinId),
  })
);

// ==================== SCHEDULER_LOG ====================
export const schedulerLogs = pgTable("scheduler_logs", {
  id: serial("id").primaryKey(),
  jobName: varchar("job_name", { length: 100 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(), // STARTED, COMPLETED, FAILED
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  duration: integer("duration"), // in seconds
  recordsProcessed: integer("records_processed").default(0),
  errorMessage: text("error_message"),
  details: jsonb("details"),
});

// ==================== EVENT_RISKS ====================
export const eventRisks = pgTable("event_risks", {
  id: serial("id").primaryKey(),
  coinId: integer("coin_id").references(() => coins.id),
  narrativeId: integer("narrative_id").references(() => narratives.id),
  eventType: varchar("event_type", { length: 30 }).notNull(),
  eventDate: date("event_date").notNull(),
  riskLevel: varchar("risk_level", { length: 10 }).notNull(),
  riskScore: decimal("risk_score", { precision: 5, scale: 2 }),
  title: varchar("title", { length: 200 }).notNull(),
  description: text("description"),
  sourceUrl: text("source_url"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: date("expires_at"),
}, (table) => ({
  coinIdx: index("event_risks_coin_idx").on(table.coinId),
  narrativeIdx: index("event_risks_narrative_idx").on(table.narrativeId),
  dateIdx: index("event_risks_date_idx").on(table.eventDate),
}));

// ==================== COIN_CORRELATIONS ====================
export const coinCorrelations = pgTable("coin_correlations", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  coinIdA: integer("coin_id_a").notNull().references(() => coins.id),
  coinIdB: integer("coin_id_b").notNull().references(() => coins.id),
  correlation: decimal("correlation", { precision: 5, scale: 4 }),
  periodDays: integer("period_days").default(30),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  dateIdx: index("coin_correlations_date_idx").on(table.date),
  coinsIdx: index("coin_correlations_coins_idx").on(table.coinIdA, table.coinIdB),
  uniqueCorrelation: unique("coin_correlations_unique").on(table.date, table.coinIdA, table.coinIdB, table.periodDays),
}));

// ==================== NARRATIVE_MOMENTUM ====================
export const narrativeMomentum = pgTable("narrative_momentum", {
  id: serial("id").primaryKey(),
  narrativeId: integer("narrative_id").notNull().references(() => narratives.id),
  date: date("date").notNull(),
  momentumScore: decimal("momentum_score", { precision: 5, scale: 2 }),
  momentumType: varchar("momentum_type", { length: 20 }),
  health7dAgo: decimal("health_7d_ago", { precision: 5, scale: 2 }),
  healthNow: decimal("health_now", { precision: 5, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  narrativeDateUnique: unique("narrative_momentum_unique").on(table.narrativeId, table.date),
  narrativeIdx: index("narrative_momentum_narrative_idx").on(table.narrativeId),
}));

// ==================== AUTHORITATIVE NARRATIVE MEMBERSHIP ====================
export const narrativeMembershipEvents = pgTable("narrative_membership_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  narrativeId: integer("narrative_id").notNull().references(() => narratives.id, { onDelete: "restrict" }),
  coinId: integer("coin_id").notNull().references(() => coins.id, { onDelete: "restrict" }),
  eventType: varchar("event_type", { length: 30 }).notNull(),
  isPrimary: boolean("is_primary"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  source: varchar("source", { length: 50 }).notNull(),
  sourceRef: varchar("source_ref", { length: 200 }),
  actor: varchar("actor", { length: 100 }),
  idempotencyKey: varchar("idempotency_key", { length: 200 }).notNull().unique(),
  provenance: jsonb("provenance").notNull(),
}, (table) => ({
  eventTypeCheck: check("narrative_membership_events_type_check", sql`${table.eventType} IN ('ADDED', 'REMOVED', 'PRIMARY_SET')`),
  primaryCheck: check("narrative_membership_events_primary_check", sql`${table.eventType} = 'REMOVED' OR ${table.isPrimary} IS NOT NULL`),
  narrativeEffectiveIdx: index("narrative_membership_events_narrative_effective_idx").on(table.narrativeId, table.effectiveAt, table.id),
  narrativeCoinEffectiveIdx: index("narrative_membership_events_narrative_coin_effective_idx").on(table.narrativeId, table.coinId, table.effectiveAt, table.id),
  coinEffectiveIdx: index("narrative_membership_events_coin_effective_idx").on(table.coinId, table.effectiveAt),
}));

export const narrativeMembershipCoverage = pgTable("narrative_membership_coverage", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  narrativeId: integer("narrative_id").notNull().references(() => narratives.id, { onDelete: "restrict" }),
  historyCoverageStart: timestamp("history_coverage_start", { withTimezone: true }).notNull(),
  source: varchar("source", { length: 50 }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedBy: varchar("verified_by", { length: 100 }),
  provenance: jsonb("provenance").notNull(),
}, (table) => ({
  identityUnique: unique("narrative_membership_coverage_unique").on(table.narrativeId, table.historyCoverageStart),
  narrativeStartIdx: index("narrative_membership_coverage_narrative_start_idx").on(table.narrativeId, table.historyCoverageStart),
}));

export const narrativeMembershipSnapshots = pgTable("narrative_membership_snapshots", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  narrativeId: integer("narrative_id").notNull().references(() => narratives.id, { onDelete: "restrict" }),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
  snapshotRevision: integer("snapshot_revision").notNull().default(1),
  membershipMode: varchar("membership_mode", { length: 30 }).notNull(),
  membershipSource: varchar("membership_source", { length: 50 }).notNull(),
  ledgerCutoffEventId: bigint("ledger_cutoff_event_id", { mode: "number" }).references(() => narrativeMembershipEvents.id, { onDelete: "restrict" }),
  memberCount: integer("member_count").notNull(),
  memberDigest: varchar("member_digest", { length: 128 }).notNull(),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  provenance: jsonb("provenance").notNull(),
}, (table) => ({
  identityUnique: unique("narrative_membership_snapshots_identity_unique").on(table.narrativeId, table.windowEnd, table.snapshotRevision, table.membershipMode),
  revisionCheck: check("narrative_membership_snapshots_revision_check", sql`${table.snapshotRevision} > 0`),
  countCheck: check("narrative_membership_snapshots_count_check", sql`${table.memberCount} >= 0`),
  narrativeWindowIdx: index("narrative_membership_snapshots_narrative_window_idx").on(table.narrativeId, table.windowEnd),
  windowIdx: index("narrative_membership_snapshots_window_idx").on(table.windowEnd),
}));

export const narrativeMembershipSnapshotMembers = pgTable("narrative_membership_snapshot_members", {
  snapshotId: bigint("snapshot_id", { mode: "number" }).notNull().references(() => narrativeMembershipSnapshots.id, { onDelete: "restrict" }),
  coinId: integer("coin_id").notNull().references(() => coins.id, { onDelete: "restrict" }),
  isPrimary: boolean("is_primary").notNull(),
  membershipState: varchar("membership_state", { length: 30 }).notNull().default("MEMBER"),
  sourceEventId: bigint("source_event_id", { mode: "number" }).references(() => narrativeMembershipEvents.id, { onDelete: "restrict" }),
  provenance: jsonb("provenance"),
}, (table) => ({
  memberPk: primaryKey({ columns: [table.snapshotId, table.coinId] }),
  stateCheck: check("narrative_membership_snapshot_members_state_check", sql`${table.membershipState} = 'MEMBER'`),
  coinSnapshotIdx: index("narrative_membership_snapshot_members_coin_snapshot_idx").on(table.coinId, table.snapshotId),
}));

// ==================== P3_NARRATIVE_INTELLIGENCE ====================
export const p3NarrativeIntelligence = pgTable("p3_narrative_intelligence", {
  id: serial("id").primaryKey(),
  narrativeId: integer("narrative_id").notNull().references(() => narratives.id, { onDelete: "restrict" }),
  windowEnd: timestamp("window_end").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  algorithmKey: varchar("algorithm_key", { length: 100 }).notNull(),
  algorithmVersion: varchar("algorithm_version", { length: 50 }).notNull(),
  ruleVersionId: integer("rule_version_id").references(() => ruleVersions.id, { onDelete: "restrict" }),
  featureVersionId: integer("feature_version_id").references(() => featureVersions.id, { onDelete: "restrict" }),
  scoreConfigId: integer("score_config_id").references(() => scoreConfigs.id, { onDelete: "restrict" }),
  membershipSnapshotId: bigint("membership_snapshot_id", { mode: "number" }).references(() => narrativeMembershipSnapshots.id, { onDelete: "restrict" }),
  calculationMode: varchar("calculation_mode", { length: 30 }).notNull().default("observed"),
  availabilityState: varchar("availability_state", { length: 30 }).notNull(),
  confidence: decimal("confidence", { precision: 7, scale: 4 }),
  breadth: decimal("breadth", { precision: 9, scale: 6 }),
  strongBreadth: decimal("strong_breadth", { precision: 9, scale: 6 }),
  momentum1d: decimal("momentum_1d", { precision: 12, scale: 6 }),
  momentum3d: decimal("momentum_3d", { precision: 12, scale: 6 }),
  momentum7d: decimal("momentum_7d", { precision: 12, scale: 6 }),
  momentum14d: decimal("momentum_14d", { precision: 12, scale: 6 }),
  acceleration: decimal("acceleration", { precision: 12, scale: 6 }),
  relativeStrength1d: decimal("relative_strength_1d", { precision: 12, scale: 6 }),
  relativeStrength3d: decimal("relative_strength_3d", { precision: 12, scale: 6 }),
  relativeStrength7d: decimal("relative_strength_7d", { precision: 12, scale: 6 }),
  relativeStrength14d: decimal("relative_strength_14d", { precision: 12, scale: 6 }),
  leaderCoinId: integer("leader_coin_id").references(() => coins.id, { onDelete: "restrict" }),
  leaderScore: decimal("leader_score", { precision: 9, scale: 6 }),
  concentrationTop1: decimal("concentration_top1", { precision: 9, scale: 6 }),
  concentrationTop3: decimal("concentration_top3", { precision: 9, scale: 6 }),
  concentrationClassification: varchar("concentration_classification", { length: 30 }),
  regime: varchar("regime", { length: 30 }),
  rotation: varchar("rotation", { length: 30 }),
  rotationScore: decimal("rotation_score", { precision: 9, scale: 6 }),
  explanation: jsonb("explanation"),
  provenance: jsonb("provenance").notNull(),
  calculatedAt: timestamp("calculated_at").notNull(),
  persistedAt: timestamp("persisted_at").defaultNow().notNull(),
}, (table) => ({
  identityUnique: unique("p3_narrative_intelligence_identity_unique").on(table.narrativeId, table.windowEnd, table.algorithmKey, table.algorithmVersion, table.calculationMode),
  narrativeWindowIdx: index("p3_narrative_intelligence_narrative_window_idx").on(table.narrativeId, table.windowEnd),
  algorithmIdx: index("p3_narrative_intelligence_algorithm_idx").on(table.algorithmKey, table.algorithmVersion),
  windowIdx: index("p3_narrative_intelligence_window_idx").on(table.windowEnd),
  membershipSnapshotIdx: index("p3_narrative_intelligence_membership_snapshot_idx").on(table.membershipSnapshotId),
}));

// ==================== P3_CONSTITUENT_SNAPSHOTS ====================
export const p3ConstituentSnapshots = pgTable("p3_constituent_snapshots", {
  id: serial("id").primaryKey(),
  intelligenceId: integer("intelligence_id").notNull().references(() => p3NarrativeIntelligence.id, { onDelete: "restrict" }),
  capturedAt: timestamp("captured_at").notNull(),
  membershipSource: varchar("membership_source", { length: 40 }).notNull(),
  membershipMode: varchar("membership_mode", { length: 30 }).notNull(),
  memberCount: integer("member_count").notNull(),
  eligibleCount: integer("eligible_count").notNull(),
  provenance: jsonb("provenance").notNull(),
}, (table) => ({
  intelligenceUnique: unique("p3_constituent_snapshot_intelligence_unique").on(table.intelligenceId),
  capturedIdx: index("p3_constituent_snapshot_captured_idx").on(table.capturedAt),
}));

export const p3ConstituentSnapshotMembers = pgTable("p3_constituent_snapshot_members", {
  snapshotId: integer("snapshot_id").notNull().references(() => p3ConstituentSnapshots.id, { onDelete: "restrict" }),
  coinId: integer("coin_id").notNull().references(() => coins.id, { onDelete: "restrict" }),
  membershipState: varchar("membership_state", { length: 30 }).notNull(),
  inclusionReason: varchar("inclusion_reason", { length: 100 }),
  availabilityState: varchar("availability_state", { length: 30 }).notNull(),
  inputManifest: jsonb("input_manifest"),
}, (table) => ({
  memberPk: primaryKey({ columns: [table.snapshotId, table.coinId] }),
  coinIdx: index("p3_constituent_snapshot_members_coin_idx").on(table.coinId),
}));

export const p3LeadershipMembers = pgTable("p3_leadership_members", {
  intelligenceId: integer("intelligence_id").notNull().references(() => p3NarrativeIntelligence.id, { onDelete: "restrict" }),
  coinId: integer("coin_id").notNull().references(() => coins.id, { onDelete: "restrict" }),
  leaderScore: decimal("leader_score", { precision: 9, scale: 6 }).notNull(),
  leaderRank: integer("leader_rank").notNull(),
  leadershipStatus: varchar("leadership_status", { length: 30 }),
  isEmergingLeader: boolean("is_emerging_leader").notNull().default(false),
  leaderDays7d: integer("leader_days_7d"),
  leaderPersistence7d: decimal("leader_persistence_7d", { precision: 9, scale: 8 }),
  contribution: decimal("contribution", { precision: 9, scale: 8 }).notNull(),
  healthScore: decimal("health_score", { precision: 9, scale: 6 }).notNull(),
  momentumScore: decimal("momentum_score", { precision: 9, scale: 6 }).notNull(),
  relativeStrengthScore: decimal("relative_strength_score", { precision: 9, scale: 6 }).notNull(),
  volumeScore: decimal("volume_score", { precision: 9, scale: 6 }).notNull(),
}, (table) => ({
  memberPk: primaryKey({ columns: [table.intelligenceId, table.coinId] }),
  rankUnique: unique("p3_leadership_members_intelligence_rank_unique").on(table.intelligenceId, table.leaderRank),
  coinIdx: index("p3_leadership_members_coin_idx").on(table.coinId),
}));
// ==================== P3_HISTORICAL_CORRECTIONS ====================
export const p3HistoricalCorrections = pgTable("p3_historical_corrections", {
  id: serial("id").primaryKey(),
  originalIntelligenceId: integer("original_intelligence_id").notNull().references(() => p3NarrativeIntelligence.id, { onDelete: "restrict" }),
  originalSnapshotId: bigint("original_snapshot_id", { mode: "number" }).references(() => narrativeMembershipSnapshots.id, { onDelete: "restrict" }),
  correctedSnapshotId: bigint("corrected_snapshot_id", { mode: "number" }).references(() => narrativeMembershipSnapshots.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  correctedAt: timestamp("corrected_at", { withTimezone: true }).notNull().defaultNow(),
  algorithmKey: varchar("algorithm_key", { length: 100 }),
  algorithmVersion: varchar("algorithm_version", { length: 50 }),
  correctedBy: varchar("corrected_by", { length: 100 }),
  provenance: jsonb("provenance").notNull(),
}, (table) => ({
  originalIntelligenceIdx: index("p3_historical_corrections_original_idx").on(table.originalIntelligenceId),
  originalSnapshotIdx: index("p3_historical_corrections_original_snapshot_idx").on(table.originalSnapshotId),
}));

// ==================== DECISION_SIGNALS ====================
export const decisionSignals = pgTable("decision_signals", {
  id: serial("id").primaryKey(),
  coinId: integer("coin_id").notNull().references(() => coins.id),
  date: date("date").notNull(),
  baseHealth: decimal("base_health", { precision: 5, scale: 2 }),
  eventRiskScore: decimal("event_risk_score", { precision: 5, scale: 2 }),
  adjustedScore: decimal("adjusted_score", { precision: 5, scale: 2 }),
  adjustmentReason: text("adjustment_reason"),
  activeEvents: jsonb("active_events"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  coinDateUnique: unique("decision_signals_unique").on(table.coinId, table.date),
  coinDateIdx: index("decision_signals_coin_date_idx").on(table.coinId, table.date),
}));

// ==================== ALERT_RULES ====================
export const alertRules = pgTable("alert_rules", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  scope: varchar("scope", { length: 10 }).notNull(),
  scopeId: integer("scope_id"),
  triggerType: varchar("trigger_type", { length: 30 }).notNull(),
  triggerValue: decimal("trigger_value", { precision: 10, scale: 2 }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  scopeIdx: index("alert_rules_scope_idx").on(table.scope, table.scopeId),
}));

// ==================== ALERT_HISTORY ====================
export const alertHistory = pgTable("alert_history", {
  id: serial("id").primaryKey(),
  ruleId: integer("rule_id").notNull().references(() => alertRules.id),
  triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
  triggerDetail: jsonb("trigger_detail"),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: varchar("acknowledged_by", { length: 100 }),
}, (table) => ({
  ruleIdx: index("alert_history_rule_idx").on(table.ruleId),
  triggeredIdx: index("alert_history_triggered_idx").on(table.triggeredAt),
}));

// ==================== P5 HISTORICAL ARTIFACTS (P5-08) ====================
// Persistence for P5-07 replay validation. Artifacts are stored verbatim as
// jsonb payloads; identity/version columns enable exact reference resolution
// (P5-07 §5). Append-only by contract: the store/writer expose no
// UPDATE/DELETE surface and migration 0021 adds DB-level immutability
// triggers. contentHash stays PROVISIONAL (P5-02 AD-014) — the column is
// nullable and never computed here.

export const p5DecisionRecords = pgTable(
  "p5_decision_records",
  {
    id: serial("id").primaryKey(),
    identityKey: varchar("identity_key", { length: 255 }).notNull().unique(),
    decisionId: varchar("decision_id", { length: 100 }).notNull(),
    narrativeId: integer("narrative_id").notNull(),
    outcome: varchar("outcome", { length: 30 }).notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    blockerSource: varchar("blocker_source", { length: 20 }),
    blockerRef: varchar("blocker_ref", { length: 255 }),
    actionType: varchar("action_type", { length: 40 }),
    decisionState: varchar("decision_state", { length: 30 }).notNull(),
    approvalState: varchar("approval_state", { length: 30 }).notNull(),
    executionState: varchar("execution_state", { length: 30 }).notNull(),
    permissionResult: varchar("permission_result", { length: 30 }).notNull(),
    record: jsonb("record").notNull(),
    decisionAt: timestamp("decision_at", { withTimezone: true }),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    narrativeIdx: index("p5_decision_records_narrative_idx").on(table.narrativeId),
  })
);

export const p5P4Snapshots = pgTable(
  "p5_p4_snapshots",
  {
    id: serial("id").primaryKey(),
    identityKey: varchar("identity_key", { length: 255 }).notNull().unique(),
    narrativeId: integer("narrative_id").notNull(),
    window: varchar("window", { length: 20 }).notNull(),
    algorithmKey: varchar("algorithm_key", { length: 100 }).notNull(),
    algorithmVersion: varchar("algorithm_version", { length: 50 }).notNull(),
    calculationMode: varchar("calculation_mode", { length: 30 }).notNull(),
    semanticVersion: varchar("semantic_version", { length: 50 }),
    asOf: timestamp("as_of", { withTimezone: true }),
    status: varchar("status", { length: 30 }),
    contentHash: varchar("content_hash", { length: 128 }),
    snapshot: jsonb("snapshot").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    narrativeWindowIdx: index("p5_p4_snapshots_narrative_window_idx").on(table.narrativeId, table.window),
  })
);

export const p5Policies = pgTable(
  "p5_policies",
  {
    id: serial("id").primaryKey(),
    identityKey: varchar("identity_key", { length: 255 }).notNull().unique(),
    policyId: varchar("policy_id", { length: 100 }).notNull(),
    policyVersion: varchar("policy_version", { length: 50 }).notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    evaluationAt: timestamp("evaluation_at", { withTimezone: true }),
    policy: jsonb("policy").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    policyIdIdx: index("p5_policies_policy_id_idx").on(table.policyId),
  })
);

export const p5Guardrails = pgTable(
  "p5_guardrails",
  {
    id: serial("id").primaryKey(),
    identityKey: varchar("identity_key", { length: 255 }).notNull().unique(),
    guardrailId: varchar("guardrail_id", { length: 100 }).notNull(),
    version: varchar("version", { length: 50 }),
    outcome: varchar("outcome", { length: 30 }),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    guardrail: jsonb("guardrail").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    guardrailIdIdx: index("p5_guardrails_guardrail_id_idx").on(table.guardrailId),
  })
);

export const p5Approvals = pgTable(
  "p5_approvals",
  {
    id: serial("id").primaryKey(),
    identityKey: varchar("identity_key", { length: 255 }).notNull().unique(),
    approvalId: varchar("approval_id", { length: 100 }).notNull(),
    decisionIdRef: varchar("decision_id_ref", { length: 100 }),
    state: varchar("state", { length: 30 }),
    authorityRef: varchar("authority_ref", { length: 100 }),
    actor: varchar("actor", { length: 100 }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvalPolicyVersion: varchar("approval_policy_version", { length: 50 }),
    approval: jsonb("approval").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    decisionRefIdx: index("p5_approvals_decision_id_ref_idx").on(table.decisionIdRef),
  })
);

export const p5Permissions = pgTable(
  "p5_permissions",
  {
    id: serial("id").primaryKey(),
    identityKey: varchar("identity_key", { length: 255 }).notNull().unique(),
    ref: varchar("ref", { length: 255 }).notNull(),
    result: varchar("result", { length: 30 }),
    evaluatedAt: timestamp("evaluated_at", { withTimezone: true }),
    permission: jsonb("permission").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    refIdx: index("p5_permissions_ref_idx").on(table.ref),
  })
);

export const p5AuditEvents = pgTable(
  "p5_audit_events",
  {
    id: serial("id").primaryKey(),
    identityKey: varchar("identity_key", { length: 255 }).notNull().unique(),
    eventId: varchar("event_id", { length: 100 }).notNull(),
    decisionIdRef: varchar("decision_id_ref", { length: 100 }).notNull(),
    eventType: varchar("event_type", { length: 50 }).notNull(),
    eventAt: timestamp("event_at", { withTimezone: true }),
    actor: varchar("actor", { length: 100 }),
    previousState: varchar("previous_state", { length: 30 }),
    newState: varchar("new_state", { length: 30 }),
    reason: text("reason"),
    policyVersionRef: varchar("policy_version_ref", { length: 50 }),
    guardrailRef: varchar("guardrail_ref", { length: 100 }),
    approvalRef: varchar("approval_ref", { length: 100 }),
    event: jsonb("event").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    decisionRefIdx: index("p5_audit_events_decision_id_ref_idx").on(table.decisionIdRef),
    eventTypeIdx: index("p5_audit_events_type_idx").on(table.eventType),
  })
);

// ==================== RELATIONS ====================
export const narrativesRelations = relations(narratives, ({ many }) => ({
  coinNarratives: many(coinNarratives),
  narrativeHealth: many(narrativeHealth),
  morningSnapshotNarratives: many(morningSnapshotNarratives),
}));

export const coinsRelations = relations(coins, ({ many }) => ({
  coinNarratives: many(coinNarratives),
  marketPriceDaily: many(marketPriceDaily),
  coinMetrics: many(coinMetrics),
  features: many(features),
  healthScores: many(healthScores),
  recommendations: many(recommendations),
  watchlist: many(watchlists),
  indicators: many(indicators),
  morningSnapshotCoins: many(morningSnapshotCoins),
}));

export const coinNarrativesRelations = relations(coinNarratives, ({ one }) => ({
  coin: one(coins, {
    fields: [coinNarratives.coinId],
    references: [coins.id],
  }),
  narrative: one(narratives, {
    fields: [coinNarratives.narrativeId],
    references: [narratives.id],
  }),
}));

export const ruleVersionsRelations = relations(ruleVersions, ({ many }) => ({
  recommendationRules: many(recommendationRules),
  healthScores: many(healthScores),
  narrativeHealth: many(narrativeHealth),
  morningSnapshotHeaders: many(morningSnapshotHeaders),
}));

export const morningSnapshotHeadersRelations = relations(morningSnapshotHeaders, ({ many }) => ({
  coins: many(morningSnapshotCoins),
  narratives: many(morningSnapshotNarratives),
}));

export const eventRisksRelations = relations(eventRisks, ({ one }) => ({
  coin: one(coins, {
    fields: [eventRisks.coinId],
    references: [coins.id],
  }),
  narrative: one(narratives, {
    fields: [eventRisks.narrativeId],
    references: [narratives.id],
  }),
}));

export const coinCorrelationsRelations = relations(coinCorrelations, ({ one }) => ({
  coinA: one(coins, {
    fields: [coinCorrelations.coinIdA],
    references: [coins.id],
  }),
  coinB: one(coins, {
    fields: [coinCorrelations.coinIdB],
    references: [coins.id],
  }),
}));

export const narrativeMomentumRelations = relations(narrativeMomentum, ({ one }) => ({
  narrative: one(narratives, {
    fields: [narrativeMomentum.narrativeId],
    references: [narratives.id],
  }),
}));

export const decisionSignalsRelations = relations(decisionSignals, ({ one }) => ({
  coin: one(coins, {
    fields: [decisionSignals.coinId],
    references: [coins.id],
  }),
}));

export const alertHistoryRelations = relations(alertHistory, ({ one }) => ({
  rule: one(alertRules, {
    fields: [alertHistory.ruleId],
    references: [alertRules.id],
  }),
}));

// ==================== SQUARE PUBLICATIONS ====================
export const squareOpportunities = pgTable("square_opportunities", {
  id: serial("id").primaryKey(),
  type: varchar("type", { length: 30 }).notNull(), // COIN_SETUP, NARRATIVE_SETUP, WATCH
  subjectId: integer("subject_id"),
  narrativeId: integer("narrative_id").references(() => narratives.id, { onDelete: "set null" }),
  coinSymbol: varchar("coin_symbol", { length: 20 }),
  score: decimal("score", { precision: 5, scale: 2 }).notNull(),
  dataAsOf: date("data_as_of").notNull(),
  dataQuality: varchar("data_quality", { length: 10 }).notNull(), // HIGH, MEDIUM, LOW
  rationale: jsonb("rationale").notNull(),
  entryZone: jsonb("entry_zone"),
  takeProfits: jsonb("take_profits"),
  stopLoss: jsonb("stop_loss"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("CANDIDATE"), // CANDIDATE, QUALIFIED, SUPPRESSED, PUBLISHED, EXPIRED
  contentSnapshot: jsonb("content_snapshot"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  statusIdx: index("square_opportunities_status_idx").on(table.status),
  typeIdx: index("square_opportunities_type_idx").on(table.type),
  subjectIdx: index("square_opportunities_subject_idx").on(table.subjectId, table.narrativeId),
  createdIdx: index("square_opportunities_created_idx").on(table.createdAt),
}));

export const squarePublications = pgTable("square_publications", {
  id: serial("id").primaryKey(),
  opportunityId: integer("opportunity_id").notNull().references(() => squareOpportunities.id, { onDelete: "restrict" }),
  fingerprint: varchar("fingerprint", { length: 200 }).notNull().unique(),
  provider: varchar("provider", { length: 50 }).notNull().default("BINANCE_SQUARE"),
  status: varchar("status", { length: 20 }).notNull(), // DRAFT, PUBLISHED, FAILED, SUPPRESSED
  publishedAt: timestamp("published_at", { withTimezone: true }),
  externalPostId: varchar("external_post_id", { length: 100 }),
  contentVersion: varchar("content_version", { length: 20 }).notNull(),
  templateVersion: varchar("template_version", { length: 20 }).notNull(),
  llmUsed: boolean("llm_used").notNull().default(false),
  retryCount: integer("retry_count").default(0),
  failureCategory: varchar("failure_category", { length: 30 }),
  errorCode: varchar("error_code", { length: 20 }),
  errorMessage: text("error_message"),
  contentSnapshot: jsonb("content_snapshot"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  statusIdx: index("square_publications_status_idx").on(table.status),
  opportunityIdx: index("square_publications_opportunity_idx").on(table.opportunityId),
  fingerprintIdx: index("square_publications_fingerprint_idx").on(table.fingerprint),
  publishedIdx: index("square_publications_published_idx").on(table.publishedAt),
  opportunityStatusIdx: index("square_publications_opportunity_status_idx").on(table.opportunityId, table.status),
}));

export const squareQuotaLog = pgTable("square_quota_log", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  postsPublished: integer("posts_published").notNull().default(0),
  uploadsUsed: integer("uploads_used").notNull().default(0),
  lastRefreshAt: timestamp("last_refresh_at", { withTimezone: true }),
  warningAtThreshold: boolean("warning_at_threshold").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const squareFingerprints = pgTable("square_fingerprints", {
  id: serial("id").primaryKey(),
  fingerprint: varchar("fingerprint", { length: 200 }).notNull().unique(),
  opportunityId: integer("opportunity_id").notNull().references(() => squareOpportunities.id, { onDelete: "restrict" }),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  fingerprintIdx: index("square_fingerprints_fingerprint_idx").on(table.fingerprint),
  expiresIdx: index("square_fingerprints_expires_idx").on(table.expiresAt),
}));

// ==================== SQUARE PIPELINE EXECUTIONS (SQ-AN-02) ====================
export const squarePipelineExecutions = pgTable("square_pipeline_executions", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  triggerType: varchar("trigger_type", { length: 30 }).notNull().default("SCHEDULED"), // SCHEDULED, MANUAL, RETRY
  evaluated: integer("evaluated").notNull().default(0),
  qualified: integer("qualified").notNull().default(0),
  published: integer("published").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  deduplicated: integer("deduplicated").notNull().default(0),
  quotaBlocked: integer("quota_blocked").notNull().default(0),
  retryPending: integer("retry_pending").notNull().default(0),
  contentGenerationFailed: integer("content_generation_failed").notNull().default(0),
  llmUsedCount: integer("llm_used_count").notNull().default(0),
  templateFallbackCount: integer("template_fallback_count").notNull().default(0),
  durationMs: integer("duration_ms"),
  quotaRemainingStart: integer("quota_remaining_start"),
  quotaRemainingEnd: integer("quota_remaining_end"),
  quotaWarning: boolean("quota_warning").default(false),
  errorSummary: jsonb("error_summary"), // { errors: string[], error_count: number }
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  startedIdx: index("square_pipeline_executions_started_idx").on(table.startedAt),
  triggerIdx: index("square_pipeline_executions_trigger_idx").on(table.triggerType),
}));

// Type exports
export type Narrative = typeof narratives.$inferSelect;
export type NewNarrative = typeof narratives.$inferInsert;
export type Coin = typeof coins.$inferSelect;
export type NewCoin = typeof coins.$inferInsert;
export type CoinNarrative = typeof coinNarratives.$inferSelect;
export type MarketPriceDaily = typeof marketPriceDaily.$inferSelect;
export type CoinMetrics = typeof coinMetrics.$inferSelect;
export type SourceStatus = typeof sourceStatus.$inferSelect;
export type Feature = typeof features.$inferSelect;
export type NewFeature = typeof features.$inferInsert;
export type HealthScore = typeof healthScores.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
export type NarrativeHealth = typeof narrativeHealth.$inferSelect;
export type MorningSnapshot = typeof morningSnapshots.$inferSelect;
export type ScoreConfig = typeof scoreConfigs.$inferSelect;
export type Watchlist = typeof watchlists.$inferSelect;
export type SchedulerLog = typeof schedulerLogs.$inferSelect;
export type Indicator = typeof indicators.$inferSelect;
export type NewIndicator = typeof indicators.$inferInsert;
export type RecommendationRule = typeof recommendationRules.$inferSelect;
export type NewRecommendationRule = typeof recommendationRules.$inferInsert;
export type MorningSnapshotHeader = typeof morningSnapshotHeaders.$inferSelect;
export type NewMorningSnapshotHeader = typeof morningSnapshotHeaders.$inferInsert;
export type MorningSnapshotCoin = typeof morningSnapshotCoins.$inferSelect;
export type NewMorningSnapshotCoin = typeof morningSnapshotCoins.$inferInsert;
export type MorningSnapshotNarrative = typeof morningSnapshotNarratives.$inferSelect;
export type NewMorningSnapshotNarrative = typeof morningSnapshotNarratives.$inferInsert;
export type EventRisk = typeof eventRisks.$inferSelect;
export type NewEventRisk = typeof eventRisks.$inferInsert;
export type CoinCorrelation = typeof coinCorrelations.$inferSelect;
export type NewCoinCorrelation = typeof coinCorrelations.$inferInsert;
export type NarrativeMomentum = typeof narrativeMomentum.$inferSelect;
export type NewNarrativeMomentum = typeof narrativeMomentum.$inferInsert;
export type NarrativeMembershipEvent = typeof narrativeMembershipEvents.$inferSelect;
export type NewNarrativeMembershipEvent = typeof narrativeMembershipEvents.$inferInsert;
export type NarrativeMembershipCoverage = typeof narrativeMembershipCoverage.$inferSelect;
export type NewNarrativeMembershipCoverage = typeof narrativeMembershipCoverage.$inferInsert;
export type NarrativeMembershipSnapshot = typeof narrativeMembershipSnapshots.$inferSelect;
export type NewNarrativeMembershipSnapshot = typeof narrativeMembershipSnapshots.$inferInsert;
export type NarrativeMembershipSnapshotMember = typeof narrativeMembershipSnapshotMembers.$inferSelect;
export type NewNarrativeMembershipSnapshotMember = typeof narrativeMembershipSnapshotMembers.$inferInsert;
export type DecisionSignal = typeof decisionSignals.$inferSelect;
export type NewDecisionSignal = typeof decisionSignals.$inferInsert;
export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
export type AlertHistory = typeof alertHistory.$inferSelect;
export type NewAlertHistory = typeof alertHistory.$inferInsert;
export type P3HistoricalCorrection = typeof p3HistoricalCorrections.$inferSelect;
export type NewP3HistoricalCorrection = typeof p3HistoricalCorrections.$inferInsert;
export type P5DecisionRecordRow = typeof p5DecisionRecords.$inferSelect;
export type NewP5DecisionRecordRow = typeof p5DecisionRecords.$inferInsert;
export type P5P4SnapshotRow = typeof p5P4Snapshots.$inferSelect;
export type NewP5P4SnapshotRow = typeof p5P4Snapshots.$inferInsert;
export type P5PolicyRow = typeof p5Policies.$inferSelect;
export type NewP5PolicyRow = typeof p5Policies.$inferInsert;
export type P5GuardrailRow = typeof p5Guardrails.$inferSelect;
export type NewP5GuardrailRow = typeof p5Guardrails.$inferInsert;
export type P5ApprovalRow = typeof p5Approvals.$inferSelect;
export type NewP5ApprovalRow = typeof p5Approvals.$inferInsert;
export type P5PermissionRow = typeof p5Permissions.$inferSelect;
export type NewP5PermissionRow = typeof p5Permissions.$inferInsert;
export type P5AuditEventRow = typeof p5AuditEvents.$inferSelect;
export type NewP5AuditEventRow = typeof p5AuditEvents.$inferInsert;

// ==================== P6 SOURCE REGISTRY ====================
// Frozen contract: P6-01C (commit 18fb0f0)
// Observation contract: P6-01B (commit ad5d7df)

export const p6SourceDefinitions = pgTable(
  "p6_source_definitions",
  {
    id: serial("id").primaryKey(),
    sourceId: varchar("source_id", { length: 50 }).notNull().unique(),
    provider: varchar("provider", { length: 100 }).notNull(),
    sourceType: varchar("source_type", { length: 30 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
    entityType: varchar("entity_type", { length: 30 }).notNull().default("COIN"),
    entityCoverageRequirement: varchar("entity_coverage_requirement", { length: 200 }).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    sourceTypeIdx: index("p6_source_def_type_idx").on(table.sourceType),
    statusIdx: index("p6_source_def_status_idx").on(table.status),
  })
);

export const p6SourceCapabilities = pgTable(
  "p6_source_capabilities",
  {
    id: serial("id").primaryKey(),
    sourceId: varchar("source_id", { length: 50 }).notNull().references(() => p6SourceDefinitions.sourceId),
    metric: varchar("metric", { length: 50 }).notNull(),
    timeframe: varchar("timeframe", { length: 30 }).notNull(),
    isSupported: boolean("is_supported").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    sourceMetricTimeframeUnique: unique("p6_source_cap_unique").on(
      table.sourceId,
      table.metric,
      table.timeframe
    ),
    metricIdx: index("p6_source_cap_metric_idx").on(table.metric),
    timeframeIdx: index("p6_source_cap_timeframe_idx").on(table.timeframe),
  })
);

export const p6RegistryConfigVersions = pgTable(
  "p6_registry_config_versions",
  {
    id: serial("id").primaryKey(),
    version: integer("version").notNull().unique(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  }
);

// P6 Source Registry type exports
export type P6SourceDefinition = typeof p6SourceDefinitions.$inferSelect;
export type NewP6SourceDefinition = typeof p6SourceDefinitions.$inferInsert;
export type P6SourceCapability = typeof p6SourceCapabilities.$inferSelect;
export type NewP6SourceCapability = typeof p6SourceCapabilities.$inferInsert;
export type P6RegistryConfigVersion = typeof p6RegistryConfigVersions.$inferSelect;
export type NewP6RegistryConfigVersion = typeof p6RegistryConfigVersions.$inferInsert;

// ==================== P6 FRESHNESS POLICIES ====================
// Frozen contract: P6-01C-C (commit 6179135)

export const p6FreshnessPolicies = pgTable(
  "p6_freshness_policies",
  {
    id: serial("id").primaryKey(),
    sourceId: varchar("source_id", { length: 50 }).notNull().references(() => p6SourceDefinitions.sourceId),
    metric: varchar("metric", { length: 50 }).notNull(),
    timeframe: varchar("timeframe", { length: 30 }).notNull(),
    expectedIntervalMs: bigint("expected_interval_ms", { mode: "number" }).notNull(),
    staleAfterMs: bigint("stale_after_ms", { mode: "number" }).notNull(),
    configVersion: integer("config_version").notNull().references(() => p6RegistryConfigVersions.version),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    policyIdentityUnique: unique("p6_freshness_policy_unique").on(
      table.sourceId,
      table.metric,
      table.timeframe,
      table.configVersion
    ),
    configVersionIdx: index("p6_freshness_policy_cv_idx").on(table.configVersion),
  })
);

// P6 Freshness Policy type exports
export type P6FreshnessPolicy = typeof p6FreshnessPolicies.$inferSelect;
export type NewP6FreshnessPolicy = typeof p6FreshnessPolicies.$inferInsert;

// ==================== P6 DATA QUALITY — OBSERVATION QUALITY ====================
// Frozen contract: P6-01D-D1 (commit bfeac25)
// Partial unique indexes: KNOWN (observed_at IS NOT NULL) / UNKNOWN (observed_at IS NULL)

export const p6ObservationQuality = pgTable(
  "p6_observation_quality",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    entityId: integer("entity_id")
      .notNull()
      .references(() => coins.id, { onDelete: "cascade" }),
    metric: varchar("metric", { length: 50 }).notNull(),
    source: varchar("source", { length: 50 }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    timeframe: varchar("timeframe", { length: 30 }).notNull(),
    qualityStatus: varchar("quality_status", { length: 20 }).notNull(),
    observationStatus: varchar("observation_status", { length: 20 }).notNull(),
    qualityConfigVersion: varchar("quality_config_version", { length: 20 }).notNull(),
    evidence: jsonb("evidence").notNull().default([]),
    qualityEvaluatedAt: timestamp("quality_evaluated_at", { withTimezone: true }).notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (_table) => ({
    // Partial unique indexes enforced via raw SQL in migration
    // (Drizzle does not natively support WHERE clauses in unique indexes)
    entityIdIdx: index("p6_oq_entity_idx").on(_table.entityId),
    qualityStatusIdx: index("p6_oq_status_idx").on(_table.qualityStatus),
    configVersionIdx: index("p6_oq_config_idx").on(_table.qualityConfigVersion),
    evaluatedAtIdx: index("p6_oq_evaluated_idx").on(_table.qualityEvaluatedAt),
    approxJoinIdx: index("p6_oq_approx_join_idx").on(_table.entityId, _table.source, _table.timeframe, _table.observedAt),
  })
);

// ==================== P6 DATA QUALITY — RULE CONFIGURATION ====================
// Frozen contract: P6-01D-D1 §12.3

export const p6QualityRuleConfig = pgTable(
  "p6_quality_rule_config",
  {
    id: serial("id").primaryKey(),
    qualityConfigVersion: varchar("quality_config_version", { length: 20 }).notNull(),
    checkId: varchar("check_id", { length: 100 }).notNull(),
    metric: varchar("metric", { length: 50 }),
    checkType: varchar("check_type", { length: 30 }).notNull(),
    parameters: jsonb("parameters").notNull().default({}),
    isEnabled: boolean("is_enabled").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    ruleConfigUnique: unique("p6_quality_rule_config_unique").on(
      table.qualityConfigVersion,
      table.checkId,
      table.metric
    ),
    configVersionIdx: index("p6_qrc_config_idx").on(table.qualityConfigVersion),
  })
);

// P6 Data Quality type exports
export type P6ObservationQuality = typeof p6ObservationQuality.$inferSelect;
export type NewP6ObservationQuality = typeof p6ObservationQuality.$inferInsert;
export type P6QualityRuleConfig = typeof p6QualityRuleConfig.$inferSelect;
export type NewP6QualityRuleConfig = typeof p6QualityRuleConfig.$inferInsert;
