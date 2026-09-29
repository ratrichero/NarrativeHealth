// BT-01: Persist 6 picks của dashboard vào bảng top_recommendation_picks.
// Best-effort: lỗi ghi không bao giờ làm fail API dashboard; mọi lỗi log [BT-01].
import { db } from "@/db";
import {
  topRecommendationPicks,
  type NewTopRecommendationPick,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";

interface PersistPickInput {
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
