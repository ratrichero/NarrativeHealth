/**
 * P6-07D — Coin Intelligence API Route
 *
 * PD-07A-02: Read-only GET endpoint exposing P6-native artifacts.
 * PV-03: Read-only — no mutation.
 * PV-05: Identity matches P6 artifact identity.
 * PV-06: Returns only CURRENT lifecycle artifacts.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { coins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readCoinIntelligence } from "@/lib/p6/presentation";
import type { P6ApiResponse, CoinIntelligenceDTO } from "@/lib/p6/presentation";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<P6ApiResponse<CoinIntelligenceDTO>>> {
  try {
    const { id } = await params;
    const coinId = parseInt(id, 10);

    if (isNaN(coinId)) {
      return NextResponse.json(
        { success: false, data: null, error: "Invalid coin ID" },
        { status: 400 }
      );
    }

    // Verify entity exists
    const [coin] = await db
      .select({ id: coins.id, symbol: coins.symbol })
      .from(coins)
      .where(eq(coins.id, coinId))
      .limit(1);

    if (!coin) {
      return NextResponse.json(
        { success: false, data: null, error: "Coin not found" },
        { status: 404 }
      );
    }

    const intelligence = await readCoinIntelligence(coinId, coin.symbol);

    return NextResponse.json({
      success: true,
      data: intelligence,
      meta: {
        entity_type: "coin",
        entity_id: coinId,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
