/**
 * LLM-01 — Admin: LLM health snapshot for the "LLM Monitor" admin tab.
 *
 * Two live views (no DB on the hot path — the dev database round-trip made
 * an early DB-backed version of this endpoint take 2.5min):
 *  1. Live call outcomes (in-memory ring buffer, both square + chat chains).
 *  2. Google key pool state (rotation + cooldowns, GKEY-01).
 *
 * LLM-TRACE-01 adds recent per-turn traces; LLM-BREAKER-01 the persisted
 * breakers; LLM-COST-01 today's USD estimate; LLM-TELEMETRY-02 the hourly
 * latency series behind the admin charts.
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
import {
  detectLlmStorms,
  llmTelemetrySnapshot,
  telemetrySeries,
} from "@/lib/llm/telemetry";
import { budgetStats } from "@/lib/llm/budget";
import { capabilitiesSnapshot } from "@/lib/llm/capabilities";
import { canarySnapshot } from "@/lib/llm/canary";
import { breakerSnapshot, hydrateLlmBreakers } from "@/lib/llm/breaker";
import { costSnapshot, hydrateLlmCost } from "@/lib/llm/cost";
import { recentLlmTraces } from "@/lib/llm/trace";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Both stores live in app_settings; hydrate before presenting a snapshot so
    // the panel is correct right after a restart.
    await Promise.all([hydrateLlmBreakers(), hydrateLlmCost()]);
    const telemetry = await llmTelemetrySnapshot();
    const traces = await recentLlmTraces(12);
    return NextResponse.json({
      success: true,
      data: {
        live: llmOutcomeSnapshot(),
        tiers: llmTierStats(),
        googlePool: googlePoolStats(),
        telemetry,
        // Hourly p50/p95 for real traffic. Canary probes are excluded: a
        // 1-token ping would drag the percentiles down and hide a slow tier.
        telemetrySeries: telemetrySeries(telemetry.buckets, {
          hours: 12,
          sources: ["chat", "square", "movers"],
        }),
        alerts: detectLlmStorms(telemetry.buckets),
        budget: budgetStats(),
        capabilities: capabilitiesSnapshot(),
        canary: canarySnapshot(),
        breakers: breakerSnapshot(),
        cost: costSnapshot(),
        traces,
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
