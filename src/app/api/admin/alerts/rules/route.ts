import { NextRequest, NextResponse } from "next/server";
import { alertService } from "@/lib/services/alert.service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rules = await alertService.getActiveRules();
    return NextResponse.json({ success: true, data: rules });
  } catch (error) {
    console.error("[GET /api/admin/alerts/rules]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch alert rules" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rule = await alertService.createRule(body);
    return NextResponse.json({ success: true, data: rule }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/alerts/rules]", error);
    return NextResponse.json(
      { success: false, error: "Failed to create alert rule" },
      { status: 500 }
    );
  }
}
