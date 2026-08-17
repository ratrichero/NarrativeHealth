import { NextRequest, NextResponse } from "next/server";
import { actionReadService } from "@/lib/p5/read/action-read.service";

export const dynamic = "force-dynamic";

/**
 * P5-06B — READ-ONLY P5 decision lookup by stable decision identity
 * (P5-02 AD-013).
 *
 * Semantics (P5-06 §16): an unknown decisionId returns HTTP 404 with an
 * explicit `availability: "DECISION_NOT_FOUND"` body. A 404 here is a
 * lookup miss — it is NEVER a domain NO_ACTION and never a silent
 * substitute for unavailable data.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ decisionId: string }> }
) {
  try {
    const { decisionId } = await params;

    if (typeof decisionId !== "string" || decisionId.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: "Invalid decision ID" },
        { status: 400 }
      );
    }

    const view = await actionReadService.getDecisionByDecisionId(decisionId);

    if (view.decisionPresence === "ABSENT") {
      return NextResponse.json(
        {
          success: false,
          error: "Decision not found",
          availability: view.availability,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: { p5ActionDecision: view },
    });
  } catch (error) {
    console.error("P5 Action Decision lookup failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read P5 action decision" },
      { status: 500 }
    );
  }
}
