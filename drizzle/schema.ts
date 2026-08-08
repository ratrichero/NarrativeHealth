import { pgTable, serial, varchar, jsonb, integer, boolean, text, timestamp, index, foreignKey, unique, date, numeric, real, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const scoreConfigs = pgTable("score_configs", {
	id: serial().primaryKey().notNull(),
	configType: varchar("config_type", { length: 50 }).notNull(),
	configKey: varchar("config_key", { length: 100 }).notNull(),
	configValue: jsonb("config_value").notNull(),
	version: integer().default(1).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	description: text(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const schedulerLogs = pgTable("scheduler_logs", {
	id: serial().primaryKey().notNull(),
	jobName: varchar("job_name", { length: 100 }).notNull(),
	status: varchar({ length: 20 }).notNull(),
	startedAt: timestamp("started_at", { mode: 'string' }).notNull(),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	duration: integer(),
	recordsProcessed: integer("records_processed").default(0),
	errorMessage: text("error_message"),
	details: jsonb(),
});

export const coins = pgTable("coins", {
	id: serial().primaryKey().notNull(),
	symbol: varchar({ length: 20 }).notNull(),
	name: varchar({ length: 100 }).notNull(),
	binanceSpotSymbol: varchar("binance_spot_symbol", { length: 30 }),
	binanceFuturesSymbol: varchar("binance_futures_symbol", { length: 30 }),
	coingeckoId: varchar("coingecko_id", { length: 100 }),
	hasFutures: boolean("has_futures").default(false).notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const narratives = pgTable("narratives", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	description: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow().notNull(),
});

export const recommendationRules = pgTable("recommendation_rules", {
	id: serial().primaryKey().notNull(),
	ruleVersionId: integer("rule_version_id").notNull(),
	priority: integer().default(50).notNull(),
	signal: varchar({ length: 20 }).notNull(),
	logicOperator: varchar("logic_operator", { length: 5 }).default('AND').notNull(),
	conditions: jsonb().notNull(),
	reasonTemplate: text("reason_template").notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("rec_rules_priority_idx").using("btree", table.priority.asc().nullsLast().op("int4_ops")),
	index("rec_rules_version_active_idx").using("btree", table.ruleVersionId.asc().nullsLast().op("int4_ops"), table.isActive.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.ruleVersionId],
			foreignColumns: [ruleVersions.id],
			name: "recommendation_rules_rule_version_id_rule_versions_id_fk"
		}),
]);

export const narrativeMomentum = pgTable("narrative_momentum", {
	id: serial().primaryKey().notNull(),
	narrativeId: integer("narrative_id").notNull(),
	date: date().notNull(),
	momentumScore: numeric("momentum_score", { precision: 5, scale:  2 }),
	momentumType: varchar("momentum_type", { length: 20 }),
	health7DAgo: numeric("health_7d_ago", { precision: 5, scale:  2 }),
	healthNow: numeric("health_now", { precision: 5, scale:  2 }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("narrative_momentum_narrative_idx").using("btree", table.narrativeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.narrativeId],
			foreignColumns: [narratives.id],
			name: "narrative_momentum_narrative_id_narratives_id_fk"
		}),
	unique("narrative_momentum_unique").on(table.narrativeId, table.date),
]);

export const eventRisks = pgTable("event_risks", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id"),
	narrativeId: integer("narrative_id"),
	eventType: varchar("event_type", { length: 30 }).notNull(),
	eventDate: date("event_date").notNull(),
	riskLevel: varchar("risk_level", { length: 10 }).notNull(),
	riskScore: numeric("risk_score", { precision: 5, scale:  2 }),
	title: varchar({ length: 200 }).notNull(),
	description: text(),
	sourceUrl: text("source_url"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	expiresAt: date("expires_at"),
}, (table) => [
	index("event_risks_coin_idx").using("btree", table.coinId.asc().nullsLast().op("int4_ops")),
	index("event_risks_date_idx").using("btree", table.eventDate.asc().nullsLast().op("date_ops")),
	index("event_risks_narrative_idx").using("btree", table.narrativeId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "event_risks_coin_id_coins_id_fk"
		}),
	foreignKey({
			columns: [table.narrativeId],
			foreignColumns: [narratives.id],
			name: "event_risks_narrative_id_narratives_id_fk"
		}),
]);

export const coinMetrics = pgTable("coin_metrics", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id").notNull(),
	date: date().notNull(),
	openInterest: numeric("open_interest", { precision: 24, scale:  2 }),
	fundingRate: numeric("funding_rate", { precision: 18, scale:  8 }),
	marketCap: numeric("market_cap", { precision: 24, scale:  2 }),
	fullyDilutedValuation: numeric("fully_diluted_valuation", { precision: 24, scale:  2 }),
	circulatingSupply: numeric("circulating_supply", { precision: 24, scale:  2 }),
	totalSupply: numeric("total_supply", { precision: 24, scale:  2 }),
	source: varchar({ length: 50 }).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("coin_metrics_idx").using("btree", table.coinId.asc().nullsLast().op("text_ops"), table.date.asc().nullsLast().op("text_ops"), table.source.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "coin_metrics_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	unique("coin_metrics_unique").on(table.coinId, table.date, table.source),
]);

export const marketPriceDaily = pgTable("market_price_daily", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id").notNull(),
	date: date().notNull(),
	open: numeric({ precision: 24, scale:  8 }).notNull(),
	high: numeric({ precision: 24, scale:  8 }).notNull(),
	low: numeric({ precision: 24, scale:  8 }).notNull(),
	close: numeric({ precision: 24, scale:  8 }).notNull(),
	volume: numeric({ precision: 24, scale:  2 }).notNull(),
	quoteVolume: numeric("quote_volume", { precision: 24, scale:  2 }),
	source: varchar({ length: 50 }).default('binance').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	volume24H: numeric("volume_24h", { precision: 24, scale:  2 }),
}, (table) => [
	index("market_price_coin_date_idx").using("btree", table.coinId.asc().nullsLast().op("int4_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "market_price_daily_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	unique("market_price_unique").on(table.coinId, table.date),
]);

export const sourceStatus = pgTable("source_status", {
	id: serial().primaryKey().notNull(),
	source: varchar({ length: 50 }).notNull(),
	coinId: integer("coin_id"),
	status: varchar({ length: 20 }).notNull(),
	lastSuccess: timestamp("last_success", { mode: 'string' }),
	lastAttempt: timestamp("last_attempt", { mode: 'string' }).notNull(),
	errorMessage: text("error_message"),
	recordsCollected: integer("records_collected").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("source_status_idx").using("btree", table.source.asc().nullsLast().op("int4_ops"), table.coinId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "source_status_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	unique("source_status_unique").on(table.source, table.coinId),
]);

export const features = pgTable("features", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id").notNull(),
	date: date().notNull(),
	versionId: integer("version_id").notNull(),
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
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	sourceProvenance: jsonb("source_provenance"),
	calculatedAt: timestamp("calculated_at", { mode: 'string' }),
}, (table) => [
	index("features_coin_date_idx").using("btree", table.coinId.asc().nullsLast().op("int4_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "features_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.versionId],
			foreignColumns: [featureVersions.id],
			name: "features_version_id_feature_versions_id_fk"
		}),
	unique("features_unique").on(table.coinId, table.date, table.versionId),
]);

export const narrativeHealth = pgTable("narrative_health", {
	id: serial().primaryKey().notNull(),
	narrativeId: integer("narrative_id").notNull(),
	date: date().notNull(),
	healthScore: real("health_score").notNull(),
	previousScore: real("previous_score"),
	scoreChange: real("score_change"),
	status: varchar({ length: 20 }).notNull(),
	coinCount: integer("coin_count").notNull(),
	topCoinId: integer("top_coin_id"),
	weakestCoinId: integer("weakest_coin_id"),
	avgConfidence: real("avg_confidence"),
	coinBreakdown: jsonb("coin_breakdown"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	ruleVersionId: integer("rule_version_id"),
	weightingMethod: varchar("weighting_method", { length: 20 }).default('equal').notNull(),
	weightDetails: jsonb("weight_details"),
}, (table) => [
	index("narrative_health_idx").using("btree", table.narrativeId.asc().nullsLast().op("int4_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.narrativeId],
			foreignColumns: [narratives.id],
			name: "narrative_health_narrative_id_narratives_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.topCoinId],
			foreignColumns: [coins.id],
			name: "narrative_health_top_coin_id_coins_id_fk"
		}),
	foreignKey({
			columns: [table.weakestCoinId],
			foreignColumns: [coins.id],
			name: "narrative_health_weakest_coin_id_coins_id_fk"
		}),
	foreignKey({
			columns: [table.ruleVersionId],
			foreignColumns: [ruleVersions.id],
			name: "narrative_health_rule_version_id_rule_versions_id_fk"
		}),
	unique("narrative_health_unique").on(table.narrativeId, table.date),
]);

export const featureVersions = pgTable("feature_versions", {
	id: serial().primaryKey().notNull(),
	version: integer().notNull(),
	description: text(),
	algorithm: jsonb(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
});

export const healthScores = pgTable("health_scores", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id").notNull(),
	date: date().notNull(),
	healthScore: real("health_score").notNull(),
	previousScore: real("previous_score"),
	scoreChange: real("score_change"),
	status: varchar({ length: 20 }).notNull(),
	confidenceScore: real("confidence_score"),
	weightBreakdown: jsonb("weight_breakdown"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	ruleVersionId: integer("rule_version_id"),
}, (table) => [
	index("health_scores_idx").using("btree", table.coinId.asc().nullsLast().op("int4_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "health_scores_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.ruleVersionId],
			foreignColumns: [ruleVersions.id],
			name: "health_scores_rule_version_id_rule_versions_id_fk"
		}),
	unique("health_scores_unique").on(table.coinId, table.date),
]);

export const ruleVersions = pgTable("rule_versions", {
	id: serial().primaryKey().notNull(),
	version: integer().notNull(),
	description: text(),
	healthWeights: jsonb("health_weights").notNull(),
	confidenceWeights: jsonb("confidence_weights").notNull(),
	recommendationThresholds: jsonb("recommendation_thresholds").notNull(),
	isActive: boolean("is_active").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	activatedAt: timestamp("activated_at", { mode: 'string' }),
}, (table) => [
	unique("rule_versions_version_unique").on(table.version),
]);

export const alertRules = pgTable("alert_rules", {
	id: serial().primaryKey().notNull(),
	name: varchar({ length: 100 }).notNull(),
	scope: varchar({ length: 10 }).notNull(),
	scopeId: integer("scope_id"),
	triggerType: varchar("trigger_type", { length: 30 }).notNull(),
	triggerValue: numeric("trigger_value", { precision: 10, scale:  2 }),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("alert_rules_scope_idx").using("btree", table.scope.asc().nullsLast().op("int4_ops"), table.scopeId.asc().nullsLast().op("int4_ops")),
]);

export const coinCorrelations = pgTable("coin_correlations", {
	id: serial().primaryKey().notNull(),
	date: date().notNull(),
	coinIdA: integer("coin_id_a").notNull(),
	coinIdB: integer("coin_id_b").notNull(),
	correlation: numeric({ precision: 5, scale:  4 }),
	periodDays: integer("period_days").default(30),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("coin_correlations_coins_idx").using("btree", table.coinIdA.asc().nullsLast().op("int4_ops"), table.coinIdB.asc().nullsLast().op("int4_ops")),
	index("coin_correlations_date_idx").using("btree", table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.coinIdA],
			foreignColumns: [coins.id],
			name: "coin_correlations_coin_id_a_coins_id_fk"
		}),
	foreignKey({
			columns: [table.coinIdB],
			foreignColumns: [coins.id],
			name: "coin_correlations_coin_id_b_coins_id_fk"
		}),
	unique("coin_correlations_unique").on(table.date, table.coinIdA, table.coinIdB, table.periodDays),
]);

