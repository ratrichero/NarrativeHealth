// Dashboard Types
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
export type RecommendationSignal = 'STRONG_WATCH' | 'WATCH' | 'OBSERVE' | 'WEAK';

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
