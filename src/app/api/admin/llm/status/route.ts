/**
 * LLM-01 — Admin: LLM health snapshot for the "LLM Monitor" admin tab.
 *
 * Two live views (no DB on the hot path — the dev database round-trip made
 * an early DB-backed version of this endpoint take 2.5min):
 *  1. Live call outcomes (in-memory ring buffer, both square + chat chains).
 *  2. Google key pool state (rotation + cooldowns, GKEY-01).
 *
 * The long-term llm/template ratio stays available from the existing
 * /api/admin/square/analytics endpoint; the UI links there instead of
 * duplicating the aggregation here.
 *
 * Read-only; admin middleware guards the route.
 */

import { NextResponse } from "next/server";
import { llmOutcomeSnapshot, llmTierStats } from "@/lib/llm/monitor";
import { googlePoolStats } from "@/lib/llm/google-key-pool";
import { detectLlmStorms, llmTelemetrySnapshot } from "@/lib/llm/telemetry";
import { budgetStats } from "@/lib/llm/budget";
import { capabilitiesSnapshot } from "@/lib/llm/capabilities";
import { canarySnapshot } from "@/lib/llm/canary";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const telemetry = await llmTelemetrySnapshot();
    return NextResponse.json({
      success: true,
      data: {
        live: llmOutcomeSnapshot(),
        tiers: llmTierStats(),
        googlePool: googlePoolStats(),
        telemetry,
        alerts: detectLlmStorms(telemetry.buckets),
        budget: budgetStats(),
        capabilities: capabilitiesSnapshot(),
        canary: canarySnapshot(),
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/llm/status]", error);
    return NextResponse.json(
      { success: false, error: "Failed to read LLM status." },
      { status: 500 }
    );
  }
}