export const recommendations = pgTable("recommendations", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id").notNull(),
	date: date().notNull(),
	signal: varchar({ length: 30 }).notNull(),
	reason: text().notNull(),
	reasonBreakdown: jsonb("reason_breakdown"),
	healthScoreId: integer("health_score_id"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
	ruleVersionId: integer("rule_version_id"),
}, (table) => [
	index("recommendations_idx").using("btree", table.coinId.asc().nullsLast().op("int4_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "recommendations_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.healthScoreId],
			foreignColumns: [healthScores.id],
			name: "recommendations_health_score_id_health_scores_id_fk"
		}),
	foreignKey({
			columns: [table.ruleVersionId],
			foreignColumns: [ruleVersions.id],
			name: "recommendations_rule_version_id_rule_versions_id_fk"
		}),
	unique("recommendations_unique").on(table.coinId, table.date),
]);

export const watchlists = pgTable("watchlists", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id").notNull(),
	note: text(),
	priority: integer().default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "watchlists_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	unique("watchlist_unique").on(table.coinId),
]);

export const morningSnapshotHeaders = pgTable("morning_snapshot_headers", {
	id: serial().primaryKey().notNull(),
	date: date().notNull(),
	totalCoins: integer("total_coins"),
	avgHealthScore: numeric("avg_health_score", { precision: 5, scale:  2 }),
	topNarrativeId: integer("top_narrative_id"),
	alertCount: integer("alert_count").default(0),
	ruleVersionId: integer("rule_version_id"),
	timezone: varchar({ length: 50 }).default('Asia/Ho_Chi_Minh'),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.topNarrativeId],
			foreignColumns: [narratives.id],
			name: "morning_snapshot_headers_top_narrative_id_narratives_id_fk"
		}),
	foreignKey({
			columns: [table.ruleVersionId],
			foreignColumns: [ruleVersions.id],
			name: "morning_snapshot_headers_rule_version_id_rule_versions_id_fk"
		}),
	unique("morning_snapshot_headers_date_unique").on(table.date),
]);

