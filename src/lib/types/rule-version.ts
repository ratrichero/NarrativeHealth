export interface RuleVersion {
  id: number;
  version: number;
  description: string | null;
  healthWeights: HealthWeights;
  confidenceWeights: ConfidenceWeights;
  recommendationThresholds: RecommendationThresholds;
  isActive: boolean;
  createdAt: Date;
  activatedAt: Date | null;
}

export interface HealthWeights {
  trend: number; // Must sum to 1.0 with others
  derivative: number;
  volume: number;
  momentum: number;
}

export interface ConfidenceWeights {
  binance_spot: number; // Must sum to 1.0
  binance_futures: number;
  coingecko: number;
}

export interface RecommendationThresholds {
  strong_watch: number; // e.g. 90
  watch: number; // e.g. 80
  observe: number; // e.g. 65
  // Rule: strong_watch > watch > observe
}

export interface CreateRuleVersionInput {
  description?: string;
  healthWeights: HealthWeights;
  confidenceWeights: ConfidenceWeights;
  recommendationThresholds: RecommendationThresholds;
}