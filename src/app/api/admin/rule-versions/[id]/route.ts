import { NextRequest, NextResponse } from "next/server";
import { ruleVersionService } from "@/lib/services/rule-version.service";

export const dynamic = "force-dynamic";

// GET - Get a specific rule version by version number
export async function GET(
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

    const version = await ruleVersionService.getVersionByVersionNumber(versionNumber);

    if (!version) {
      return NextResponse.json(
        { success: false, error: "Rule version not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: version });
  } catch (error) {
    console.error("[GET /api/admin/rule-versions/[id]]", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch rule version" },
      { status: 500 }
    );
  }
}