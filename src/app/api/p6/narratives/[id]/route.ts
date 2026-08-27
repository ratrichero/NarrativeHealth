/**
 * P6-07D — Narrative Intelligence API Route
 *
 * PD-07A-02: Read-only GET endpoint exposing P6-native artifacts.
 * PV-03: Read-only — no mutation.
 * PV-05: Identity matches P6 artifact identity.
 * PV-06: Returns only CURRENT lifecycle artifacts.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { narratives } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readNarrativeIntelligence } from "@/lib/p6/presentation";
import type { P6ApiResponse, NarrativeIntelligenceDTO } from "@/lib/p6/presentation";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<P6ApiResponse<NarrativeIntelligenceDTO>>> {
  try {
    const { id } = await params;
    const narrativeId = parseInt(id, 10);

    if (isNaN(narrativeId)) {
      return NextResponse.json(
        { success: false, data: null, error: "Invalid narrative ID" },
        { status: 400 }
      );
    }

    // Verify entity exists
    const [narrative] = await db
      .select({ id: narratives.id, name: narratives.name })
      .from(narratives)
      .where(eq(narratives.id, narrativeId))
      .limit(1);

    if (!narrative) {
      return NextResponse.json(
        { success: false, data: null, error: "Narrative not found" },
        { status: 404 }
      );
    }

    const intelligence = await readNarrativeIntelligence(narrativeId, narrative.name);

    return NextResponse.json({
      success: true,
      data: intelligence,
      meta: {
        entity_type: "narrative",
        entity_id: narrativeId,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
