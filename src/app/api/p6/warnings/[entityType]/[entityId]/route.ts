/**
 * P6-07D — Entity Warnings API Route
 *
 * PD-07A-02: Read-only GET endpoint for P6-05 warning occurrences.
 * PV-03: Read-only — no mutation.
 * PV-06: Returns only active (CURRENT) warnings.
 */

import { NextRequest, NextResponse } from "next/server";
import { readEntityWarnings } from "@/lib/p6/presentation";
import type { P6ApiResponse, WarningDTO } from "@/lib/p6/presentation";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; entityId: string }> }
): Promise<NextResponse<P6ApiResponse<readonly WarningDTO[]>>> {
  try {
    const { entityType, entityId } = await params;

    if (entityType !== "coin" && entityType !== "narrative") {
      return NextResponse.json(
        { success: false, data: null, error: "Invalid entity type" },
        { status: 400 }
      );
    }

    const id = parseInt(entityId, 10);
    if (isNaN(id)) {
      return NextResponse.json(
        { success: false, data: null, error: "Invalid entity ID" },
        { status: 400 }
      );
    }

    const warnings = await readEntityWarnings(entityType, id);

    return NextResponse.json({
      success: true,
      data: warnings,
      meta: {
        entity_type: entityType,
        entity_id: id,
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
