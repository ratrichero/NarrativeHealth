import { KlineData } from "@/lib/technical-analysis/types";
import { ema, rsi, adxFull, macd, bollingerBands, atr, vwapRollingAnalysis, sma, obv } from "@/lib/technical-analysis/indicators";
import { INDICATOR_TYPES } from "./registry";

export interface CalculatedIndicator {
  type: string;
  value: number | null;
  meta?: Record<string, unknown>;
}

export function calculateIndicators(data: KlineData[], timeframe: string): CalculatedIndicator[] {
  if (data.length === 0) return [];

  const closes = data.map(d => d.close);
  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const volumes = data.map(d => d.volume);

  const results: CalculatedIndicator[] = [];

  for (const [key, config] of Object.entries(INDICATOR_TYPES)) {
    if (!config.timeframes.includes(timeframe)) continue;

    switch (key) {
      case 'EMA_9': {
        const vals = ema(closes, 9);
        results.push({ type: 'EMA_9', value: vals.at(-1) ?? null });
        break;
      }
      case 'EMA_21': {
        const vals = ema(closes, 21);
        results.push({ type: 'EMA_21', value: vals.at(-1) ?? null });
        break;
      }
      case 'EMA_50': {
        const vals = ema(closes, 50);
        results.push({ type: 'EMA_50', value: vals.at(-1) ?? null });
        break;
      }
      case 'EMA_200': {
        const vals = ema(closes, 200);
        results.push({ type: 'EMA_200', value: vals.at(-1) ?? null });
        break;
      }
      case 'RSI_14': {
        const vals = rsi(closes, 14);
        results.push({ type: 'RSI_14', value: vals.at(-1) ?? null });
        break;
      }
      case 'ADX_14': {
        const adxResult = adxFull(data, 14);
        results.push({ type: 'ADX_14', value: adxResult.adx.at(-1) ?? null });
        break;
      }
      case 'MACD': {
        const macdResult = macd(closes, 12, 26, 9);
        results.push({
          type: 'MACD',
          value: macdResult.macdLine.at(-1) ?? null,
          meta: {
            signal: macdResult.signalLine.at(-1) ?? null,
            histogram: macdResult.histogram.at(-1) ?? null,
          },
        });
        break;
      }
      case 'BB_20': {
        const bb = bollingerBands(closes, 20, 2);
        const middle = bb.middle.at(-1) ?? null;
        const upper = bb.upper.at(-1) ?? null;
        const lower = bb.lower.at(-1) ?? null;
        const price = closes.at(-1) ?? null;
        const pctB = middle && upper && lower && price != null
          ? ((price - lower) / (upper - lower)) * 100
          : null;
        results.push({
          type: 'BB_20',
          value: middle,
          meta: { upper, lower, pctB },
        });
        break;
      }
      case 'ATR_14': {
        const vals = atr(data, 14);
        results.push({ type: 'ATR_14', value: vals.at(-1) ?? null });
        break;
      }
      case 'VWAP_20': {
        const vwapResult = vwapRollingAnalysis(highs, lows, closes, volumes, 20);
        results.push({ type: 'VWAP_20', value: vwapResult.value });
        break;
      }
      case 'VOLUME_RATIO': {
        const current = volumes.at(-1) ?? 0;
        const avg20 = sma(volumes, 20).at(-1) ?? 0;
        const ratio = avg20 > 0 ? current / avg20 : null;
        results.push({ type: 'VOLUME_RATIO', value: ratio });
        break;
      }
      case 'OBV': {
        const obvVals = obv(data);
        results.push({ type: 'OBV', value: obvVals.at(-1) ?? null });
        break;
      }
    }
  }

  return results;
}
