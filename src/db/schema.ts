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
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    narrativeDateIdx: index("narrative_health_idx").on(table.narrativeId, table.date),
    uniqueNarrativeHealth: unique("narrative_health_unique").on(table.narrativeId, table.date),
  })
);

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

// ==================== RELATIONS ====================
export const narrativesRelations = relations(narratives, ({ many }) => ({
  coinNarratives: many(coinNarratives),
  narrativeHealth: many(narrativeHealth),
}));

export const coinsRelations = relations(coins, ({ many }) => ({
  coinNarratives: many(coinNarratives),
  marketPriceDaily: many(marketPriceDaily),
  coinMetrics: many(coinMetrics),
  features: many(features),
  healthScores: many(healthScores),
  recommendations: many(recommendations),
  watchlist: many(watchlists),
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
export type HealthScore = typeof healthScores.$inferSelect;
export type Recommendation = typeof recommendations.$inferSelect;
export type NarrativeHealth = typeof narrativeHealth.$inferSelect;
export type MorningSnapshot = typeof morningSnapshots.$inferSelect;
export type ScoreConfig = typeof scoreConfigs.$inferSelect;
export type Watchlist = typeof watchlists.$inferSelect;
export type SchedulerLog = typeof schedulerLogs.$inferSelect;