export const morningSnapshots = pgTable("morning_snapshots", {
	id: serial().primaryKey().notNull(),
	date: date().notNull(),
	snapshotData: jsonb("snapshot_data").notNull(),
	narrativeCount: integer("narrative_count").notNull(),
	coinCount: integer("coin_count").notNull(),
	avgHealthScore: real("avg_health_score"),
	topNarrativeId: integer("top_narrative_id"),
	alertCount: integer("alert_count").default(0),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.topNarrativeId],
			foreignColumns: [narratives.id],
			name: "morning_snapshots_top_narrative_id_narratives_id_fk"
		}),
	unique("morning_snapshots_date_unique").on(table.date),
]);

export const indicators = pgTable("indicators", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id").notNull(),
	date: date().notNull(),
	timeframe: varchar({ length: 10 }).notNull(),
	indicatorType: varchar("indicator_type", { length: 50 }).notNull(),
	indicatorValue: numeric("indicator_value", { precision: 20, scale:  8 }),
	indicatorMeta: jsonb("indicator_meta"),
	source: varchar({ length: 30 }),
	calculatedAt: timestamp("calculated_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("indicators_coin_date_type_idx").using("btree", table.coinId.asc().nullsLast().op("text_ops"), table.date.asc().nullsLast().op("int4_ops"), table.indicatorType.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "indicators_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	unique("indicators_unique").on(table.coinId, table.date, table.timeframe, table.indicatorType),
]);

