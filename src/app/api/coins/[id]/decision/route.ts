import { NextRequest, NextResponse } from "next/server";
import { decisionEngineService } from "@/lib/services/decision-engine.service";
import { eventRiskService } from "@/lib/services/event-risk.service";
import { db } from "@/db";
import { coins, healthScores } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const coinId = parseInt(id);

    const date = request.nextUrl.searchParams.get("date");
    if (!date) {
      return NextResponse.json(
        { success: false, error: "Missing date parameter" },
        { status: 400 }
      );
    }

    const [coin] = await db.select().from(coins).where(eq(coins.id, coinId)).limit(1);
    if (!coin) {
      return NextResponse.json(
        { success: false, error: "Coin not found" },
        { status: 404 }
      );
    }

    const [healthScore] = await db
      .select()
      .from(healthScores)
      .where(and(eq(healthScores.coinId, coinId), eq(healthScores.date, date)))
      .limit(1);

    if (!healthScore) {
      return NextResponse.json(
        { success: false, error: "Health score not found for this date" },
        { status: 404 }
      );
    }

    const healthScoreValue = typeof healthScore.healthScore === 'number' ? healthScore.healthScore : parseFloat(healthScore.healthScore as any);

    const eventRisk = await eventRiskService.getCoinEventRiskScore(coinId, date);
    const correlationRisk = 0;

    const decision = await decisionEngineService.calculateDecisionSignal({
      coinId,
      date,
      healthScore: healthScoreValue,
      eventRiskScore: eventRisk.eventRiskScore,
      correlationRisk,
    });

    return NextResponse.json({
      success: true,
      data: {
        coinId,
        date,
        baseHealth: healthScoreValue,
        eventRiskScore: eventRisk.eventRiskScore,
        correlationRisk,
        adjustedScore: decision.adjustedScore,
        adjustmentReason: decision.adjustmentReason,
        activeEvents: eventRisk.activeEvents,
      },
    });
  } catch (error) {
    console.error("[GET /api/coins/[id]/decision]", error);
    return NextResponse.json(
      { success: false, error: "Failed to calculate decision signal" },
      { status: 500 }
    );
  }
}
