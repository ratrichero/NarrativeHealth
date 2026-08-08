import { NextRequest, NextResponse } from "next/server";
import { snapshotService } from "@/lib/services/snapshot.service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await params;
    const snapshot = await snapshotService.getSnapshotByDate(date);

    if (!snapshot) {
      return NextResponse.json(
        { success: false, error: "Snapshot not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: snapshot.coins });
  } catch (error) {
    console.error("[GET /api/snapshots/[date]/coins]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch snapshot coins" },
      { status: 500 }
    );
  }
}
