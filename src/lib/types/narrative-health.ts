import type { HealthStatus } from "./health-timeline";

export interface CoinWeightDetail {
  coinId: number;
  symbol: string;
  weight: number; // 0.0 - 1.0 (e.g. 0.65)
  marketCap: number | null;
  healthScore: number;
}

export interface NarrativeHealthEnhanced {
  narrativeId: number;
  date: string;
  healthScore: number;
  status: HealthStatus;
  scoreChange: number | null;
  avgConfidence: number;
  topCoinId: number | null;
  weakestCoinId: number | null;
  ruleVersionId: number;
  weightingMethod: "market_cap" | "equal";
  weightDetails: Record<string, CoinWeightDetail>;
}