import { NextRequest, NextResponse } from "next/server";
import { eventRiskService } from "@/lib/services/event-risk.service";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const eventId = parseInt(id);

    const body = await request.json();
    const updates: any = {};

    if (body.coinId !== undefined) updates.coinId = body.coinId;
    if (body.narrativeId !== undefined) updates.narrativeId = body.narrativeId;
    if (body.eventType) updates.eventType = body.eventType;
    if (body.eventDate) updates.eventDate = body.eventDate;
    if (body.riskLevel) updates.riskLevel = body.riskLevel;
    if (body.riskScore !== undefined) updates.riskScore = body.riskScore;
    if (body.title) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.sourceUrl !== undefined) updates.sourceUrl = body.sourceUrl;
    if (body.isActive !== undefined) updates.isActive = body.isActive;
    if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt;

    const risk = await eventRiskService.update(eventId, updates);

    return NextResponse.json({ success: true, data: risk });
  } catch (error) {
    console.error("[PUT /api/admin/events/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to update event risk" },
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
    const eventId = parseInt(id);

    await eventRiskService.deactivate(eventId);

    return NextResponse.json({ success: true, data: { deactivated: true } });
  } catch (error) {
    console.error("[DELETE /api/admin/events/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to deactivate event risk" },
      { status: 500 }
    );
  }
}
