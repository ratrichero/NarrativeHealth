export const INDICATOR_TYPES: Record<string, {
  name: string;
  timeframes: string[];
  category: string;
}> = {
  EMA_9:    { name: 'EMA_9',    timeframes: ['1d','4h','1h'], category: 'trend' },
  EMA_21:   { name: 'EMA_21',   timeframes: ['1d','4h','1h'], category: 'trend' },
  EMA_50:   { name: 'EMA_50',   timeframes: ['1d','4h'],      category: 'trend' },
  EMA_200:  { name: 'EMA_200',  timeframes: ['1d'],           category: 'trend' },
  RSI_14:   { name: 'RSI_14',   timeframes: ['1d','4h','1h'], category: 'momentum' },
  MACD:     { name: 'MACD',     timeframes: ['1d','4h'],      category: 'momentum' },
  ADX_14:   { name: 'ADX_14',   timeframes: ['1d','4h'],      category: 'trend' },
  BB_20:    { name: 'BB_20',    timeframes: ['1d','4h'],      category: 'volatility' },
  ATR_14:   { name: 'ATR_14',   timeframes: ['1d','4h'],      category: 'volatility' },
  VWAP_20:  { name: 'VWAP_20',  timeframes: ['4h','1h'],      category: 'volume' },
  VOLUME_RATIO: { name: 'VOLUME_RATIO', timeframes: ['1d','4h'], category: 'volume' },
  OBV:      { name: 'OBV',      timeframes: ['1d'],           category: 'volume' },
};

export type IndicatorType = keyof typeof INDICATOR_TYPES;
