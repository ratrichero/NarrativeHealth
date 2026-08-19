// Dashboard Types
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { P3IntelligenceHistoryViewModel } from "@/lib/types/p3-intelligence-history";
import type { P4DecisionSupportViewModel } from "@/lib/p4/types";
import type { P5DecisionRecord, P5ActionDecisionReadViewModel } from "@/lib/p5/types";

export type { P3IntelligenceViewModel, P3IntelligenceHistoryViewModel, P4DecisionSupportViewModel, P5DecisionRecord, P5ActionDecisionReadViewModel };

export interface DashboardData {
  date: string;
  narratives: NarrativeSummary[];
  sourceStatus: SourceStatusSummary;
  topMovers: CoinMover[];
  weakestCoins: CoinMover[];
  alertCount: number;
  lastUpdate: string;
}

export interface NarrativeSummary {
  id: number;
  name: string;
  healthScore: number;
  previousScore: number | null;
  scoreChange: number | null;
  status: HealthStatus;
  coinCount: number;
  topCoin: CoinBasic | null;
  weakestCoin: CoinBasic | null;
  avgConfidence: number | null;
  signal: RecommendationSignal | null;
  weightingMethod?: 'market_cap' | 'equal';
}

export interface CoinBasic {
  id: number;
  symbol: string;
  name: string;
  healthScore: number;
}

export interface CoinMover {
  id: number;
  symbol: string;
  name: string;
  healthScore: number;
  scoreChange: number;
  narrativeId: number | null;
  narrativeName: string | null;
}

export interface SourceStatusSummary {
  binanceSpot: SourceState;
  binanceFutures: SourceState;
  coingecko: SourceState;
  lastUpdate: string;
}

export interface SourceState {
  status: 'OK' | 'PARTIAL' | 'FAILED';
  lastSuccess: string | null;
  recordsCollected: number;
}

// Health & Scoring Types
export type HealthStatus = 'STRONG' | 'HEALTHY' | 'NEUTRAL' | 'CAUTION' | 'WEAK';
export type RecommendationSignal = 'STRONG_WATCH' | 'WATCH' | 'OBSERVE' | 'CAUTION' | 'WEAK';

export interface ScoreBreakdown {
  trend: number;
  derivative: number;
  volume: number;
  momentum: number;
}

export interface TrendDetail {
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  price_vs_ema20: boolean;
  price_vs_ema50: boolean;
  price_vs_ema200: boolean;
  ema20_vs_ema50: boolean;
  ema50_vs_ema200: boolean;
  score_breakdown: Record<string, number>;
}

export interface DerivativeDetail {
  oi_current: number | null;
  oi_prev: number | null;
  oi_change_pct: number;
  funding_rate: number | null;
  oi_component: number;
  funding_component: number;
  accumulation_bonus: number;
  no_futures: boolean;
}

export interface VolumeDetail {
  volume_current: number;
  volume_ma20: number;
  volume_ratio: number;
  days_used: number;
}

export interface MomentumDetail {
  roc_14: number;
  atr_14: number;
  atr_pct: number;
  roc_component: number;
  atr_component: number;
}

// Narrative Detail Types
export interface NarrativeDetail {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  healthScore: number;
  previousScore: number | null;
  scoreChange: number | null;
  status: HealthStatus;
  avgConfidence: number | null;
  coins: CoinInNarrative[];
  healthHistory: HealthHistoryPoint[];
  /** Latest VALID P3 Intelligence artifact for this narrative, or null. */
  p3Intelligence: P3IntelligenceViewModel | null;
  /** Same-identity P3 historical series + trend, or null when unavailable. */
  p3IntelligenceHistory: P3IntelligenceHistoryViewModel | null;
  /** P4 Decision Support ViewModel (read-time derived), or null when unavailable. */
  p4DecisionSupport: P4DecisionSupportViewModel | null;
  /** P5 Decision Record from the frozen pipeline, or null when unavailable. */
  p5Decision: P5DecisionRecord | null;
  /** P5 Action Decision read model (derived from persisted artifact), or null. */
  p5ActionDecision: P5ActionDecisionReadViewModel | null;
}

export interface CoinInNarrative {
  id: number;
  symbol: string;
  name: string;
  healthScore: number;
  scoreChange: number | null;
  status: HealthStatus;
  signal: RecommendationSignal;
  reason: string;
  confidenceScore: number | null;
  trendScore: number | null;
  derivativeScore: number | null;
  volumeScore: number | null;
  momentumScore: number | null;
}

export interface HealthHistoryPoint {
  date: string;
  score: number;
}

// Coin Detail Types
export interface CoinDetail {
  id: number;
  symbol: string;
  name: string;
  binanceSpotSymbol: string | null;
  binanceFuturesSymbol: string | null;
  coingeckoId: string | null;
  hasFutures: boolean;
  isActive: boolean;
  narratives: { id: number; name: string; isPrimary: boolean }[];
  currentHealth: {
    healthScore: number;
    previousScore: number | null;
    scoreChange: number | null;
    status: HealthStatus;
    confidenceScore: number | null;
  } | null;
  features: {
    trendScore: number | null;
    derivativeScore: number | null;
    volumeScore: number | null;
    momentumScore: number | null;
    trendDetail: TrendDetail | null;
    derivativeDetail: DerivativeDetail | null;
    volumeDetail: VolumeDetail | null;
    momentumDetail: MomentumDetail | null;
  } | null;
  recommendation: {
    signal: RecommendationSignal;
    reason: string;
    reasonBreakdown: Record<string, string> | null;
  } | null;
  healthHistory: HealthHistoryPoint[];
  priceHistory: PriceHistoryPoint[];
  metrics: CoinMetricsData | null;
}

export interface PriceHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CoinMetricsData {
  openInterest: number | null;
  fundingRate: number | null;
  marketCap: number | null;
  fullyDilutedValuation: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
}

// Watchlist Types
export interface WatchlistItem {
  id: number;
  coinId: number;
  symbol: string;
  name: string;
  note: string | null;
  priority: number;
  healthScore: number | null;
  scoreChange: number | null;
  status: HealthStatus | null;
  signal: RecommendationSignal | null;
  confidenceScore: number | null;
}

// Admin Types
export interface AdminNarrative {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  coinCount: number;
  createdAt: string;
}

export interface AdminCoin {
  id: number;
  symbol: string;
  name: string;
  binanceSpotSymbol: string | null;
  binanceFuturesSymbol: string | null;
  coingeckoId: string | null;
  hasFutures: boolean;
  isActive: boolean;
  narratives: string[];
  createdAt: string;
}

export interface ConfigItem {
  id: number;
  configType: string;
  configKey: string;
  configValue: unknown;
  version: number;
  isActive: boolean;
  description: string | null;
}

// Refresh Status Types
export interface RefreshStatus {
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  progress: number;
  message: string;
  startedAt: string | null;
  completedAt: string | null;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
