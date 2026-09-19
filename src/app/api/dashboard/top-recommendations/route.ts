// Top Recommendations API — 3 directional opportunities for the dashboard
// SQ-TOP-REC v2:
//  - ATR fallback: if the indicators table lacks ATR_14 for the data date
//    (timezone offset between pipelines, or indicator job not run yet), compute
//    ATR directly from market_price_daily so setups are always available.
//  - Directional selection: top picks are split bullish (2) + bearish watch (1)
//    so weak coins surface as short-bias candidates instead of being mixed in
//    as "good coins".
//  - Vietnamese reason generated from live metrics (DB reason stays English —
//    the frozen rule-engine templates are untouched).

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  coins,
  healthScores,
  recommendations,
  features,
  marketPriceDaily,
  indicators,
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { getBusinessDate, getHealthStatus } from "@/lib/utils";

export const dynamic = "force-dynamic";

export type SetupDirection = "BULLISH" | "BEARISH";

interface SetupLevels {
  entryLow: number;
  entryHigh: number;
  takeProfits: { level: number; label: string | null }[];
  stopLoss: number;
  riskRewardRatio: number | null;
  tp1MovePct: number | null;
  slRiskPct: number | null;
}

export interface TopRecommendation {
  coinId: number;
  symbol: string;
  name: string;
  narrativeName: string | null;
  healthScore: number;
  scoreChange: number | null;
  status: string;
  signal: string;
  direction: SetupDirection;
  reason: string;
  currentPrice: number;
  setup: SetupLevels | null;
  setupUnavailableReason: string | null;
  metrics: {
    trendScore: number | null;
    volumeScore: number | null;
    momentumScore: number | null;
    rsi14: number | null;
    fundingRate: number | null;
    priceVsEma20Pct: number | null;
  };
}

// ─── ATR computation (fallback + shared) ─────────────────

/** ATR(14) with EWM smoothing — same math as src/lib/technical-analysis/indicators.ts */
function computeAtrFromRows(
  rows: { high: string; low: string; close: string }[]
): number | null {
  if (rows.length < 15) return null;

  const tr: number[] = rows.map((d, i) => {
    const high = parseFloat(d.high);
    const low = parseFloat(d.low);
    const close = parseFloat(d.close);
    if (i === 0) return high - low;
    const prevClose = parseFloat(rows[i - 1].close);
    return Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  });

  // EWM span=14 (alpha = 2/15), matching Python ewm(span=period, adjust=False)
  const alpha = 2 / 15;
  let emaVal = tr[0];
  for (let i = 1; i < tr.length; i++) {
    emaVal = alpha * tr[i] + (1 - alpha) * emaVal;
  }
  return Number.isFinite(emaVal) && emaVal > 0 ? emaVal : null;
}

/** Fallback: compute ATR straight from daily price history in DB. */
async function getAtrFallback(
  coinId: number
): Promise<number | null> {
  const rows = await db
    .select({ high: marketPriceDaily.high, low: marketPriceDaily.low, close: marketPriceDaily.close })
    .from(marketPriceDaily)
    .where(eq(marketPriceDaily.coinId, coinId))
    .orderBy(desc(marketPriceDaily.date))
    .limit(30);
  return computeAtrFromRows(rows);
}

// ─── Setup levels (direction-aware, same ATR distances as Square engine) ──

function buildSetup(
  direction: SetupDirection,
  price: number,
  atr14: number
): SetupLevels {
  // BULLISH: entry around price, targets above, stop below (Square formula)
  // BEARISH: mirrored — breakdown entry, targets below, stop above
  const sign = direction === "BULLISH" ? 1 : -1;

  const entryLow = +(price - atr14 * 0.5 * sign).toFixed(6);
  const entryHigh = +(price + atr14 * 0.5 * sign).toFixed(6);
  const zoneLow = Math.min(entryLow, entryHigh);
  const zoneHigh = Math.max(entryLow, entryHigh);
  const entryMid = (zoneLow + zoneHigh) / 2;

  const t1 = +(entryMid + sign * atr14 * 1.5).toFixed(6);
  const t2 = +(entryMid + sign * atr14 * 3).toFixed(6);
  const sl = +(entryMid - sign * atr14 * 1.5).toFixed(6);

  const reward = Math.abs(t1 - entryMid);
  const risk = Math.abs(entryMid - sl);
  const riskRewardRatio = risk > 0 ? +(reward / risk).toFixed(1) : null;
  const tp1MovePct = entryMid > 0 ? +((reward / entryMid) * 100).toFixed(0) : null;
  const slRiskPct = entryMid > 0 ? +((risk / entryMid) * 100).toFixed(0) : null;

  const tpLabel = direction === "BULLISH" ? "TP" : "Mục tiêu";
  return {
    entryLow: zoneLow,
    entryHigh: zoneHigh,
    takeProfits: [
      { level: t1, label: `${tpLabel}1` },
      { level: t2, label: `${tpLabel}2` },
    ],
    stopLoss: sl,
    riskRewardRatio,
    tp1MovePct,
    slRiskPct,
  };
}

