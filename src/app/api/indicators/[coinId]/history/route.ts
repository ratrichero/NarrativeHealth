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

    const days = parseInt(request.nextUrl.searchParams.get("days") || "30");
    const type = request.nextUrl.searchParams.get("type");

    if (!type) {
      return NextResponse.json(
        { success: false, error: "Missing type parameter (indicator_type)" },
        { status: 400 }
      );
    }

    const data = await indicatorService.getIndicatorHistory(id, type, days);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[GET /api/indicators/[coinId]/history]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch indicator history" },
      { status: 500 }
    );
  }
}
