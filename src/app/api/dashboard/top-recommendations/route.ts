// Top Recommendations API — six directional opportunities for the dashboard
// (3 strongest coins → LONG, 3 weakest → SHORT)
// SQ-TOP-REC v2:
//  - ATR fallback: if the indicators table lacks ATR_14 for the data date
//    (timezone offset between pipelines, or indicator job not run yet), compute
//    ATR directly from market_price_daily so setups are always available.
//  - Directional selection (v3): 3 strongest coins → LONG + 3 weakest → SHORT.
//    When one side has fewer candidates, the remaining slots are filled from
//    the other side so the section still surfaces up to 6 directional picks.
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
import { persistTopPicks } from "@/lib/p6/refresh/persist-top-picks";

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
        // TOP-REC-DATE-FALLBACK: giá và chỉ báo PHẢI lấy bản ghi mới nhất
        // có ngày ≤ dataDate, KHÔNG được ghim cứng "= dataDate".
        // market_price_daily cố ý loại bỏ nến ngày đang chạy dở
        // (P6-DATA-02), nên nến gần nhất luôn là hôm qua trong khi
        // health/recommendations đã mang ngày hôm nay → nếu ghim `= dataDate`
        // thì currentPrice luôn NULL → mọi card mất setup và báo "không có dữ
        // liệu giá". Lấy DESC LIMIT 1 theo từng coin để chịu được cả case coin
        // thiếu nến riêng lẻ.
        closePrice: sql<string | null>`(
          SELECT p.close FROM market_price_daily p
          WHERE p.coin_id = ${coins.id} AND p.date <= ${dataDate}
          ORDER BY p.date DESC LIMIT 1
        )`,
        atr14: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date <= ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'ATR_14'
          ORDER BY i.date DESC LIMIT 1
        )`,
        ema20: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date <= ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'EMA_20'
          ORDER BY i.date DESC LIMIT 1
        )`,
        rsi14: sql<string | null>`(
          SELECT i.indicator_value FROM indicators i
          WHERE i.coin_id = ${coins.id} AND i.date <= ${dataDate}
            AND i.timeframe = '1d' AND i.indicator_type = 'RSI_14'
          ORDER BY i.date DESC LIMIT 1
        )`,
        fundingRate: sql<string | null>`(
          SELECT cm.funding_rate FROM coin_metrics cm
          WHERE cm.coin_id = ${coins.id} AND cm.date <= ${dataDate}
          ORDER BY cm.date DESC LIMIT 1
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

    // Selection: top 3 bullish (LONG) + top 3 bearish (SHORT).
    // TOP-REC-FILL: when the genuinely-bullish side has fewer than 3 coins
    // (e.g. a broad market drawdown where every signal is WEAK), the remaining
    // LONG slots are filled with the STRONGEST remaining coins by health —
    // displayed in the LONG group as relative strength, but WITHOUT a setup
    // and with an explicit no-trade reason (never a misleading LONG setup on
    // a WEAK signal). Same symmetric rule for SHORT.
    const LONG_TARGET = 3;
    const SHORT_TARGET = 3;

    interface Picked {
      entry: Scored;
      forced: null | "long" | "short";
    }
    const chosenIds = new Set<number>();
    const longPicks: Picked[] = [];
    const shortPicks: Picked[] = [];

    // LONG — genuinely bullish coins first
    for (const s of bullish) {
      if (longPicks.length >= LONG_TARGET) break;
      longPicks.push({ entry: s, forced: null });
      chosenIds.add(s.row.coinId);
    }
    // LONG — pad with strongest remaining coins (relative strength, no setup)
    if (longPicks.length < LONG_TARGET) {
      const strengthPool = [...scored]
        .filter((s) => !chosenIds.has(s.row.coinId))
        .sort((a, b) => (b.row.healthScore ?? 0) - (a.row.healthScore ?? 0));
      for (const s of strengthPool) {
        if (longPicks.length >= LONG_TARGET) break;
        longPicks.push({ entry: s, forced: "long" });
        chosenIds.add(s.row.coinId);
      }
    }

    // SHORT — genuinely bearish coins first (skip anything already picked LONG)
    for (const s of bearish) {
      if (shortPicks.length >= SHORT_TARGET) break;
      if (chosenIds.has(s.row.coinId)) continue;
      shortPicks.push({ entry: s, forced: null });
      chosenIds.add(s.row.coinId);
    }
    // SHORT — pad with weakest remaining coins by health (relative, no setup)
    if (shortPicks.length < SHORT_TARGET) {
      const weakPool = [...scored]
        .filter((s) => !chosenIds.has(s.row.coinId))
        .sort((a, b) => (a.row.healthScore ?? 0) - (b.row.healthScore ?? 0));
      for (const s of weakPool) {
        if (shortPicks.length >= SHORT_TARGET) break;
        shortPicks.push({ entry: s, forced: "short" });
        chosenIds.add(s.row.coinId);
      }
    }

    const selected: Picked[] = [...longPicks, ...shortPicks];

    // BT-01: forced (filler) picks have no setup and must not be scored as
    // genuine trades in backtests — remember which picks were forced.
    const pickKindByCoinId = new Map<number, string>();
    for (const p of selected) {
      if (p.forced) pickKindByCoinId.set(p.entry.row.coinId, p.forced);
    }

    const top: TopRecommendation[] = [];

    for (const pick of selected) {
      const s = pick.entry;
      const r = s.row;
      // Forced picks (padding) render under the group direction but never
      // carry a trade setup — their underlying signal contradicts it.
      const direction: SetupDirection =
        pick.forced === "long" ? "BULLISH" : pick.forced === "short" ? "BEARISH" : s.direction;
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

      const hasSetup = !pick.forced && price > 0 && atr !== null && atr > 0;
      let setupUnavailableReason: string | null = null;
      if (pick.forced === "long") {
        setupUnavailableReason =
          "Không vào LONG hôm nay — thị trường suy yếu toàn diện, coin mạnh nhất tương đối chỉ để theo dõi chờ đảo chiều.";
      } else if (pick.forced === "short") {
        setupUnavailableReason =
          "Không có setup SHORT — vùng lấp chỗ khi thiếu ứng viên yếu thật sự, chỉ theo dõi.";
      } else if (!hasSetup) {
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
        direction,
        reason:
          pick.forced === "long"
            ? `Sức khoẻ ${r.healthScore.toFixed(0)} điểm — mạnh nhất tương đối, nhưng tín hiệu ${r.signal ?? "OBSERVE"} chưa đủ điều kiện LONG. Theo dõi chờ tín hiệu phục hồi, không vào lệnh.`
            : pick.forced === "short"
              ? `Sức khoẻ ${r.healthScore.toFixed(0)} điểm — yếu nhất tương đối, nhưng chưa đủ điều kiện SHORT thực sự. Chỉ theo dõi.`
              : buildVietnameseReason(
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
        setup: hasSetup && atr !== null ? buildSetup(direction, price, atr) : null,
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

    // BT-01: persist the six picks (with setups) for later backtest —
    // best-effort, awaited before response; failure never breaks the API.
    try {
      await persistTopPicks(
        dataDate,
        top.map((t, i) => {
          const forcedRaw = pickKindByCoinId.get(t.coinId);
          const forcedKind =
            forcedRaw === "long"
              ? "FILL_LONG"
              : forcedRaw === "short"
                ? "FILL_SHORT"
                : "GENUINE";
          return {
            coinId: t.coinId,
            symbol: t.symbol,
            slot: i + 1,
            pickKind: forcedKind,
            direction: t.direction,
            signal: t.signal,
            healthScore: t.healthScore ?? null,
            scoreChange: t.scoreChange ?? null,
            currentPrice: t.currentPrice,
            hasSetup: t.setup !== null,
            entryLow: t.setup?.entryLow ?? null,
            entryHigh: t.setup?.entryHigh ?? null,
            entryMid:
              t.setup != null
                ? +(((t.setup.entryLow + t.setup.entryHigh) / 2).toFixed(6))
                : null,
            tp1: t.setup?.takeProfits[0]?.level ?? null,
            tp2: t.setup?.takeProfits[1]?.level ?? null,
            stopLoss: t.setup?.stopLoss ?? null,
            riskRewardRatio: t.setup?.riskRewardRatio ?? null,
            tp1MovePct: t.setup?.tp1MovePct ?? null,
            slRiskPct: t.setup?.slRiskPct ?? null,
            atr14: null, // atr khong co trong API shape; backtest suy lai tu gia
            atrSource: null,
            narrativeName: t.narrativeName,
            metrics: t.metrics as unknown as Record<string, unknown>,
            setupUnavailableReason: t.setupUnavailableReason,
          };
        })
      );
    } catch (e) {
      console.error("[BT-01] route persist failed:", e);
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