export const morningSnapshotCoins = pgTable("morning_snapshot_coins", {
	id: serial().primaryKey().notNull(),
	snapshotId: integer("snapshot_id").notNull(),
	coinId: integer("coin_id").notNull(),
	healthScore: numeric("health_score", { precision: 5, scale:  2 }),
	scoreChange: numeric("score_change", { precision: 5, scale:  2 }),
	signal: varchar({ length: 20 }),
	confidence: numeric({ precision: 5, scale:  2 }),
}, (table) => [
	index("snapshot_coins_snapshot_idx").using("btree", table.snapshotId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "morning_snapshot_coins_coin_id_coins_id_fk"
		}),
	foreignKey({
			columns: [table.snapshotId],
			foreignColumns: [morningSnapshotHeaders.id],
			name: "morning_snapshot_coins_snapshot_id_morning_snapshot_headers_id_"
		}).onDelete("cascade"),
	unique("snapshot_coin_unique").on(table.snapshotId, table.coinId),
]);

export const morningSnapshotNarratives = pgTable("morning_snapshot_narratives", {
	id: serial().primaryKey().notNull(),
	snapshotId: integer("snapshot_id").notNull(),
	narrativeId: integer("narrative_id").notNull(),
	healthScore: numeric("health_score", { precision: 5, scale:  2 }),
	scoreChange: numeric("score_change", { precision: 5, scale:  2 }),
	coinCount: integer("coin_count"),
	topCoinId: integer("top_coin_id"),
	weakestCoinId: integer("weakest_coin_id"),
	weightingMethod: varchar("weighting_method", { length: 20 }),
}, (table) => [
	index("snapshot_narratives_snapshot_idx").using("btree", table.snapshotId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.narrativeId],
			foreignColumns: [narratives.id],
			name: "morning_snapshot_narratives_narrative_id_narratives_id_fk"
		}),
	foreignKey({
			columns: [table.topCoinId],
			foreignColumns: [coins.id],
			name: "morning_snapshot_narratives_top_coin_id_coins_id_fk"
		}),
	foreignKey({
			columns: [table.weakestCoinId],
			foreignColumns: [coins.id],
			name: "morning_snapshot_narratives_weakest_coin_id_coins_id_fk"
		}),
	foreignKey({
			columns: [table.snapshotId],
			foreignColumns: [morningSnapshotHeaders.id],
			name: "morning_snapshot_narratives_snapshot_id_morning_snapshot_header"
		}).onDelete("cascade"),
	unique("snapshot_narrative_unique").on(table.snapshotId, table.narrativeId),
]);

