// RADAR-LEDGER: chấm forward return nhiều horizon cho tín hiệu radar.
// Pure functions — nhận klines đã fetch, không network/DB, test được.

import type { KlineData } from "@/lib/collectors/binance";
import { BIAS_LABELS, type Bias, type MoverSide } from "@/lib/market/scoring";
import type { RadarRow } from "@/lib/market/radar";

export const HORIZONS = [
  { id: "1h", hours: 1, label: "1 giờ" },
  { id: "4h", hours: 4, label: "4 giờ" },
  { id: "24h", hours: 24, label: "24 giờ" },
  { id: "3d", hours: 72, label: "3 ngày" },
  { id: "7d", hours: 168, label: "7 ngày" },
] as const;

export type HorizonId = (typeof HORIZONS)[number]["id"];

export function horizonHours(id: HorizonId): number {
  return HORIZONS.find((h) => h.id === id)?.hours ?? 24;
}

const BULLISH: Bias[] = ["continuation", "flush-bounce", "breakout", "accumulation"];
const BEARISH: Bias[] = ["exhaustion", "breakdown"];

export type SignalSide = MoverSide | "neutral";

export interface SignalSetupSnapshot {
  direction: "BULLISH" | "BEARISH";
  entryLow: number;
  entryHigh: number;
  tp1: number;
  tp2: number;
  stopLoss: number;
}

export interface RadarSignalRecord {
  symbol: string;
  side: SignalSide;
  bias: Bias;
  score: number;
  entryQuality: number;
  price: number;
  at: string;
  /** Giá BTC lúc ghi — mốc so sánh relative strength. */
  btcPrice?: number | null;
  /** Setup tại đúng thời điểm ghi, để đo TP/SL chạm hay không. */
  setup?: SignalSetupSnapshot | null;
  /** Đủ mạnh để coi là tín hiệu hành động tại thời điểm ghi. */
  actionable: boolean;
}

export interface HorizonResult {
  /** Đã đủ thời gian để đo chưa; null = còn pending. */
  returnPct: number | null;
  btcReturnPct: number | null;
  relativePct: number | null;
  mfePct: number | null;
  maePct: number | null;
  tp1Hit: boolean | null;
  slHit: boolean | null;
  /** Thứ tự chạm trong horizon: TP trước, SL trước, cùng nến, hoặc chưa chạm. */
  firstEvent: "tp" | "sl" | "ambiguous" | null;
  win: boolean | null;
  pending: boolean;
}

export interface TrackedSignal extends RadarSignalRecord {
  ageHours: number;
  horizons: Partial<Record<HorizonId, HorizonResult>>;
}

export interface HorizonSummary {
  horizon: HorizonId;
  n: number;
  hitRate: number | null;
  avgReturnPct: number | null;
  avgRelativePct: number | null;
  avgMfePct: number | null;
  avgMaePct: number | null;
  tp1HitRate: number | null;
  slHitRate: number | null;
}

export interface BiasSummary {
  bias: Bias;
  label: string;
  horizons: HorizonSummary[];
}

export interface TrackRecordResult {
  summaries: BiasSummary[];
  recent: TrackedSignal[];
  total: number;
  actionable: number;
  note: string;
  demo?: boolean;
  evaluatedAt: string;
}

