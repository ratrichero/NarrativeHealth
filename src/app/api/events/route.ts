import { NextRequest, NextResponse } from "next/server";
import { eventRiskService } from "@/lib/services/event-risk.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const coinId = request.nextUrl.searchParams.get("coinId");
    const narrativeId = request.nextUrl.searchParams.get("narrativeId");
    const active = request.nextUrl.searchParams.get("active") !== "false";

    const coinIdNum = coinId ? parseInt(coinId) : undefined;
    const narrativeIdNum = narrativeId ? parseInt(narrativeId) : undefined;

    const events = await eventRiskService.getActiveEvents(coinIdNum, narrativeIdNum);

    return NextResponse.json({ success: true, data: events });
  } catch (error) {
    console.error("[GET /api/events]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}
