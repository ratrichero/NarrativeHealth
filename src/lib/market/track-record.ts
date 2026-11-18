// RADAR-TRACK: lưu tín hiệu radar và đo forward return.
// Không thêm bảng: dùng app_settings key "radar.signals" (JSONB), giữ 14 ngày.
// Đây là track record của chính screener — không phải khuyến nghị giao dịch.

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { BIAS_LABELS, type Bias } from "@/lib/market/scoring";
import { fetchFuturesTickers, type RadarRow } from "@/lib/market/radar";

const KEY = "radar.signals";
const MAX_SIGNALS = 300;
const KEEP_DAYS = 14;
const BULLISH: Bias[] = ["continuation", "flush-bounce", "breakout", "accumulation"];
const BEARISH: Bias[] = ["exhaustion", "breakdown"];

export interface RadarSignalRecord {
  symbol: string;
  side: "gainer" | "loser" | "unusual";
  bias: Bias;
  score: number;
  price: number;
  at: string;
}

export interface TrackRecordRow extends RadarSignalRecord {
  returnPct: number | null;
  ageHours: number;
  win: boolean | null;
}

export interface TrackRecordSummary {
  bias: Bias;
  label: string;
  n: number;
  wins: number;
  hitRate: number | null;
  avgReturnPct: number | null;
}

export interface TrackRecordResult {
  summaries: TrackRecordSummary[];
  recent: TrackRecordRow[];
  total: number;
  note: string;
}

async function readSignals(): Promise<RadarSignalRecord[]> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    const value = row?.value;
    if (!Array.isArray(value)) return [];
    return value.filter(
      (s): s is RadarSignalRecord =>
        Boolean(s) &&
        typeof s === "object" &&
        typeof (s as RadarSignalRecord).symbol === "string" &&
        typeof (s as RadarSignalRecord).at === "string" &&
        Number.isFinite((s as RadarSignalRecord).price) &&
        (s as RadarSignalRecord).price > 0
    );
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không đọc được signals:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

async function writeSignals(signals: RadarSignalRecord[]): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: signals, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: signals, updatedAt: new Date() },
    });
}

const lastRecordAt = new Map<string, number>();

/**
 * Ghi tín hiệu đủ mạnh của tab hiện tại. Throttle 30 phút/tab và dedupe
 * theo symbol + ngày + side để không nhồi app_settings mỗi lần refresh.
 */
export async function recordRadarSignals(rows: RadarRow[], side: RadarSignalRecord["side"]): Promise<void> {
  if (process.env.NODE_ENV === "test") return;

  const now = Date.now();
  const last = lastRecordAt.get(side) ?? 0;
  if (now - last < 30 * 60_000) return;
  lastRecordAt.set(side, now);

  const day = new Date(now).toISOString().slice(0, 10);
  const candidates = rows
    .filter((r) => r.bias !== "neutral")
    .filter((r) => r.score >= 55 && r.entryQuality >= 40)
    .slice(0, 6)
    .map<RadarSignalRecord>((r) => ({
      symbol: r.symbol,
      side,
      bias: r.bias,
      score: r.score,
      price: r.price,
      at: new Date(now).toISOString(),
    }));
  if (candidates.length === 0) return;

  try {
    const existing = await readSignals();
    const seen = new Set(existing.map((s) => `${s.symbol}|${s.side}|${s.at.slice(0, 10)}`));
    const fresh = candidates.filter((s) => !seen.has(`${s.symbol}|${s.side}|${day}`));
    if (fresh.length === 0) return;

    const cutoff = now - KEEP_DAYS * 86_400_000;
    const kept = existing
      .filter((s) => new Date(s.at).getTime() >= cutoff)
      .concat(fresh)
      .slice(-MAX_SIGNALS);
    await writeSignals(kept);
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không ghi được signals:",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function winFor(bias: Bias, returnPct: number): boolean | null {
  if (BULLISH.includes(bias)) return returnPct > 0;
  if (BEARISH.includes(bias)) return returnPct < 0;
  return null;
}

let evalCache: { expires: number; value: TrackRecordResult } | null = null;

export async function evaluateRadarSignals(): Promise<TrackRecordResult> {
  if (evalCache && evalCache.expires > Date.now()) return evalCache.value;

  const signals = await readSignals();
  if (signals.length === 0) {
    return {
      summaries: [],
      recent: [],
      total: 0,
      note: "Chưa có tín hiệu nào được ghi. Tín hiệu đủ mạnh (score ≥ 55) sẽ tự lưu khi màn hình được mở.",
    };
  }

  let tickers: Awaited<ReturnType<typeof fetchFuturesTickers>> = [];
  try {
    tickers = await fetchFuturesTickers();
  } catch (error) {
    console.warn(
      "[RADAR-TRACK] Không lấy được giá hiện tại:",
      error instanceof Error ? error.message : String(error)
    );
  }
  const priceByPair = new Map(
    tickers.map((t) => [t.symbol, Number(t.lastPrice)] as const)
  );

  const now = Date.now();
  const rows: TrackRecordRow[] = signals.map((s) => {
    const current = priceByPair.get(`${s.symbol}USDT`) ?? null;
    const ageHours = Math.max(0, (now - new Date(s.at).getTime()) / 3_600_000);
    const evaluated = current !== null && ageHours >= 0.25;
    const returnPct = evaluated ? ((current - s.price) / s.price) * 100 : null;
    return {
      ...s,
      returnPct: returnPct === null ? null : Number(returnPct.toFixed(2)),
      ageHours: Number(ageHours.toFixed(1)),
      win: returnPct === null ? null : winFor(s.bias, returnPct),
    };
  });

  const byBias = new Map<Bias, TrackRecordRow[]>();
  for (const row of rows) {
    if (row.returnPct === null || row.win === null) continue;
    const list = byBias.get(row.bias) ?? [];
    list.push(row);
    byBias.set(row.bias, list);
  }

  const summaries: TrackRecordSummary[] = [...byBias.entries()]
    .map(([bias, list]) => {
      const wins = list.filter((r) => r.win).length;
      const avg = list.reduce((sum, r) => sum + (r.returnPct ?? 0), 0) / list.length;
      return {
        bias,
        label: BIAS_LABELS[bias],
        n: list.length,
        wins,
        hitRate: Math.round((wins / list.length) * 100),
        avgReturnPct: Number(avg.toFixed(2)),
      };
    })
    .sort((a, b) => b.n - a.n);

  const result: TrackRecordResult = {
    summaries,
    recent: [...rows].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 20),
    total: rows.length,
    note:
      "Hit rate tính từ giá tại lúc ghi tín hiệu đến giá hiện tại; tín hiệu dưới 15 phút chưa tính. " +
      "Continuation/breakout/accumulation/flush-bounce thắng khi giá tăng; exhaustion/breakdown thắng khi giá giảm.",
  };

  evalCache = { expires: Date.now() + 5 * 60_000, value: result };
  return result;
}
