export interface MorningSnapshotHeader {
  id:             number;
  date:           string;
  totalCoins:     number;
  avgHealthScore: number | null;
  topNarrativeId: number | null;
  alertCount:     number;
  ruleVersionId:  number | null;
  timezone:       string;
  createdAt:      Date;
}

export interface MorningSnapshotCoin {
  id:          number;
  snapshotId:  number;
  coinId:      number;
  healthScore: number | null;
  scoreChange: number | null;
  signal:      string | null;
  confidence:  number | null;
}

export interface MorningSnapshotNarrative {
  id:             number;
  snapshotId:     number;
  narrativeId:    number;
  healthScore:    number | null;
  scoreChange:    number | null;
  coinCount:      number | null;
  topCoinId:      number | null;
  weakestCoinId:  number | null;
  weightingMethod: string | null;
}

export interface FullSnapshot {
  header:    MorningSnapshotHeader;
  coins:     MorningSnapshotCoin[];
  narratives: MorningSnapshotNarrative[];
}

export interface SnapshotSummary {
  id:             number;
  date:           string;
  totalCoins:     number;
  avgHealthScore: number | null;
  topNarrativeId: number | null;
  alertCount:     number;
  ruleVersionId:  number | null;
  timezone:       string;
  createdAt:      Date;
  topNarrativeName: string | null;
}

export interface CoinSnapshotPoint {
  coinId:      number;
  symbol:      string;
  healthScore: number | null;
  scoreChange: number | null;
  signal:      string | null;
  confidence:  number | null;
}

export interface NarrativeSnapshotPoint {
  narrativeId:    number;
  narrativeName:  string;
  healthScore:    number | null;
  scoreChange:    number | null;
  coinCount:      number | null;
  topCoinId:      number | null;
  weakestCoinId:  number | null;
  weightingMethod: string | null;
}
