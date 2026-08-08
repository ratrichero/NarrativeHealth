export interface CoinCorrelation {
  id: number;
  date: string;
  coinIdA: number;
  coinIdB: number;
  correlation: number | null;
  periodDays: number;
  createdAt: Date;
}

export interface CorrelationMatrix {
  narrativeId: number;
  narrativeName: string;
  coins: Array<{
    coinId: number;
    symbol: string;
  }>;
  matrix: number[][];
  avgCorrelation: number;
}
