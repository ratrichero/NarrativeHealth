export interface IndicatorRecord {
  id:             number;
  coinId:         number;
  date:           string;
  timeframe:      string;
  indicatorType:  string;
  indicatorValue: number | null;
  indicatorMeta:  Record<string, unknown> | null;
  source:         string | null;
  calculatedAt:   Date;
}

export interface IndicatorBatch {
  coinId:    number;
  date:      string;
  timeframe: string;
  source:    string;
  values:    Array<{
    type:  string;
    value: number | null;
    meta?: Record<string, unknown>;
  }>;
}

export interface IndicatorHistoryPoint {
  date:  string;
  value: number | null;
}
