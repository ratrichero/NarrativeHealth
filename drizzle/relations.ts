import { relations } from "drizzle-orm/relations";
import { ruleVersions, recommendationRules, narratives, narrativeMomentum, coins, eventRisks, coinMetrics, marketPriceDaily, sourceStatus, features, featureVersions, narrativeHealth, healthScores, coinCorrelations, recommendations, watchlists, morningSnapshotHeaders, morningSnapshots, indicators, morningSnapshotCoins, morningSnapshotNarratives, alertRules, alertHistory, decisionSignals, coinNarratives } from "./schema";

export const recommendationRulesRelations = relations(recommendationRules, ({one}) => ({
	ruleVersion: one(ruleVersions, {
		fields: [recommendationRules.ruleVersionId],
		references: [ruleVersions.id]
	}),
}));

export const ruleVersionsRelations = relations(ruleVersions, ({many}) => ({
	recommendationRules: many(recommendationRules),
	narrativeHealths: many(narrativeHealth),
	healthScores: many(healthScores),
	recommendations: many(recommendations),
	morningSnapshotHeaders: many(morningSnapshotHeaders),
}));

export const narrativeMomentumRelations = relations(narrativeMomentum, ({one}) => ({
	narrative: one(narratives, {
		fields: [narrativeMomentum.narrativeId],
		references: [narratives.id]
	}),
}));

export const narrativesRelations = relations(narratives, ({many}) => ({
	narrativeMomentums: many(narrativeMomentum),
	eventRisks: many(eventRisks),
	narrativeHealths: many(narrativeHealth),
	morningSnapshotHeaders: many(morningSnapshotHeaders),
	morningSnapshots: many(morningSnapshots),
	morningSnapshotNarratives: many(morningSnapshotNarratives),
	coinNarratives: many(coinNarratives),
}));

export const eventRisksRelations = relations(eventRisks, ({one}) => ({
	coin: one(coins, {
		fields: [eventRisks.coinId],
		references: [coins.id]
	}),
	narrative: one(narratives, {
		fields: [eventRisks.narrativeId],
		references: [narratives.id]
	}),
}));

export const coinsRelations = relations(coins, ({many}) => ({
	eventRisks: many(eventRisks),
	coinMetrics: many(coinMetrics),
	marketPriceDailies: many(marketPriceDaily),
	sourceStatuses: many(sourceStatus),
	features: many(features),
	narrativeHealths_topCoinId: many(narrativeHealth, {
		relationName: "narrativeHealth_topCoinId_coins_id"
	}),
	narrativeHealths_weakestCoinId: many(narrativeHealth, {
		relationName: "narrativeHealth_weakestCoinId_coins_id"
	}),
	healthScores: many(healthScores),
	coinCorrelations_coinIdA: many(coinCorrelations, {
		relationName: "coinCorrelations_coinIdA_coins_id"
	}),
	coinCorrelations_coinIdB: many(coinCorrelations, {
		relationName: "coinCorrelations_coinIdB_coins_id"
	}),
	recommendations: many(recommendations),
	watchlists: many(watchlists),
	indicators: many(indicators),
	morningSnapshotCoins: many(morningSnapshotCoins),
	morningSnapshotNarratives_topCoinId: many(morningSnapshotNarratives, {
		relationName: "morningSnapshotNarratives_topCoinId_coins_id"
	}),
	morningSnapshotNarratives_weakestCoinId: many(morningSnapshotNarratives, {
		relationName: "morningSnapshotNarratives_weakestCoinId_coins_id"
	}),
	decisionSignals: many(decisionSignals),
	coinNarratives: many(coinNarratives),
}));

export const coinMetricsRelations = relations(coinMetrics, ({one}) => ({
	coin: one(coins, {
		fields: [coinMetrics.coinId],
		references: [coins.id]
	}),
}));

export const marketPriceDailyRelations = relations(marketPriceDaily, ({one}) => ({
	coin: one(coins, {
		fields: [marketPriceDaily.coinId],
		references: [coins.id]
	}),
}));

export const sourceStatusRelations = relations(sourceStatus, ({one}) => ({
	coin: one(coins, {
		fields: [sourceStatus.coinId],
		references: [coins.id]
	}),
}));

export const featuresRelations = relations(features, ({one}) => ({
	coin: one(coins, {
		fields: [features.coinId],
		references: [coins.id]
	}),
	featureVersion: one(featureVersions, {
		fields: [features.versionId],
		references: [featureVersions.id]
	}),
}));

export const featureVersionsRelations = relations(featureVersions, ({many}) => ({
	features: many(features),
}));

