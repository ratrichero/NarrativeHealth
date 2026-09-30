// BT-01 + BT-04: Persist 6 picks của dashboard vào bảng top_recommendation_picks
// với episode dedup: refresh chạy sát nhau thường sinh CÙNG MỘT setup cho cùng
// coin (giá/ATR không đổi đáng kể) — khi đó KHÔNG tạo row backtest mới, chỉ bump
// repeat_count/last_repeat_at trên row gốc của episode (backtest dùng data_date
// lần đầu). Setup thay đổi thật (đổi hướng hoặc levels vượt ngưỡng) → episode
// mới, row riêng.
//
// Best-effort: lỗi ghi không bao giờ làm fail API dashboard; mọi lỗi log [BT-01].

import { db } from "@/db";
import {
  topRecommendationPicks,
  type NewTopRecommendationPick,
} from "@/db/schema";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { isSameSetupEpisode } from "@/lib/backtest/engine";

export interface PersistPickInput {
  coinId: number;
  symbol: string;
  slot: number; // 1-3 LONG, 4-6 SHORT
  pickKind: "GENUINE" | "FILL_LONG" | "FILL_SHORT";
  direction: "BULLISH" | "BEARISH";
  signal: string;
  healthScore: number | null;
  scoreChange: number | null;
  currentPrice: number;
  hasSetup: boolean;
  entryLow: number | null;
  entryHigh: number | null;
  entryMid: number | null;
  tp1: number | null;
  tp2: number | null;
  stopLoss: number | null;
  riskRewardRatio: number | null;
  tp1MovePct: number | null;
  slRiskPct: number | null;
  atr14: number | null;
  atrSource: string | null;
  narrativeName: string | null;
  metrics: Record<string, unknown>;
  setupUnavailableReason: string | null;
}

const round6 = (n: number) => +n.toFixed(6);

export async function persistTopPicks(
  dataDate: string,
  picks: PersistPickInput[]
): Promise<void> {
  try {
    for (const p of picks) {
      // ── BT-04: find the coin's latest pick still in its episode window ──
      // (PENDING hoặc EVALUATED chưa quá 7 ngày — episode kết thúc khi pick
      // bị EXPIRED/SKIPPED hoặc quá 7 ngày không lặp).
      // Episode window: 7 ngày — nếu pick gần nhất cũ hơn mà chưa được chốt
      // (backtest chưa chạy), episode cũ coi như kết thúc; pick mới là episode
      // mới (tránh bump vô hạn trên row cổ).
      const episodeCutoff = new Date(
        new Date(dataDate + "T00:00:00Z").getTime() - 7 * 86400_000
      ).toISOString().slice(0, 10);

      const [prev] = await db
        .select({
          id: topRecommendationPicks.id,
          dataDate: topRecommendationPicks.dataDate,
          direction: topRecommendationPicks.direction,
          hasSetup: topRecommendationPicks.hasSetup,
          entryLow: topRecommendationPicks.entryLow,
          entryHigh: topRecommendationPicks.entryHigh,
          entryMid: topRecommendationPicks.entryMid,
          tp1: topRecommendationPicks.tp1,
          tp2: topRecommendationPicks.tp2,
          stopLoss: topRecommendationPicks.stopLoss,
          backtestStatus: topRecommendationPicks.backtestStatus,
        })
        .from(topRecommendationPicks)
        .where(
          and(
            eq(topRecommendationPicks.coinId, p.coinId),
            ne(topRecommendationPicks.backtestStatus, "SKIPPED"),
            ne(topRecommendationPicks.backtestStatus, "EXPIRED"),
            gte(topRecommendationPicks.dataDate, episodeCutoff)
          )
        )
        .orderBy(desc(topRecommendationPicks.dataDate), desc(topRecommendationPicks.id))
        .limit(1);

      if (prev && isSameSetupEpisode(prev, p)) {
        // Cùng episode — KHÔNG insert row mới; bump counter trên row gốc
        // (data_date giữ nguyên = ngày đầu setup xuất hiện → backtest dùng
        // ngày đầu, các refresh lặp sau không tạo bản ghi backtest trùng).
        await db
          .update(topRecommendationPicks)
          .set({
            repeatCount: sql`${topRecommendationPicks.repeatCount} + 1`,
            lastRepeatAt: new Date(),
          })
          .where(eq(topRecommendationPicks.id, prev.id));
        continue;
      }

      const row: NewTopRecommendationPick = {
        dataDate,
        coinId: p.coinId,
        symbol: p.symbol,
        slot: p.slot,
        pickKind: p.pickKind,
        direction: p.direction,
        signal: p.signal,
        healthScore: p.healthScore,
        scoreChange: p.scoreChange,
        currentPrice: p.currentPrice > 0 ? String(round6(p.currentPrice)) : null,
        hasSetup: p.hasSetup,
        entryLow: p.entryLow != null ? String(round6(p.entryLow)) : null,
        entryHigh: p.entryHigh != null ? String(round6(p.entryHigh)) : null,
        entryMid: p.entryMid != null ? String(round6(p.entryMid)) : null,
        tp1: p.tp1 != null ? String(round6(p.tp1)) : null,
        tp2: p.tp2 != null ? String(round6(p.tp2)) : null,
        stopLoss: p.stopLoss != null ? String(round6(p.stopLoss)) : null,
        riskRewardRatio: p.riskRewardRatio,
        tp1MovePct: p.tp1MovePct,
        slRiskPct: p.slRiskPct,
        atr14: p.atr14 != null ? String(round6(p.atr14)) : null,
        atrSource: p.atrSource,
        narrativeName: p.narrativeName,
        metrics: p.metrics,
        setupUnavailableReason: p.setupUnavailableReason,
        updatedAt: new Date(),
      };

      await db
        .insert(topRecommendationPicks)
        .values(row)
        .onConflictDoUpdate({
          target: [topRecommendationPicks.dataDate, topRecommendationPicks.coinId],
          set: {
            symbol: row.symbol,
            slot: row.slot,
            pickKind: row.pickKind,
            direction: row.direction,
            signal: row.signal,
            healthScore: row.healthScore,
            scoreChange: row.scoreChange,
            currentPrice: row.currentPrice,
            hasSetup: row.hasSetup,
            entryLow: row.entryLow,
            entryHigh: row.entryHigh,
            entryMid: row.entryMid,
            tp1: row.tp1,
            tp2: row.tp2,
            stopLoss: row.stopLoss,
            riskRewardRatio: row.riskRewardRatio,
            tp1MovePct: row.tp1MovePct,
            slRiskPct: row.slRiskPct,
            atr14: row.atr14,
            atrSource: row.atrSource,
            narrativeName: row.narrativeName,
            metrics: row.metrics,
            setupUnavailableReason: row.setupUnavailableReason,
            updatedAt: new Date(),
          },
          // Idempotent no-op khi dữ liệu không đổi (không đốt updated_at).
          setWhere: and(
            eq(topRecommendationPicks.slot, p.slot),
            eq(topRecommendationPicks.pickKind, p.pickKind),
            eq(topRecommendationPicks.hasSetup, p.hasSetup)
          ),
        });
    }
  } catch (err) {
    console.error("[BT-01] persistTopPicks failed:", err);
  }
}
