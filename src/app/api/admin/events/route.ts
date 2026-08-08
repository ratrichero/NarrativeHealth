import { NextRequest, NextResponse } from "next/server";
import { eventRiskService } from "@/lib/services/event-risk.service";
import type { NewEventRisk } from "@/lib/types/event-risk";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const input: NewEventRisk = {
      coinId: body.coinId ?? null,
      narrativeId: body.narrativeId ?? null,
      eventType: body.eventType,
      eventDate: body.eventDate,
      riskLevel: body.riskLevel,
      riskScore: body.riskScore ?? null,
      title: body.title,
      description: body.description ?? null,
      sourceUrl: body.sourceUrl ?? null,
      isActive: body.isActive ?? true,
      expiresAt: body.expiresAt ?? null,
    };

    const risk = await eventRiskService.create(input);

    return NextResponse.json({ success: true, data: risk }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/admin/events]", error);
    return NextResponse.json(
      { success: false, error: "Failed to create event risk" },
      { status: 500 }
    );
  }
}
