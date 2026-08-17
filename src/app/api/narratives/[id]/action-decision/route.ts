import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { narratives } from "@/db/schema";
import { eq } from "drizzle-orm";
import { actionReadService } from "@/lib/p5/read/action-read.service";

export const dynamic = "force-dynamic";

/**
 * P5-06B — READ-ONLY P5 Action Decision view for a narrative.
 *
 * Additive route: does not touch the existing narrative route (P3/P4 data
 * flow is unchanged). Exposes the P5-06A read view model
 * (`data.p5ActionDecision`) to the UI and future consumers.
 *
 * Semantics (P5-06 §5, §16):
 *  - the response body carries the decision read view including the
 *    `availability` field — absence / P4-unavailability / service failure are
 *    explicit states, NEVER NO_ACTION;
 *  - no policy/safety/approval/execution logic exists in this route;
 *  - read-only: GET only, no mutation endpoint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const narrativeId = parseInt(id);

    if (isNaN(narrativeId)) {
      return NextResponse.json(
        { success: false, error: "Invalid narrative ID" },
        { status: 400 }
      );
    }

    // Consistent with the repository narrative-route convention: unknown
    // subjects are 404 — this is "decision not found for a known subject",
    // never a domain NO_ACTION.
    const [narrative] = await db
      .select({ id: narratives.id })
      .from(narratives)
      .where(eq(narratives.id, narrativeId))
      .limit(1);

    if (!narrative) {
      return NextResponse.json(
        { success: false, error: "Narrative not found" },
        { status: 404 }
      );
    }

    const view = await actionReadService.getNarrativeActionReadView(narrativeId);

    return NextResponse.json({
      success: true,
      data: { p5ActionDecision: view },
    });
  } catch (error) {
    console.error("P5 Action Decision read failed:", error);
    return NextResponse.json(
      { success: false, error: "Failed to read P5 action decision" },
      { status: 500 }
    );
  }
}
