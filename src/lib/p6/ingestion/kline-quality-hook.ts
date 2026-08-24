// P6-01E-C — Production Kline Observation + Quality Wiring Hook
// Authority: P6-01B, P6-01C, frozen P6-01D, frozen PD-E1..PD-E4 (P6-01E-B)
//
// Frozen planner decisions implemented here:
//   PD-E1: Quality evaluation occurs BEFORE the existing observation DB write.
//   PD-E2: Quality CLASSIFICATION never blocks ingestion.
//          Quality PERSISTENCE failure remains an infrastructure error — it is
//          NOT caught here, NOT converted into a quality state, NOT retried,
//          and NOT silently discarded; it propagates to the existing
//          per-coin error handling exactly like any other DB failure.
//   PD-E3: V1 scope = kline observations only
//          (OPEN HIGH LOW CLOSE VOLUME QUOTE_VOLUME).
//   PD-E4: observed_at is surfaced additively from the source-provided kline
//          `openTime`. No collected_at substitution. No business_date
//          substitution. No synthesized timestamps.
//
// This module does not modify any frozen semantic:
//   - D2 validator / classification semantics are used as-is.
//   - OHLC group identity is exact: (entity_id, source, observed_at, timeframe).
//   - Latest-only persistence is delegated to D3 upsertQualityResult.

import type { Timeframe } from "../quality/types";
import {
  evaluateAndPersistQuality,
  evaluateAndPersistOHLCQuality,
} from "../quality/evaluation-service";
import type { EvaluationResult, OHLCEvaluationResult } from "../quality/evaluation-service";

/** Structural shape of a Binance kline as produced by production collectors. */
export interface KlineLike {
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  quoteVolume: string;
}

/**
 * Legacy in-route price-source labels mapped to canonical P6-01C source IDs.
 * Mapping only relabels provenance for the quality dimension; the legacy
 * market-data write path is untouched.
 */
const CANONICAL_SOURCE_BY_LEGACY: Record<string, string> = {
  binance_spot: "BINANCE_SPOT",
  binance_futures: "BINANCE_FUTURES",
};

/** Resolve the canonical source ID from a legacy priceSource label. */
export function toCanonicalSource(legacyPriceSource: string): string {
  const canonical = CANONICAL_SOURCE_BY_LEGACY[legacyPriceSource];
  if (!canonical) {
    throw new Error(
      `[P6-01E-C] Unknown legacy priceSource "${legacyPriceSource}" — refusing to guess canonical source identity`
    );
  }
  return canonical;
}

/** Context describing one kline's canonical identity, supplied by the caller. */
export interface KlineQualityContext {
  /** Canonical entity id (= coin.id in production). */
  entityId: number;
  /** Legacy route price label ("binance_spot" | "binance_futures"). */
  priceSource: string;
  /** Frozen P6-01B timeframe vocabulary value. */
  timeframe: Timeframe;
}

export interface KlineQualityHookResult {
  ohlc: OHLCEvaluationResult;
  volume: EvaluationResult;
  quoteVolume: EvaluationResult;
}

/**
 * Evaluate + persist quality for ONE canonical kline observation set.
 *
 * Constructed identity (exact, no approximation):
 *   (entity_id, metric, source, observed_at = new Date(kline.openTime), timeframe)
 *
 * All four OHLC members share the exact same group identity.
 *
 * THROWS on infrastructure/persistence errors (by design — see header):
 * callers must treat a throw exactly like any other DB infrastructure failure
 * in their existing error envelope. A VALID/INVALID/MISSING/UNKNOWN result
 * never throws and never blocks anything by itself.
 */
export async function evaluateKlineObservationQuality(
  kline: KlineLike,
  ctx: KlineQualityContext
): Promise<KlineQualityHookResult> {
  const source = toCanonicalSource(ctx.priceSource);
  // observed_at comes verbatim from the source-provided openTime epoch.
  // No business_date conversion, no collected_at fallback, no synthesis.
  const observedAt = new Date(kline.openTime);

  // OHLC group with exact shared identity.
  const ohlc = await evaluateAndPersistOHLCQuality({
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

  // Volume metrics share the same identity but are single-metric checks.
  const volume = await evaluateAndPersistQuality({
    entity_id: ctx.entityId,
    metric: "VOLUME",
    source,
    observed_at: observedAt,
    timeframe: ctx.timeframe,
    value: kline.volume,
  });

  const quoteVolume = await evaluateAndPersistQuality({
    entity_id: ctx.entityId,
    metric: "QUOTE_VOLUME",
    source,
    observed_at: observedAt,
    timeframe: ctx.timeframe,
    value: kline.quoteVolume,
  });

  return { ohlc, volume, quoteVolume };
}
