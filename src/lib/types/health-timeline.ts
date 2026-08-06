export type HealthStatus =
  | "STRONG" // 90-100
  | "HEALTHY" // 80-89
  | "NEUTRAL" // 65-79
  | "CAUTION" // 50-64
  | "WEAK"; // 0-49

export interface HealthTimelinePoint {
  date: string; // YYYY-MM-DD
  healthScore: number; // 0-100
  status: HealthStatus;
  change: number | null; // vs previous day
}

export interface HealthTrend {
  direction: "improving" | "declining" | "stable";
  slope: number; // points per day (linear regression)
  change7d: number; // health change over 7 days
  change30d: number; // health change over 30 days
}

export interface HealthTimeline {
  coinId: number;
  symbol: string;
  points: HealthTimelinePoint[];
  trend: HealthTrend;
}