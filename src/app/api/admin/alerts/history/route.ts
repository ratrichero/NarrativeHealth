import { NextRequest, NextResponse } from "next/server";
import { alertService } from "@/lib/services/alert.service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const history = await alertService.getRuleHistory(50);
    return NextResponse.json({ success: true, data: history });
  } catch (error) {
    console.error("[GET /api/admin/alerts/history]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch alert history" },
      { status: 500 }
    );
  }
}
