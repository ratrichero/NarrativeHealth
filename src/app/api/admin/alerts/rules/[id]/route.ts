import { NextRequest, NextResponse } from "next/server";
import { alertService } from "@/lib/services/alert.service";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const rule = await alertService.updateRule(Number(id), body);
    return NextResponse.json({ success: true, data: rule });
  } catch (error) {
    console.error("[PUT /api/admin/alerts/rules/:id]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update alert rule" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await alertService.deactivateRule(Number(id));
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    console.error("[DELETE /api/admin/alerts/rules/:id]", error);
    return NextResponse.json(
      { success: false, error: "Failed to delete alert rule" },
      { status: 500 }
    );
  }
}
