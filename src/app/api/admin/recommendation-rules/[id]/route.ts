import { NextRequest, NextResponse } from "next/server";
import { ruleEngineService } from "@/lib/services/rule-engine.service";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ruleId = parseInt(id);
    if (isNaN(ruleId)) {
      return NextResponse.json(
        { success: false, error: "Invalid rule ID" },
        { status: 400 }
      );
    }

    const body = await request.json();
    const updates: any = {};

    if (body.priority !== undefined) updates.priority = Number(body.priority);
    if (body.signal !== undefined) updates.signal = String(body.signal);
    if (body.logicOperator !== undefined) updates.logicOperator = String(body.logicOperator);
    if (body.conditions !== undefined) updates.conditions = body.conditions;
    if (body.reasonTemplate !== undefined) updates.reasonTemplate = String(body.reasonTemplate);

    const rule = await ruleEngineService.updateRule(ruleId, updates);

    return NextResponse.json({ success: true, data: rule });
  } catch (error) {
    console.error("[PUT /api/admin/recommendation-rules/[id]]", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: message.includes("not found") ? 404 : 422 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const ruleId = parseInt(id);
    if (isNaN(ruleId)) {
      return NextResponse.json(
        { success: false, error: "Invalid rule ID" },
        { status: 400 }
      );
    }

    await ruleEngineService.deactivateRule(ruleId);

    return NextResponse.json({ success: true, data: { deactivated: true } });
  } catch (error) {
    console.error("[DELETE /api/admin/recommendation-rules/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to deactivate rule" },
      { status: 500 }
    );
  }
}