export const narrativeHealthRelations = relations(narrativeHealth, ({one}) => ({
	narrative: one(narratives, {
		fields: [narrativeHealth.narrativeId],
		references: [narratives.id]
	}),
	coin_topCoinId: one(coins, {
		fields: [narrativeHealth.topCoinId],
		references: [coins.id],
		relationName: "narrativeHealth_topCoinId_coins_id"
	}),
	coin_weakestCoinId: one(coins, {
		fields: [narrativeHealth.weakestCoinId],
		references: [coins.id],
		relationName: "narrativeHealth_weakestCoinId_coins_id"
	}),
	ruleVersion: one(ruleVersions, {
		fields: [narrativeHealth.ruleVersionId],
		references: [ruleVersions.id]
	}),
}));

export const healthScoresRelations = relations(healthScores, ({one, many}) => ({
	coin: one(coins, {
		fields: [healthScores.coinId],
		references: [coins.id]
	}),
	ruleVersion: one(ruleVersions, {
		fields: [healthScores.ruleVersionId],
		references: [ruleVersions.id]
	}),
	recommendations: many(recommendations),
}));

export const coinCorrelationsRelations = relations(coinCorrelations, ({one}) => ({
	coin_coinIdA: one(coins, {
		fields: [coinCorrelations.coinIdA],
		references: [coins.id],
		relationName: "coinCorrelations_coinIdA_coins_id"
	}),
	coin_coinIdB: one(coins, {
		fields: [coinCorrelations.coinIdB],
		references: [coins.id],
		relationName: "coinCorrelations_coinIdB_coins_id"
	}),
}));

export const recommendationsRelations = relations(recommendations, ({one}) => ({
	coin: one(coins, {
		fields: [recommendations.coinId],
		references: [coins.id]
	}),
	healthScore: one(healthScores, {
		fields: [recommendations.healthScoreId],
		references: [healthScores.id]
	}),
	ruleVersion: one(ruleVersions, {
		fields: [recommendations.ruleVersionId],
		references: [ruleVersions.id]
	}),
}));

export const watchlistsRelations = relations(watchlists, ({one}) => ({
	coin: one(coins, {
		fields: [watchlists.coinId],
		references: [coins.id]
	}),
}));

export const morningSnapshotHeadersRelations = relations(morningSnapshotHeaders, ({one, many}) => ({
	narrative: one(narratives, {
		fields: [morningSnapshotHeaders.topNarrativeId],
		references: [narratives.id]
	}),
	ruleVersion: one(ruleVersions, {
		fields: [morningSnapshotHeaders.ruleVersionId],
		references: [ruleVersions.id]
	}),
	morningSnapshotCoins: many(morningSnapshotCoins),
	morningSnapshotNarratives: many(morningSnapshotNarratives),
}));

export const morningSnapshotsRelations = relations(morningSnapshots, ({one}) => ({
	narrative: one(narratives, {
		fields: [morningSnapshots.topNarrativeId],
		references: [narratives.id]
	}),
}));

export const indicatorsRelations = relations(indicators, ({one}) => ({
	coin: one(coins, {
		fields: [indicators.coinId],
		references: [coins.id]
	}),
}));

export const morningSnapshotCoinsRelations = relations(morningSnapshotCoins, ({one}) => ({
	coin: one(coins, {
		fields: [morningSnapshotCoins.coinId],
		references: [coins.id]
	}),
	morningSnapshotHeader: one(morningSnapshotHeaders, {
		fields: [morningSnapshotCoins.snapshotId],
		references: [morningSnapshotHeaders.id]
	}),
}));

export const morningSnapshotNarrativesRelations = relations(morningSnapshotNarratives, ({one}) => ({
	narrative: one(narratives, {
		fields: [morningSnapshotNarratives.narrativeId],
		references: [narratives.id]
	}),
	coin_topCoinId: one(coins, {
		fields: [morningSnapshotNarratives.topCoinId],
		references: [coins.id],
		relationName: "morningSnapshotNarratives_topCoinId_coins_id"
	}),
	coin_weakestCoinId: one(coins, {
		fields: [morningSnapshotNarratives.weakestCoinId],
		references: [coins.id],
		relationName: "morningSnapshotNarratives_weakestCoinId_coins_id"
	}),
	morningSnapshotHeader: one(morningSnapshotHeaders, {
		fields: [morningSnapshotNarratives.snapshotId],
		references: [morningSnapshotHeaders.id]
	}),
}));

export const alertHistoryRelations = relations(alertHistory, ({one}) => ({
	alertRule: one(alertRules, {
		fields: [alertHistory.ruleId],
		references: [alertRules.id]
	}),
}));

export const alertRulesRelations = relations(alertRules, ({many}) => ({
	alertHistories: many(alertHistory),
}));

export const decisionSignalsRelations = relations(decisionSignals, ({one}) => ({
	coin: one(coins, {
		fields: [decisionSignals.coinId],
		references: [coins.id]
	}),
}));

export const coinNarrativesRelations = relations(coinNarratives, ({one}) => ({
	coin: one(coins, {
		fields: [coinNarratives.coinId],
		references: [coins.id]
	}),
	narrative: one(narratives, {
		fields: [coinNarratives.narrativeId],
		references: [narratives.id]
	}),
}));