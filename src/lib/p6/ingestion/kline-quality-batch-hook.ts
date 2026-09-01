// P6-01E-C Batch Quality Hook — Bulk Kline Observation + Quality Evaluation
// Authority: P6-PERF-01 (Performance Optimization)
//
// Batch equivalent of evaluateKlineObservationQuality.
// Evaluates all klines in-memory (pure validation), then persists all
// quality records in a single bulk DB operation.
//
// Semantic equivalence with per-kline evaluation:
//   - Same validators (validateMetric, validateOHLCGroup) — pure functions
//   - Same quality_status, evidence, observation_status
//   - Same identity: (entity_id, metric, source, observed_at, timeframe)
//   - Same persistence semantics (latest-only upsert)
//   - Same error semantics: throws on infrastructure errors, never on validation
//
// Performance improvement:
//   - Per-kline: N klines × 6 DB operations = 6N DB round-trips
//   - Batch: ~3 DB round-trips total (1 SELECT + 1 INSERT + ~1 UPDATE)
//   - For 200 klines: ~1,200 queries → ~3 queries

import type { Timeframe } from "../quality/types";
import {
  evaluateAndPersistQuality,
  evaluateAndPersistOHLCQuality,
} from "../quality/evaluation-service";
import type { EvaluationResult, OHLCEvaluationResult } from "../quality/evaluation-service";
import type { ObservationQualityInsert } from "../quality-persistence/types";
import { batchUpsertQualityResults } from "../quality-persistence/batch-service";
import type { KlineLike, KlineQualityContext } from "./kline-quality-hook";
import { toCanonicalSource } from "./kline-quality-hook";
import { validateMetric, validateOHLCGroup } from "../quality/validator";
import { QUALITY_CONFIG_VERSION } from "../quality/types";

export interface KlineQualityBatchResult {
  /** Per-kline evaluation results (validation only, no persisted records) */
  evaluations: KlineEvaluationSummary[];
  /** All persisted quality records */
  persistedCount: number;
}

export interface KlineEvaluationSummary {
  klineIndex: number;
  ohlc: OHLCEvaluationResult;
  volume: EvaluationResult;
  quoteVolume: EvaluationResult;
}

/**
 * Evaluate + persist quality for MULTIPLE klines in a single batch.
 *
 * This is the batch equivalent of evaluateKlineObservationQuality.
 * For each kline, it runs the same pure validators, but persists all
 * results in a single bulk DB operation.
 *
 * THROWS on infrastructure/persistence errors (same as per-kline version).
 * A VALID/INVALID/MISSING/UNKNOWN result never throws.
 *
 * @param klines - Array of klines to evaluate (all for the same coin)
 * @param ctx - Quality context (entityId, priceSource, timeframe) — same for all klines
 */
export async function evaluateKlineObservationQualityBatch(
  klines: KlineLike[],
  ctx: KlineQualityContext
): Promise<KlineQualityBatchResult> {
  if (klines.length === 0) {
    return { evaluations: [], persistedCount: 0 };
  }

  const source = toCanonicalSource(ctx.priceSource);
  const evaluatedAt = new Date();
  const OHLC_METRICS = ["OPEN", "HIGH", "LOW", "CLOSE"] as const;

  // Phase 1: In-memory validation (pure, no I/O)
  const inserts: ObservationQualityInsert[] = [];
  const evaluations: KlineEvaluationSummary[] = [];

  for (let i = 0; i < klines.length; i++) {
    const kline = klines[i];
    const observedAt = new Date(kline.openTime);

    // OHLC group validation (pure)
    const ohlcResult = validateOHLCGroup({
      entity_id: ctx.entityId,
      source,
      observed_at: observedAt,
      timeframe: ctx.timeframe,
      observations: {
        OPEN: kline.open,
        HIGH: kline.high,
        LOW: kline.low,
        CLOSE: kline.close,
      },
    });

    // Build OHLC inserts
    for (const metric of OHLC_METRICS) {
      const memberResult = ohlcResult.members[metric];
      inserts.push({
        entityId: ctx.entityId,
        metric,
        source,
        observedAt,
        timeframe: ctx.timeframe,
        qualityStatus: memberResult.quality_status,
        observationStatus: memberResult.quality_status,
        qualityConfigVersion: QUALITY_CONFIG_VERSION,
        evidence: [
          ...memberResult.evidence,
          ...ohlcResult.group_evidence,
        ],
        qualityEvaluatedAt: evaluatedAt,
        collectedAt: null,
      });
    }

    // Volume validation (pure)
    const volumeResult = validateMetric({
      entity_id: ctx.entityId,
      metric: "VOLUME",
      source,
      observed_at: observedAt,
      timeframe: ctx.timeframe,
      value: kline.volume,
    });

    inserts.push({
      entityId: ctx.entityId,
      metric: "VOLUME",
      source,
      observedAt,
      timeframe: ctx.timeframe,
      qualityStatus: volumeResult.quality_status,
      observationStatus: volumeResult.quality_status,
      qualityConfigVersion: QUALITY_CONFIG_VERSION,
      evidence: volumeResult.evidence,
      qualityEvaluatedAt: evaluatedAt,
      collectedAt: null,
    });

    // Quote volume validation (pure)
    const quoteVolumeResult = validateMetric({
      entity_id: ctx.entityId,
      metric: "QUOTE_VOLUME",
      source,
      observed_at: observedAt,
      timeframe: ctx.timeframe,
      value: kline.quoteVolume,
    });

    inserts.push({
      entityId: ctx.entityId,
      metric: "QUOTE_VOLUME",
      source,
      observedAt,
      timeframe: ctx.timeframe,
      qualityStatus: quoteVolumeResult.quality_status,
      observationStatus: quoteVolumeResult.quality_status,
      qualityConfigVersion: QUALITY_CONFIG_VERSION,
      evidence: quoteVolumeResult.evidence,
      qualityEvaluatedAt: evaluatedAt,
      collectedAt: null,
    });

    // Record evaluation summary
    evaluations.push({
      klineIndex: i,
      ohlc: {
        memberValidations: ohlcResult.members,
        groupEvidence: ohlcResult.group_evidence,
        hasRelationalFailure: ohlcResult.has_relational_failure,
        persisted: [], // Not populated in batch mode — persisted separately
      },
      volume: {
        validation: volumeResult,
        persisted: {} as any, // Not populated in batch mode
      },
      quoteVolume: {
        validation: quoteVolumeResult,
        persisted: {} as any, // Not populated in batch mode
      },
    });
  }

  // Phase 2: Batch persistence (single bulk DB operation)
  const persisted = await batchUpsertQualityResults(inserts);

  return {
    evaluations,
    persistedCount: persisted.length,
  };
}
