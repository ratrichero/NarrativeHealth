import { NextRequest, NextResponse } from "next/server";
import { snapshotService } from "@/lib/services/snapshot.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "30"), 90);

    const data = await snapshotService.getSnapshotHistory(limit);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error("[GET /api/snapshots]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch snapshots" },
      { status: 500 }
    );
  }
}
