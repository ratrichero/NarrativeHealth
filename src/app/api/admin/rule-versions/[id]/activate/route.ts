import { NextRequest, NextResponse } from "next/server";
import { ruleVersionService } from "@/lib/services/rule-version.service";

export const dynamic = "force-dynamic";

// POST - Activate a specific rule version by version number
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const versionNumber = parseInt(id);
    if (isNaN(versionNumber) || versionNumber <= 0) {
      return NextResponse.json(
        { success: false, error: "Invalid rule version ID" },
        { status: 400 }
      );
    }

    // Check if version exists first (activate throws Error if not found)
    const existing = await ruleVersionService.getVersionByVersionNumber(versionNumber);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Rule version not found" },
        { status: 404 }
      );
    }

    // Activate the version (atomic transaction)
    await ruleVersionService.activate(existing.id);

    // Fetch updated version to get activatedAt timestamp
    const updated = await ruleVersionService.getVersionById(existing.id);

    return NextResponse.json({
      success: true,
      data: {
        activated: true,
        version: updated?.version ?? existing.version,
        activatedAt: updated?.activatedAt?.toISOString() ?? new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("[POST /api/admin/rule-versions/[id]/activate]", error);

    const message = error instanceof Error ? error.message : "Unknown error";

    // Version not found → 404
    if (message.includes("not found")) {
      return NextResponse.json(
        { success: false, error: message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { success: false, error: "Failed to activate rule version" },
      { status: 500 }
    );
  }
}