// ─── Direction classification ────────────────────────────

function classifyDirection(signal: string, health: number, scoreChange: number | null): SetupDirection {
  if (signal === "WEAK" || signal === "CAUTION") return "BEARISH";
  if (scoreChange !== null && scoreChange <= -3) return "BEARISH";
  if (health < 50) return "BEARISH";
  return "BULLISH";
}

// ─── Vietnamese reason generation ────────────────────────

function buildVietnameseReason(
  direction: SetupDirection,
  signal: string,
  health: number,
  scoreChange: number | null,
  trend: number | null,
  volume: number | null,
  momentum: number | null,
  rsi: number | null,
  priceVsEma20Pct: number | null
): string {
  const parts: string[] = [];

  // Opening by direction + signal
  if (direction === "BULLISH") {
    if (signal === "STRONG_WATCH") {
      parts.push(`Tín hiệu theo dõi mạnh — sức khoẻ ${health.toFixed(0)} điểm`);
    } else if (signal === "WATCH") {
      parts.push(`Đáng theo dõi — sức khoẻ ${health.toFixed(0)} điểm`);
    } else {
      parts.push(`Xu hướng tích cực — sức khoẻ ${health.toFixed(0)} điểm`);
    }
  } else {
    parts.push(`Cảnh báo suy yếu — sức khoẻ ${health.toFixed(0)} điểm, cân nhắc hướng short-bias`);
  }

  if (scoreChange !== null && Math.abs(scoreChange) >= 1) {
    parts.push(`${scoreChange > 0 ? "tăng" : "giảm"} ${Math.abs(scoreChange).toFixed(1)} điểm so với kỳ trước`);
  }

  // Trend read
  if (trend !== null) {
    if (trend >= 75) parts.push("xu hướng rất mạnh");
    else if (trend >= 60) parts.push("xu hướng tốt");
    else if (trend <= 30) parts.push("xu hướng yếu");
  }

  if (priceVsEma20Pct !== null) {
    parts.push(`giá ${priceVsEma20Pct >= 0 ? "trên" : "dưới"} EMA20 (${priceVsEma20Pct >= 0 ? "+" : ""}${priceVsEma20Pct.toFixed(1)}%)`);
  }

  if (volume !== null) {
    if (volume >= 75) parts.push("khối lượng vượt trội so với trung bình");
    else if (volume <= 30) parts.push("khối lượng thấp — thanh khoản mỏng");
  }

  if (momentum !== null) {
    if (momentum >= 70) parts.push("động lượng tốt");
    else if (momentum <= 30) parts.push("động lượng suy giảm");
  }

  if (rsi !== null && direction === "BULLISH" && rsi >= 70) {
    parts.push(`RSI ${rsi.toFixed(0)} — vùng quá mua, cẩn thận điều chỉnh`);
  }

  return parts.join(", ").replace(/, ([^,]*)$/, " và $1") + ".";
}

// ─── Main handler ────────────────────────────────────────

