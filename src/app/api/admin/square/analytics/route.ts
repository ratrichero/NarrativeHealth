import { NextRequest, NextResponse } from "next/server";
import {
  getOverview,
  getPublicationFunnel,
  getDailyPublications,
  getCoinBreakdown,
  getNarrativeBreakdown,
  getLlmUsage,
  getFailureAnalysis,
  getRetryStats,
  getLatencyStats,
  getQuotaAnalytics,
  getScoreDistribution,
  getSuccessRateTrend,
  getTopCoins,
  getTopNarratives,
  getExecutionHistory,
  getRecentPublications,
  getTypeBreakdown,
  type TimeRange,
} from "@/lib/square/analytics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const range: TimeRange = (request.nextUrl.searchParams.get("range") as TimeRange) || "7D";
    const section = request.nextUrl.searchParams.get("section") || "all";

    if (!["TODAY", "7D", "30D", "ALL"].includes(range)) {
      return NextResponse.json({ success: false, error: "Invalid range. Use TODAY, 7D, 30D, or ALL." }, { status: 400 });
    }

    const validSections = [
      "overview", "funnel", "daily", "coins", "narratives", "llm",
      "failures", "retry", "latency", "quota", "scores", "trend",
      "executions", "publications", "types", "all",
    ];
    if (!validSections.includes(section)) {
      return NextResponse.json({ success: false, error: `Invalid section. Use: ${validSections.join(", ")}` }, { status: 400 });
    }

    const includeAll = section === "all";
    const data: Record<string, unknown> = {};

    if (includeAll || section === "overview") data.overview = await getOverview(range);
    if (includeAll || section === "funnel") data.funnel = await getPublicationFunnel(range);
    if (includeAll || section === "daily") data.daily = await getDailyPublications(range);
    if (includeAll || section === "coins") data.coins = await getTopCoins(range);
    if (includeAll || section === "narratives") data.narratives = await getTopNarratives(range);
    if (includeAll || section === "llm") data.llm = await getLlmUsage(range);
    if (includeAll || section === "failures") data.failures = await getFailureAnalysis(range);
    if (includeAll || section === "retry") data.retry = await getRetryStats(range);
    if (includeAll || section === "latency") data.latency = await getLatencyStats(range);
    if (includeAll || section === "quota") data.quota = await getQuotaAnalytics();
    if (includeAll || section === "scores") data.scores = await getScoreDistribution(range);
    if (includeAll || section === "trend") data.trend = await getSuccessRateTrend(range);
    if (includeAll || section === "executions") data.executions = await getExecutionHistory(range);
    if (includeAll || section === "publications") data.publications = await getRecentPublications(range);
    if (includeAll || section === "types") data.types = await getTypeBreakdown(range);

    return NextResponse.json({ success: true, range, section, data });
  } catch (error) {
    console.error("[GET /api/admin/square/analytics] Error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
