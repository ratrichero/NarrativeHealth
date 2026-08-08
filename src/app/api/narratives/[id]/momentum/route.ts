import { NextRequest, NextResponse } from "next/server";
import { momentumService } from "@/lib/services/momentum.service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const narrativeId = parseInt(id);
    const days = parseInt(request.nextUrl.searchParams.get("days") || "30");

    const momentum = await momentumService.getMomentumHistory(narrativeId, days);

    return NextResponse.json({ success: true, data: momentum });
  } catch (error) {
    console.error("[GET /api/narratives/[id]/momentum]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch momentum" },
      { status: 500 }
    );
  }
}