function round(value: number | null, digits = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

export function isBullishBias(bias: Bias): boolean {
  return BULLISH.includes(bias);
}

export function isBearishBias(bias: Bias): boolean {
  return BEARISH.includes(bias);
}

/** Giá close của nến cuối cùng mở trước/đúng mốc thời gian. */
function closeAt(candles: KlineData[], timestamp: number): number | null {
  let found: number | null = null;
  for (const candle of candles) {
    if (candle.openTime <= timestamp) found = Number(candle.close);
    else break;
  }
  return found !== null && Number.isFinite(found) && found > 0 ? found : null;
}

function evaluateHorizon(
  signal: RadarSignalRecord,
  coinCandles: KlineData[],
  btcCandles: KlineData[],
  horizon: HorizonId,
  now: number
): HorizonResult {
  const hours = horizonHours(horizon);
  const start = Date.parse(signal.at);
  const end = start + hours * 3_600_000;

  if (!Number.isFinite(start) || now < end) {
    return {
      returnPct: null,
      btcReturnPct: null,
      relativePct: null,
      mfePct: null,
      maePct: null,
      tp1Hit: null,
      slHit: null,
      firstEvent: null,
      win: null,
      pending: true,
    };
  }

  // Chỉ dùng nến đã đóng tại mốc horizon (openTime < end) để tránh nhìn trước.
  const window = coinCandles.filter((c) => c.openTime >= start && c.openTime < end);
  if (window.length === 0) {
    return {
      returnPct: null,
      btcReturnPct: null,
      relativePct: null,
      mfePct: null,
      maePct: null,
      tp1Hit: null,
      slHit: null,
      firstEvent: null,
      win: null,
      pending: false,
    };
  }

  const lastClose = Number(window[window.length - 1].close);
  const returnPct = ((lastClose - signal.price) / signal.price) * 100;

  let maxHigh = -Infinity;
  let minLow = Infinity;
  for (const candle of window) {
    maxHigh = Math.max(maxHigh, Number(candle.high));
    minLow = Math.min(minLow, Number(candle.low));
  }
  const mfePct = ((maxHigh - signal.price) / signal.price) * 100;
  const maePct = ((minLow - signal.price) / signal.price) * 100;

  let tp1Hit: boolean | null = null;
  let slHit: boolean | null = null;
  let firstEvent: HorizonResult["firstEvent"] = null;
  if (signal.setup) {
    tp1Hit = false;
    slHit = false;
    firstEvent = null;
    const isShort = signal.setup.direction === "BEARISH";
    for (const candle of window) {
      const high = Number(candle.high);
      const low = Number(candle.low);
      const hitTp = isShort ? low <= signal.setup.tp1 : high >= signal.setup.tp1;
      const hitSl = isShort ? high >= signal.setup.stopLoss : low <= signal.setup.stopLoss;
      if (hitTp) tp1Hit = true;
      if (hitSl) slHit = true;
      if (hitTp && hitSl) {
        firstEvent = firstEvent ?? "ambiguous";
      } else if (hitTp) {
        firstEvent = firstEvent ?? "tp";
      } else if (hitSl) {
        firstEvent = firstEvent ?? "sl";
      }
      if (firstEvent === "tp" || firstEvent === "sl") break;
    }
  }

  const btcStart = signal.btcPrice && signal.btcPrice > 0 ? signal.btcPrice : closeAt(btcCandles, start);
  const btcEnd = closeAt(btcCandles, end - 1);
  const btcReturnPct =
    btcStart !== null && btcEnd !== null && btcStart > 0 ? ((btcEnd - btcStart) / btcStart) * 100 : null;
  const relativePct = btcReturnPct === null ? null : returnPct - btcReturnPct;

  let win: boolean | null = null;
  if (BULLISH.includes(signal.bias)) win = returnPct > 0;
  else if (BEARISH.includes(signal.bias)) win = returnPct < 0;

  return {
    returnPct: round(returnPct),
    btcReturnPct: round(btcReturnPct),
    relativePct: round(relativePct),
    mfePct: round(mfePct),
    maePct: round(maePct),
    tp1Hit,
    slHit,
    firstEvent,
    win,
    pending: false,
  };
}

export function evaluateSignal(
  signal: RadarSignalRecord,
  coinCandles: KlineData[],
  btcCandles: KlineData[],
  now = Date.now()
): TrackedSignal {
  const horizons: Partial<Record<HorizonId, HorizonResult>> = {};
  for (const horizon of HORIZONS) {
    horizons[horizon.id] = evaluateHorizon(signal, coinCandles, btcCandles, horizon.id, now);
  }
  const ageHours = Math.max(0, (now - Date.parse(signal.at)) / 3_600_000);
  return { ...signal, ageHours: Number(ageHours.toFixed(1)), horizons };
}

export function aggregateHorizon(rows: TrackedSignal[], horizon: HorizonId): HorizonSummary {
  const evaluated = rows
    .map((row) => row.horizons[horizon])
    .filter((h): h is HorizonResult => h !== undefined && !h.pending && h.returnPct !== null);

  const n = evaluated.length;
  if (n === 0) {
    return {
      horizon,
      n: 0,
      hitRate: null,
      avgReturnPct: null,
      avgRelativePct: null,
      avgMfePct: null,
      avgMaePct: null,
      tp1HitRate: null,
      slHitRate: null,
    };
  }

  const wins = evaluated.filter((h) => h.win === true).length;
  const directional = evaluated.filter((h) => h.win !== null).length;
  const avg = (pick: (h: HorizonResult) => number | null): number | null => {
    const values = evaluated.map(pick).filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    return round(values.reduce((sum, v) => sum + v, 0) / values.length);
  };

  const withTp = evaluated.filter((h) => h.tp1Hit !== null);
  const withSl = evaluated.filter((h) => h.slHit !== null);

  return {
    horizon,
    n,
    hitRate: directional > 0 ? Math.round((wins / directional) * 100) : null,
    avgReturnPct: avg((h) => h.returnPct),
    avgRelativePct: avg((h) => h.relativePct),
    avgMfePct: avg((h) => h.mfePct),
    avgMaePct: avg((h) => h.maePct),
    tp1HitRate: withTp.length > 0 ? Math.round((withTp.filter((h) => h.tp1Hit).length / withTp.length) * 100) : null,
    slHitRate: withSl.length > 0 ? Math.round((withSl.filter((h) => h.slHit).length / withSl.length) * 100) : null,
  };
}

export function summarizeByBias(rows: TrackedSignal[]): BiasSummary[] {
  const byBias = new Map<Bias, TrackedSignal[]>();
  for (const row of rows) {
    const list = byBias.get(row.bias) ?? [];
    list.push(row);
    byBias.set(row.bias, list);
  }
  return [...byBias.entries()]
    .map(([bias, list]) => ({
      bias,
      label: BIAS_LABELS[bias],
      horizons: HORIZONS.map((h) => aggregateHorizon(list, h.id)),
    }))
    .sort((a, b) => {
      const aN = a.horizons.find((h) => h.horizon === "24h")?.n ?? 0;
      const bN = b.horizons.find((h) => h.horizon === "24h")?.n ?? 0;
      return bN - aN;
    });
}

export const DEFAULT_COHORT_SIZE = 12;
export const DEFAULT_NEUTRAL_SLOTS = 3;

/**
 * Chọn cohort độc lập với filter/sort của người xem: top composite cố định,
 * luôn dành slot cho neutral kể cả khi neutral không nằm trong top 12.
 */
export function selectCohort(
  rows: RadarRow[],
  max = DEFAULT_COHORT_SIZE,
  neutralSlots = DEFAULT_NEUTRAL_SLOTS
): RadarRow[] {
  const sorted = [...rows].sort((a, b) => b.composite - a.composite || b.score - a.score);
  const neutral = sorted.filter((r) => r.bias === "neutral").slice(0, Math.max(0, neutralSlots));
  const nonNeutral = sorted.filter((r) => r.bias !== "neutral").slice(0, Math.max(0, max - neutral.length));
  const selected = [...nonNeutral, ...neutral];

  if (selected.length < max) {
    const seen = new Set(selected.map((r) => r.pair));
    for (const row of sorted) {
      if (selected.length >= max) break;
      if (!seen.has(row.pair)) {
        selected.push(row);
        seen.add(row.pair);
      }
    }
  }

  return selected.slice(0, max).sort((a, b) => b.composite - a.composite || b.score - a.score);
}

export interface CohortSnapshots {
  gainer: RadarRow[];
  loser: RadarRow[];
  unusual: RadarRow[];
}

export interface CohortPlanEntry {
  side: SignalSide;
  row: RadarRow;
}

/**
 * Lập kế hoạch cohort độc lập tab người xem: đủ 3 side, mỗi side tối đa 12
 * non-neutral, cộng một cohort neutral riêng (tối đa 6, dedupe theo symbol).
 * Neutral không bị nhân bản sang từng side.
 */
export function planCohorts(
  snapshots: CohortSnapshots,
  sideMax = DEFAULT_COHORT_SIZE,
  neutralMax = 6
): CohortPlanEntry[] {
  const plan: CohortPlanEntry[] = [];
  const sides: Array<Exclude<SignalSide, "neutral">> = ["gainer", "loser", "unusual"];

  for (const side of sides) {
    const rows = selectCohort(snapshots[side], sideMax, 0).filter((row) => row.bias !== "neutral");
    for (const row of rows) plan.push({ side, row });
  }

  const neutral = new Map<string, RadarRow>();
  for (const side of sides) {
    for (const row of snapshots[side]) {
      if (row.bias === "neutral" && !neutral.has(row.pair)) neutral.set(row.pair, row);
    }
  }
  const neutralRows = [...neutral.values()]
    .sort((a, b) => b.composite - a.composite || b.score - a.score)
    .slice(0, Math.max(0, neutralMax));
  for (const row of neutralRows) plan.push({ side: "neutral", row });

  return plan;
}

export const LEDGER_NOTE =
  "Return tính từ giá lúc ghi đến close nến 1h gần mốc horizon; MFE/MAE lấy high/low trong horizon. " +
  "Continuation/breakout/accumulation/flush-bounce thắng khi giá tăng, exhaustion/breakdown thắng khi giá giảm; neutral chỉ lưu để tham chiếu. " +
  "Relative = return coin − return BTC cùng horizon. Tín hiệu chưa đủ tuổi horizon được tính là pending.";