export async function GET() {
  try {
    const today = getBusinessDate();

    // Freshest date with health data (same "freshest wins" as dashboard)
    const [latest] = await db
      .select({ date: healthScores.date })
      .from(healthScores)
      .orderBy(desc(healthScores.date))
      .limit(1);
    const dataDate = latest?.date ?? today;

    const rows = await db
      .select({
        coinId: coins.id,
        symbol: coins.symbol,
        name: coins.name,
        healthScore: healthScores.healthScore,
        scoreChange: healthScores.scoreChange,
        signal: recommendations.signal,
        reason: recommendations.reason,
        trendScore: features.trendScore,
        volumeScore: features.volumeScore,
        momentumScore: features.momentumScore,
        narrativeName: sql<string | null>`(
          SELECT n.name FROM narratives n
          JOIN coin_narratives cn ON cn.narrative_id = n.id
          WHERE cn.coin_id = ${coins.id} AND n.is_active = true
          ORDER BY cn.is_primary DESC LIMIT 1
        )`,
        closePrice: sql<string | null>`(
          SELECT p.close FROM market_price_daily p
          WHERE p.coin_id = ${coins.id} AND p.date = ${dataDate}
          LIMIT 1
        )`,
        atr14: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date = ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'ATR_14'
          LIMIT 1
        )`,
        ema20: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date = ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'EMA_20'
          LIMIT 1
        )`,
        rsi14: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date = ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'RSI_14'
          LIMIT 1
        )`,
        fundingRate: sql<string | null>`(
          SELECT cm.funding_rate FROM coin_metrics cm
          WHERE cm.coin_id = ${coins.id} AND cm.date = ${dataDate}
          LIMIT 1
        )`,
      })
      .from(healthScores)
      .innerJoin(coins, eq(coins.id, healthScores.coinId))
      .leftJoin(
        recommendations,
        and(
          eq(recommendations.coinId, healthScores.coinId),
          eq(recommendations.date, dataDate)
        )
      )
      .leftJoin(
        features,
        and(
          eq(features.coinId, healthScores.coinId),
          eq(features.date, dataDate)
        )
      )
      .where(and(eq(healthScores.date, dataDate), eq(coins.isActive, true)));

    // ── Classify + score each coin ──
    interface Scored {
      row: (typeof rows)[number];
      direction: SetupDirection;
      composite: number; // bullish strength or bearish weakness score
    }

    const scored: Scored[] = rows.map((r) => {
      const health = r.healthScore ?? 0;
      const trend = r.trendScore ?? 50;
      const momentum = r.momentumScore ?? 50;
      const change = r.scoreChange ?? 0;
      const direction = classifyDirection(r.signal ?? "OBSERVE", health, r.scoreChange);

      // Bullish strength composite
      const bullComposite =
        health * 0.4 + trend * 0.35 + momentum * 0.15 + Math.max(0, Math.min(20, change + 10)) * 0.5;
      // Bearish weakness composite (higher = weaker coin, better short-bias candidate)
      const bearComposite =
        (100 - health) * 0.45 + Math.max(0, -change) * 8 + (100 - trend) * 0.25 + (100 - momentum) * 0.15;

      return { row: r, direction, composite: direction === "BEARISH" ? bearComposite : bullComposite };
    });

    const bullish = scored.filter((s) => s.direction === "BULLISH").sort((a, b) => b.composite - a.composite);
    const bearish = scored.filter((s) => s.direction === "BEARISH").sort((a, b) => b.composite - a.composite);

    // Selection: 2 bullish + 1 bearish when possible, otherwise fill from best remaining
    const selected: Scored[] = [
      ...bullish.slice(0, 2),
      ...(bearish.length > 0 ? [bearish[0]] : []),
      ...(bullish.slice(2, 2 + Math.max(0, 3 - 2 - (bearish.length > 0 ? 1 : 0)))),
    ].slice(0, 3);

    // If still short (e.g. no bullish coins at all), pad from bearish
    if (selected.length < 3) {
      const chosenIds = new Set(selected.map((s) => s.row.coinId));
      for (const b of bearish) {
        if (selected.length >= 3) break;
        if (!chosenIds.has(b.row.coinId)) {
          selected.push(b);
          chosenIds.add(b.row.coinId);
        }
      }
    }

    const top: TopRecommendation[] = [];

    for (const s of selected) {
      const r = s.row;
      const price = r.closePrice ? parseFloat(r.closePrice) : 0;
      let atr = r.atr14 ? parseFloat(r.atr14) : null;
      let atrSource: "indicators" | "price-history-fallback" = "indicators";

      // SQ-TOP-REC v2 FIX: fall back to computing ATR from price history when
      // the indicators table has no ATR_14 row for this date (timezone offset
      // between pipelines or indicator job not yet run).
      if ((atr === null || atr <= 0) && price > 0) {
        atr = await getAtrFallback(r.coinId);
        if (atr !== null) atrSource = "price-history-fallback";
      }

      const ema20 = r.ema20 ? parseFloat(r.ema20) : null;
      const rsi = r.rsi14 ? parseFloat(r.rsi14) : null;
      const funding = r.fundingRate ? parseFloat(r.fundingRate) : null;
      const ema20Pct =
        ema20 && ema20 > 0 && price > 0 ? +(((price - ema20) / ema20) * 100).toFixed(1) : null;

      const hasSetup = price > 0 && atr !== null && atr > 0;
      let setupUnavailableReason: string | null = null;
      if (!hasSetup) {
        setupUnavailableReason =
          price <= 0
            ? "Không có dữ liệu giá cho ngày dữ liệu mới nhất."
            : "Chưa đủ dữ liệu ATR (cần ít nhất 15 ngày lịch sử giá).";
      }

      top.push({
        coinId: r.coinId,
        symbol: r.symbol,
        name: r.name,
        narrativeName: r.narrativeName,
        healthScore: r.healthScore,
        scoreChange: r.scoreChange,
        status: getHealthStatus(r.healthScore),
        signal: r.signal ?? "OBSERVE",
        direction: s.direction,
        reason: buildVietnameseReason(
          s.direction,
          r.signal ?? "OBSERVE",
          r.healthScore,
          r.scoreChange,
          r.trendScore != null ? Math.round(r.trendScore) : null,
          r.volumeScore != null ? Math.round(r.volumeScore) : null,
          r.momentumScore != null ? Math.round(r.momentumScore) : null,
          rsi,
          ema20Pct
        ),
        currentPrice: price,
        setup: hasSetup && atr !== null ? buildSetup(s.direction, price, atr) : null,
        setupUnavailableReason,
        metrics: {
          trendScore: r.trendScore != null ? Math.round(r.trendScore) : null,
          volumeScore: r.volumeScore != null ? Math.round(r.volumeScore) : null,
          momentumScore: r.momentumScore != null ? Math.round(r.momentumScore) : null,
          rsi14: rsi,
          fundingRate: funding,
          priceVsEma20Pct: ema20Pct,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        date: dataDate,
        recommendations: top,
      },
    });
  } catch (error) {
    console.error("[GET /api/dashboard/top-recommendations] Error:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch top recommendations" },
      { status: 500 }
    );
  }
}
