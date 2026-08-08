import { NextRequest, NextResponse } from "next/server";
import { indicatorService } from "@/lib/services/indicator.service";
import { db } from "@/db";
import { coins } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ coinId: string }> }
) {
  try {
    const { coinId } = await params;
    const id = parseInt(coinId);
    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, error: "Invalid coin ID" },
        { status: 400 }
      );
    }

    const [coin] = await db.select().from(coins).where(eq(coins.id, id)).limit(1);
    if (!coin) {
      return NextResponse.json(
        { success: false, error: "Coin not found" },
        { status: 404 }
      );
    }

    const date = request.nextUrl.searchParams.get("date");
    const timeframe = request.nextUrl.searchParams.get("timeframe") || undefined;

    if (!date) {
      return NextResponse.json(
        { success: false, error: "Missing date parameter (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const data = await indicatorService.getIndicators(id, date, timeframe);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[GET /api/indicators/[coinId]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch indicators" },
      { status: 500 }
    );
  }
}
