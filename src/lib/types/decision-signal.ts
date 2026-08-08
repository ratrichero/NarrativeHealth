export interface DecisionSignal {
  id: number;
  coinId: number;
  date: string;
  baseHealth: number | null;
  eventRiskScore: number | null;
  adjustedScore: number | null;
  adjustmentReason: string | null;
  activeEvents: Record<string, unknown> | null;
  createdAt: Date;
}

export interface DecisionInput {
  coinId: number;
  date: string;
  healthScore: number;
  eventRiskScore: number;
  correlationRisk: number;
}

export interface DecisionResult {
  adjustedScore: number;
  adjustmentReason: string;
}
