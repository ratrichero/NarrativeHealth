import { NextRequest, NextResponse } from "next/server";
import { alertService } from "@/lib/services/alert.service";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const historyId = parseInt(id);
    const body = await request.json();
    const acknowledgedBy = body.acknowledgedBy || "admin";

    await alertService.acknowledgeAlert(historyId, acknowledgedBy);

    return NextResponse.json({ success: true, data: { acknowledged: true } });
  } catch (error) {
    console.error("[POST /api/admin/alerts/[id]/acknowledge]", error);
    return NextResponse.json(
      { success: false, error: "Failed to acknowledge alert" },
      { status: 500 }
    );
  }
}
