import {
  pgTable,
  serial,
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
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
  concentrationTop1: decimal("concentration_top1", { precision: 9, scale: 6 }),
  concentrationTop3: decimal("concentration_top3", { precision: 9, scale: 6 }),
  regime: varchar("regime", { length: 30 }),
  rotation: varchar("rotation", { length: 30 }),
  explanation: jsonb("explanation"),
  provenance: jsonb("provenance").notNull(),
  calculatedAt: timestamp("calculated_at").notNull(),
  persistedAt: timestamp("persisted_at").defaultNow().notNull(),
}, (table) => ({
  identityUnique: unique("p3_narrative_intelligence_identity_unique").on(table.narrativeId, table.windowEnd, table.algorithmKey, table.algorithmVersion, table.calculationMode),
  narrativeWindowIdx: index("p3_narrative_intelligence_narrative_window_idx").on(table.narrativeId, table.windowEnd),
  algorithmIdx: index("p3_narrative_intelligence_algorithm_idx").on(table.algorithmKey, table.algorithmVersion),
  windowIdx: index("p3_narrative_intelligence_window_idx").on(table.windowEnd),
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
export type DecisionSignal = typeof decisionSignals.$inferSelect;
export type NewDecisionSignal = typeof decisionSignals.$inferInsert;
export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
export type AlertHistory = typeof alertHistory.$inferSelect;
export type NewAlertHistory = typeof alertHistory.$inferInsert;
