// Confidence score calculation

export interface ConfidenceResult {
  confidence_score: number;
  missing_sources: string[];
  data_completeness: number;
}

export interface ConfidenceWeights {
  binance_spot: number;
  binance_futures: number;
  coingecko: number;
}

const DEFAULT_WEIGHTS: ConfidenceWeights = {
  binance_spot: 0.3,
  binance_futures: 0.4,
  coingecko: 0.3,
};

/**
 * Calculate confidence score based on data source availability
 */
export function calculateConfidence(
  binanceSpotOk: boolean,
  binanceFuturesOk: boolean,
  coingeckoOk: boolean,
  hasFutures: boolean,
  weights: ConfidenceWeights = DEFAULT_WEIGHTS
): ConfidenceResult {
  const missing: string[] = [];
  let spotW: number;
  let futW: number;
  let cgW: number;

  if (!hasFutures) {
    // Redistribute futures weight to other sources
    const totalW = weights.binance_spot + weights.coingecko;
    spotW = weights.binance_spot / totalW;
    cgW = weights.coingecko / totalW;
    futW = 0;
  } else {
    spotW = weights.binance_spot;
    futW = weights.binance_futures;
    cgW = weights.coingecko;
  }

  let score = 0;

  if (binanceSpotOk) {
    score += spotW * 100;
  } else {
    missing.push("binance_spot");
  }

  if (hasFutures) {
    if (binanceFuturesOk) {
      score += futW * 100;
    } else {
      missing.push("binance_futures");
    }
  }

  if (coingeckoOk) {
    score += cgW * 100;
  } else {
    missing.push("coingecko");
  }

  const totalSources = hasFutures ? 3 : 2;
  const dataCompleteness = ((totalSources - missing.length) / totalSources) * 100;

  return {
    confidence_score: Number(score.toFixed(1)),
    missing_sources: missing,
    data_completeness: Number(dataCompleteness.toFixed(1)),
  };
}
