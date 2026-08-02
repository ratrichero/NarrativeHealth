// Technical Analysis Types

export enum SignalType {
  STRONG_LONG = "STRONG_LONG",
  LONG = "LONG",
  WEAK_LONG = "WEAK_LONG",
  NEUTRAL = "NEUTRAL",
  WEAK_SHORT = "WEAK_SHORT",
  SHORT = "SHORT",
  STRONG_SHORT = "STRONG_SHORT",
}

export enum RegimeType {
  TRENDING_UP = "TRENDING_UP",
  TRENDING_DOWN = "TRENDING_DOWN",
  RANGING = "RANGING",
  VOLATILE = "VOLATILE",
  BREAKOUT = "BREAKOUT",
  TRANSITIONING = "TRANSITIONING",
}

export interface IndicatorResult {
  name: string;
  value: number;
  signal: number; // -1.0 (strong short) → +1.0 (strong long)
  weight: number;
  description?: string;
}

export interface MarketRegime {
  type: RegimeType;
  adx: number;
  atrPct: number;
  efficiencyRatio: number;
  volSurge: number;
  pricePosition: number;
  signalMultiplier: number;
  indicatorBias: string;
}

export interface DataQuality {
  qualityScore: number;
  issues: string[];
  isValid: boolean;
  candleCount: number;
}

export interface RiskLevels {
  entry: number;
  stopLoss: number;
  tp1: number;
  tp2: number;
  tp3: number;
  slPct: number;
  rrRatio: number;
  refAtr: number;
  suggestedPositionPct: number;
}

export interface TimeframeResult {
  timeframe: string;
  indicators: IndicatorResult[];
  groupScores: Record<string, number>;
  compositeScore: number;
  signal: string;
  regime?: MarketRegime;
  dataQuality?: DataQuality;
  qualityScore?: number;
  klineData?: KlineData[]; // Raw kline data for charting
}

export interface TechnicalAnalysisResult {
  symbol: string;
  marketSymbol: string;
  marketType: "futures" | "spot";
  direction: "LONG" | "SHORT" | "NEUTRAL";
  signalType: SignalType;
  strength: number;
  confidence: number;
  compositeScore: number;
  timestamp: string;
  dominantRegime?: MarketRegime;
  riskLevels?: RiskLevels | undefined;
  timeframes: Record<string, TimeframeResult>;
}

export interface KlineData {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
}

export type Timeframe = "15m" | "1h" | "4h" | "1d";

export const TIMEFRAME_WEIGHTS: Record<Timeframe, number> = {
  "15m": 0.15,
  "1h": 0.25,
  "4h": 0.30,
  "1d": 0.30,
};

export const BASE_GROUP_WEIGHTS = {
  trend: 0.30,
  momentum: 0.25,
  volume: 0.20,
  oscillator: 0.15,
  pattern: 0.10,
};

export const REGIME_GROUP_WEIGHTS: Record<string, typeof BASE_GROUP_WEIGHTS> = {
  trend: {
    trend: 0.40,
    momentum: 0.25,
    volume: 0.20,
    oscillator: 0.10,
    pattern: 0.05,
  },
  oscillator: {
    trend: 0.15,
    momentum: 0.20,
    volume: 0.20,
    oscillator: 0.35,
    pattern: 0.10,
  },
  momentum: {
    trend: 0.20,
    momentum: 0.30,
    volume: 0.35,
    oscillator: 0.10,
    pattern: 0.05,
  },
  neutral: BASE_GROUP_WEIGHTS,
};