export const alertHistory = pgTable("alert_history", {
	id: serial().primaryKey().notNull(),
	ruleId: integer("rule_id").notNull(),
	triggeredAt: timestamp("triggered_at", { mode: 'string' }).defaultNow().notNull(),
	triggerDetail: jsonb("trigger_detail"),
	acknowledgedAt: timestamp("acknowledged_at", { mode: 'string' }),
	acknowledgedBy: varchar("acknowledged_by", { length: 100 }),
}, (table) => [
	index("alert_history_rule_idx").using("btree", table.ruleId.asc().nullsLast().op("int4_ops")),
	index("alert_history_triggered_idx").using("btree", table.triggeredAt.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.ruleId],
			foreignColumns: [alertRules.id],
			name: "alert_history_rule_id_alert_rules_id_fk"
		}),
]);

export const decisionSignals = pgTable("decision_signals", {
	id: serial().primaryKey().notNull(),
	coinId: integer("coin_id").notNull(),
	date: date().notNull(),
	baseHealth: numeric("base_health", { precision: 5, scale:  2 }),
	eventRiskScore: numeric("event_risk_score", { precision: 5, scale:  2 }),
	adjustedScore: numeric("adjusted_score", { precision: 5, scale:  2 }),
	adjustmentReason: text("adjustment_reason"),
	activeEvents: jsonb("active_events"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("decision_signals_coin_date_idx").using("btree", table.coinId.asc().nullsLast().op("int4_ops"), table.date.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "decision_signals_coin_id_coins_id_fk"
		}),
	unique("decision_signals_unique").on(table.coinId, table.date),
]);

export const coinNarratives = pgTable("coin_narratives", {
	coinId: integer("coin_id").notNull(),
	narrativeId: integer("narrative_id").notNull(),
	isPrimary: boolean("is_primary").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.coinId],
			foreignColumns: [coins.id],
			name: "coin_narratives_coin_id_coins_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.narrativeId],
			foreignColumns: [narratives.id],
			name: "coin_narratives_narrative_id_narratives_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.coinId, table.narrativeId], name: "coin_narratives_coin_id_narrative_id_pk"}),
]);
