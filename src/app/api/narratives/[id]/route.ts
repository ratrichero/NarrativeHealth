import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  narratives,
  narrativeHealth,
  coinNarratives,
  coins,
  healthScores,
  recommendations,
  features,
} from "@/db/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { getHealthStatus } from "@/lib/utils";
import { getLatestValidP3Intelligence } from "@/lib/services/p3-intelligence.service";
import { getP3IntelligenceHistory } from "@/lib/services/p3-intelligence-history.service";
import type { P3IntelligenceViewModel } from "@/lib/types/p3-intelligence";
import type { P3IntelligenceHistoryViewModel } from "@/lib/types/p3-intelligence-history";

export const dynamic = "force-dynamic";

// GET - Get narrative details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const narrativeId = parseInt(id);

    if (isNaN(narrativeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid narrative ID" },
        { status: 400 }
      );
    }

    // Get narrative
    const [narrative] = await db
      .select()
      .from(narratives)
      .where(eq(narratives.id, narrativeId))
      .limit(1);

    if (!narrative) {
      return NextResponse.json(
        { success: false, error: "Narrative not found" },
        { status: 404 }
      );
    }

    const today = new Date().toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

    // Get narrative health
    const [currentHealth] = await db
      .select()
      .from(narrativeHealth)
      .where(and(eq(narrativeHealth.narrativeId, narrativeId), eq(narrativeHealth.date, today)))
      .limit(1);

    // Get health history
    const healthHistory = await db
      .select({
        date: narrativeHealth.date,
        score: narrativeHealth.healthScore,
      })
      .from(narrativeHealth)
      .where(
        and(eq(narrativeHealth.narrativeId, narrativeId), gte(narrativeHealth.date, thirtyDaysAgo))
      )
      .orderBy(narrativeHealth.date);

    // Get coins in this narrative with their health data
    const coinsInNarrative = await db
      .select({
        coinId: coinNarratives.coinId,
        isPrimary: coinNarratives.isPrimary,
        symbol: coins.symbol,
        name: coins.name,
      })
      .from(coinNarratives)
      .innerJoin(coins, eq(coins.id, coinNarratives.coinId))
      .where(and(eq(coinNarratives.narrativeId, narrativeId), eq(coins.isActive, true)));

    const coinDetails = await Promise.all(
      coinsInNarrative.map(async (coin) => {
        const [health] = await db
          .select()
          .from(healthScores)
          .where(and(eq(healthScores.coinId, coin.coinId), eq(healthScores.date, today)))
          .limit(1);

        const [rec] = await db
          .select()
          .from(recommendations)
          .where(and(eq(recommendations.coinId, coin.coinId), eq(recommendations.date, today)))
          .limit(1);

        const [feature] = await db
          .select()
          .from(features)
          .where(and(eq(features.coinId, coin.coinId), eq(features.date, today)))
          .orderBy(desc(features.createdAt))
          .limit(1);

        return {
          id: coin.coinId,
          symbol: coin.symbol,
          name: coin.name,
          healthScore: health?.healthScore || 50,
          scoreChange: health?.scoreChange || null,
          status: getHealthStatus(health?.healthScore || 50),
          signal: rec?.signal || "OBSERVE",
          reason: rec?.reason || "",
          confidenceScore: feature?.confidenceScore || null,
          trendScore: feature?.trendScore || null,
          derivativeScore: feature?.derivativeScore || null,
          volumeScore: feature?.volumeScore || null,
          momentumScore: feature?.momentumScore || null,
        };
      })
    );

    // Sort by health score descending
    coinDetails.sort((a, b) => b.healthScore - a.healthScore);

    // Read-only P3 Intelligence (latest VALID artifact). A P3 read failure
    // must never take down the narrative page — degrade to null instead.
    let p3Intelligence: P3IntelligenceViewModel | null = null;
    try {
      p3Intelligence = await getLatestValidP3Intelligence(narrativeId);
    } catch (error) {
      console.error("P3 Intelligence read failed:", error);
    }

    // Read-only P3 Historical Intelligence (same-identity series + trend).
    // Same degradation contract: any failure yields null, never a 500.
    let p3IntelligenceHistory: P3IntelligenceHistoryViewModel | null = null;
    try {
      p3IntelligenceHistory = await getP3IntelligenceHistory(narrativeId);
    } catch (error) {
      console.error("P3 Intelligence History read failed:", error);
    }

    return NextResponse.json({
      success: true,
      data: {
        id: narrative.id,
        name: narrative.name,
        description: narrative.description,
        isActive: narrative.isActive,
        healthScore: currentHealth?.healthScore || 50,
        previousScore: currentHealth?.previousScore || null,
        scoreChange: currentHealth?.scoreChange || null,
        status: getHealthStatus(currentHealth?.healthScore || 50),
        avgConfidence: currentHealth?.avgConfidence || null,
        narrativeHealth: currentHealth ? {
          weightingMethod: currentHealth.weightingMethod,
          weightDetails: currentHealth.weightDetails,
        } : null,
        coins: coinDetails,
        healthHistory: healthHistory.map((h) => ({
          date: h.date,
          score: h.score,
        })),
        p3Intelligence,
        p3IntelligenceHistory,
      },
    });
  } catch (error) {
    console.error("Error fetching narrative:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch narrative" },
      { status: 500 }
    );
  }
}

// PUT - Update narrative
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const narrativeId = parseInt(id);
    const body = await request.json();
    const { name, description, isActive } = body;

    if (isNaN(narrativeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid narrative ID" },
        { status: 400 }
      );
    }

    const updateData: Partial<{
      name: string;
      description: string | null;
      isActive: boolean;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    const [updated] = await db
      .update(narratives)
      .set(updateData)
      .where(eq(narratives.id, narrativeId))
      .returning();

    if (!updated) {
      return NextResponse.json(
        { success: false, error: "Narrative not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error("Error updating narrative:", error);
    return NextResponse.json(
      { success: false, error: "Failed to update narrative" },
      { status: 500 }
    );
  }
}

// DELETE - Delete narrative
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const narrativeId = parseInt(id);

    if (isNaN(narrativeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid narrative ID" },
        { status: 400 }
      );
    }

    const [deleted] = await db
      .delete(narratives)
      .where(eq(narratives.id, narrativeId))
      .returning();

    if (!deleted) {
      return NextResponse.json(
        { success: false, error: "Narrative not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("Error deleting narrative:", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete narrative" },
      { status: 500 }
    );
  }
}
