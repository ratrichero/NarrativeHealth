import { NextRequest, NextResponse } from "next/server";
import { healthTimelineService } from "@/lib/services/health-timeline.service";

export const dynamic = "force-dynamic";

// GET - Coin health timeline with trend analysis
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate coin ID
    const coinId = parseInt(id);
    if (isNaN(coinId) || coinId <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid coin ID" },
        { status: 400 }
      );
    }

    // Parse and cap days parameter
    const daysParam = request.nextUrl.searchParams.get("days");
    const days = daysParam
      ? Math.min(Math.max(parseInt(daysParam) || 30, 1), 90)
      : 30;

    const timeline = await healthTimelineService.getCoinTimeline(coinId, days);

    return NextResponse.json({ success: true, data: timeline });
  } catch (error) {
    console.error("[GET /api/coins/[id]/health-timeline]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch health timeline" },
      { status: 500 }
    );
  }
}