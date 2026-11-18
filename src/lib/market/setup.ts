// RADAR-SETUP: entry/TP/SL theo ATR, dùng chung cho chat tools và Market Radar.
// Thuần tính toán, không đọc DB/network.

export interface SetupLevels {
  direction: "BULLISH" | "BEARISH";
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number;
  stopLoss: number;
  riskRewardRatio: number | null;
}

export function buildSetup(
  direction: "BULLISH" | "BEARISH",
  price: number,
  atr: number
): SetupLevels {
  const sign = direction === "BULLISH" ? 1 : -1;
  const eLow = +(price - atr * 0.5 * sign).toFixed(6);
  const eHigh = +(price + atr * 0.5 * sign).toFixed(6);
  const mid = (Math.min(eLow, eHigh) + Math.max(eLow, eHigh)) / 2;
  const t1 = +(mid + sign * atr * 1.5).toFixed(6);
  const t2 = +(mid + sign * atr * 3).toFixed(6);
  const sl = +(mid - sign * atr * 1.5).toFixed(6);
  const risk = Math.abs(mid - sl);
  const reward = Math.abs(t1 - mid);
  return {
    direction,
    entryLow: Math.min(eLow, eHigh),
    entryHigh: Math.max(eLow, eHigh),
    tp1: t1,
    tp2: t2,
    stopLoss: sl,
    riskRewardRatio: risk > 0 ? +(reward / risk).toFixed(1) : null,
  };
}
