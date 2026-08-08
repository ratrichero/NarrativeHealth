import { NextRequest, NextResponse } from "next/server";
import { correlationService } from "@/lib/services/correlation.service";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const narrativeId = parseInt(id);
    const days = parseInt(request.nextUrl.searchParams.get("days") || "30");

    const matrix = await correlationService.getCorrelationMatrix(narrativeId, days);

    return NextResponse.json({ success: true, data: matrix });
  } catch (error) {
    console.error("[GET /api/narratives/[id]/correlations]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch correlations" },
      { status: 500 }
    );
  }
}
