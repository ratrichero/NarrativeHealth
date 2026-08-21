// Square Analytics Service — SQ-AN-02
// Queries existing DB data for V1 operational analytics
// No external API calls — all data comes from internal tables

import { db } from "@/db";
import {
  squareOpportunities,
  squarePublications,
  squareQuotaLog,
  squarePipelineExecutions,
} from "@/db/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";

// ─── Types ─────────────────────────────────────────────

export type TimeRange = "TODAY" | "7D" | "30D" | "ALL";

export interface OverviewAnalytics {
  totalExecutions: number;
  totalPublished: number;
  totalFailed: number;
  totalDeduplicated: number;
  totalQuotaBlocked: number;
  successRate: number;
  avgDurationMs: number;
  avgEvaluated: number;
  avgQualified: number;
}

export interface PublicationFunnel {
  evaluated: number;
  qualified: number;
  published: number;
  failed: number;
  deduplicated: number;
  quotaBlocked: number;
}

export interface DailyPublication {
  date: string;
  published: number;
  failed: number;
  quotaRemaining: number;
}

export interface CoinBreakdown {
  coinSymbol: string;
  total: number;
  published: number;
  failed: number;
  avgScore: number;
}

export interface NarrativeBreakdown {
  narrativeId: number;
  total: number;
  published: number;
  failed: number;
  avgScore: number;
}

export interface LlmUsage {
  llmUsed: number;
  templateFallback: number;
  llmPublishRate: number;
  templatePublishRate: number;
}

export interface FailureAnalysis {
  category: string;
  count: number;
  avgRetries: number;
  topErrorCodes: { code: string; count: number }[];
}

export interface RetryStats {
  totalRetries: number;
  avgRetries: number;
  maxRetries: number;
  retrySuccessRate: number;
}

export interface LatencyStats {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

export interface QuotaStatus {
  todayPublished: number;
  todayRemaining: number;
  dailyCap: number;
  warningThreshold: boolean;
  avgDailyUsage: number;
}

export interface ScoreDistribution {
  range: string;
  count: number;
}

export interface SuccessRateTrend {
  date: string;
  rate: number;
  published: number;
  total: number;
}

// ─── Helper: Date Range ────────────────────────────────

function getDateStr(range: TimeRange): string {
  const now = new Date();
  switch (range) {
    case "TODAY":
      return now.toISOString().split("T")[0];
    case "7D": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return d.toISOString().split("T")[0];
    }
    case "30D": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return d.toISOString().split("T")[0];
    }
    case "ALL":
      return "2024-01-01";
  }
}

// ─── Analytics Functions ───────────────────────────────

export async function getOverview(range: TimeRange): Promise<OverviewAnalytics> {
  const dateStr = getDateStr(range);

  const [result] = await db
    .select({
      totalExecutions: count(),
      totalPublished: sql<number>`coalesce(sum(${squarePipelineExecutions.published}), 0)::int`,
      totalFailed: sql<number>`coalesce(sum(${squarePipelineExecutions.failed}), 0)::int`,
      totalDeduplicated: sql<number>`coalesce(sum(${squarePipelineExecutions.deduplicated}), 0)::int`,
      totalQuotaBlocked: sql<number>`coalesce(sum(${squarePipelineExecutions.quotaBlocked}), 0)::int`,
      avgDurationMs: sql<number>`coalesce(avg(${squarePipelineExecutions.durationMs}), 0)::int`,
      avgEvaluated: sql<number>`coalesce(avg(${squarePipelineExecutions.evaluated}), 0)::int`,
      avgQualified: sql<number>`coalesce(avg(${squarePipelineExecutions.qualified}), 0)::int`,
    })
    .from(squarePipelineExecutions)
    .where(gte(squarePipelineExecutions.startedAt, new Date(dateStr)));

  const total = result.totalPublished + result.totalFailed;
  const successRate = total > 0 ? (result.totalPublished / total) * 100 : 0;

  return {
    totalExecutions: result.totalExecutions,
    totalPublished: result.totalPublished,
    totalFailed: result.totalFailed,
    totalDeduplicated: result.totalDeduplicated,
    totalQuotaBlocked: result.totalQuotaBlocked,
    successRate: Math.round(successRate * 100) / 100,
    avgDurationMs: result.avgDurationMs,
    avgEvaluated: result.avgEvaluated,
    avgQualified: result.avgQualified,
  };
}

export async function getPublicationFunnel(range: TimeRange): Promise<PublicationFunnel> {
  const dateStr = getDateStr(range);

  const [result] = await db
    .select({
      evaluated: sql<number>`coalesce(sum(${squarePipelineExecutions.evaluated}), 0)::int`,
      qualified: sql<number>`coalesce(sum(${squarePipelineExecutions.qualified}), 0)::int`,
      published: sql<number>`coalesce(sum(${squarePipelineExecutions.published}), 0)::int`,
      failed: sql<number>`coalesce(sum(${squarePipelineExecutions.failed}), 0)::int`,
      deduplicated: sql<number>`coalesce(sum(${squarePipelineExecutions.deduplicated}), 0)::int`,
      quotaBlocked: sql<number>`coalesce(sum(${squarePipelineExecutions.quotaBlocked}), 0)::int`,
    })
    .from(squarePipelineExecutions)
    .where(gte(squarePipelineExecutions.startedAt, new Date(dateStr)));

  return {
    evaluated: result.evaluated,
    qualified: result.qualified,
    published: result.published,
    failed: result.failed,
    deduplicated: result.deduplicated,
    quotaBlocked: result.quotaBlocked,
  };
}

export async function getDailyPublications(range: TimeRange): Promise<DailyPublication[]> {
  const dateStr = getDateStr(range);

  const results = await db
    .select({
      date: sql<string>`date(${squareQuotaLog.date})`,
      published: squareQuotaLog.postsPublished,
    })
    .from(squareQuotaLog)
    .where(gte(squareQuotaLog.date, dateStr))
    .orderBy(desc(squareQuotaLog.date));

  return results.map((r) => ({
    date: typeof r.date === "string" ? r.date : String(r.date),
    published: r.published,
    failed: 0,
    quotaRemaining: Math.max(0, 100 - r.published),
  }));
}

export async function getCoinBreakdown(range: TimeRange): Promise<CoinBreakdown[]> {
  const dateStr = getDateStr(range);

  const results = await db
    .select({
      coinSymbol: squareOpportunities.coinSymbol,
      total: count(),
      published: sql<number>`count(*) filter (where ${squarePublications.status} = 'PUBLISHED')::int`,
      failed: sql<number>`count(*) filter (where ${squarePublications.status} = 'FAILED')::int`,
      avgScore: sql<number>`avg(${squareOpportunities.score})::numeric(5,2)`,
    })
    .from(squareOpportunities)
    .leftJoin(squarePublications, eq(squarePublications.opportunityId, squareOpportunities.id))
    .where(and(gte(squareOpportunities.createdAt, new Date(dateStr)), sql`${squareOpportunities.coinSymbol} is not null`))
    .groupBy(squareOpportunities.coinSymbol)
    .orderBy(desc(count()));

  return results.map((r) => ({
    coinSymbol: r.coinSymbol ?? "UNKNOWN",
    total: r.total,
    published: r.published,
    failed: r.failed,
    avgScore: typeof r.avgScore === "number" ? r.avgScore : parseFloat(String(r.avgScore)),
  }));
}

export async function getNarrativeBreakdown(range: TimeRange): Promise<NarrativeBreakdown[]> {
  const dateStr = getDateStr(range);

  const results = await db
    .select({
      narrativeId: squareOpportunities.narrativeId,
      total: count(),
      published: sql<number>`count(*) filter (where ${squarePublications.status} = 'PUBLISHED')::int`,
      failed: sql<number>`count(*) filter (where ${squarePublications.status} = 'FAILED')::int`,
      avgScore: sql<number>`avg(${squareOpportunities.score})::numeric(5,2)`,
    })
    .from(squareOpportunities)
    .leftJoin(squarePublications, eq(squarePublications.opportunityId, squareOpportunities.id))
    .where(and(gte(squareOpportunities.createdAt, new Date(dateStr)), sql`${squareOpportunities.narrativeId} is not null`))
    .groupBy(squareOpportunities.narrativeId)
    .orderBy(desc(count()));

  return results.map((r) => ({
    narrativeId: r.narrativeId ?? 0,
    total: r.total,
    published: r.published,
    failed: r.failed,
    avgScore: typeof r.avgScore === "number" ? r.avgScore : parseFloat(String(r.avgScore)),
  }));
}

export async function getLlmUsage(range: TimeRange): Promise<LlmUsage> {
  const dateStr = getDateStr(range);

  const [result] = await db
    .select({
      llmUsed: sql<number>`count(*) filter (where ${squarePublications.llmUsed} = true)::int`,
      templateFallback: sql<number>`count(*) filter (where ${squarePublications.llmUsed} = false)::int`,
      llmPublished: sql<number>`count(*) filter (where ${squarePublications.llmUsed} = true and ${squarePublications.status} = 'PUBLISHED')::int`,
      templatePublished: sql<number>`count(*) filter (where ${squarePublications.llmUsed} = false and ${squarePublications.status} = 'PUBLISHED')::int`,
    })
    .from(squarePublications)
    .where(gte(squarePublications.createdAt, new Date(dateStr)));

  const llmPublishRate = result.llmUsed > 0 ? (result.llmPublished / result.llmUsed) * 100 : 0;
  const templatePublishRate = result.templateFallback > 0 ? (result.templatePublished / result.templateFallback) * 100 : 0;

  return {
    llmUsed: result.llmUsed,
    templateFallback: result.templateFallback,
    llmPublishRate: Math.round(llmPublishRate * 100) / 100,
    templatePublishRate: Math.round(templatePublishRate * 100) / 100,
  };
}

export async function getFailureAnalysis(range: TimeRange): Promise<FailureAnalysis[]> {
  const dateStr = getDateStr(range);

  const results = await db
    .select({
      category: squarePublications.failureCategory,
      count: count(),
      avgRetries: sql<number>`coalesce(avg(${squarePublications.retryCount}), 0)::int`,
    })
    .from(squarePublications)
    .where(and(gte(squarePublications.createdAt, new Date(dateStr)), eq(squarePublications.status, "FAILED")))
    .groupBy(squarePublications.failureCategory);

  return results.map((r) => ({
    category: r.category ?? "UNKNOWN",
    count: r.count,
    avgRetries: r.avgRetries,
    topErrorCodes: [],
  }));
}

export async function getRetryStats(range: TimeRange): Promise<RetryStats> {
  const dateStr = getDateStr(range);

  const [result] = await db
    .select({
      totalRetries: sql<number>`coalesce(sum(${squarePublications.retryCount}), 0)::int`,
      avgRetries: sql<number>`coalesce(avg(${squarePublications.retryCount}), 0)::int`,
      maxRetries: sql<number>`coalesce(max(${squarePublications.retryCount}), 0)::int`,
      retryAttempts: sql<number>`count(*) filter (where ${squarePublications.retryCount} > 0)::int`,
      retrySuccesses: sql<number>`count(*) filter (where ${squarePublications.retryCount} > 0 and ${squarePublications.status} = 'PUBLISHED')::int`,
    })
    .from(squarePublications)
    .where(gte(squarePublications.createdAt, new Date(dateStr)));

  const retrySuccessRate = result.retryAttempts > 0 ? (result.retrySuccesses / result.retryAttempts) * 100 : 0;

  return {
    totalRetries: result.totalRetries,
    avgRetries: result.avgRetries,
    maxRetries: result.maxRetries,
    retrySuccessRate: Math.round(retrySuccessRate * 100) / 100,
  };
}

export async function getLatencyStats(range: TimeRange): Promise<LatencyStats> {
  const dateStr = getDateStr(range);

  const results = await db
    .select({
      latencyMs: sql<number>`(${squarePublications.contentSnapshot} ->> 'latencyMs')::int`,
    })
    .from(squarePublications)
    .where(and(gte(squarePublications.createdAt, new Date(dateStr)), sql`${squarePublications.contentSnapshot} -> 'latencyMs' is not null`));

  const latencies = results
    .map((r) => r.latencyMs)
    .filter((l): l is number => l !== null && l !== undefined && l > 0)
    .sort((a, b) => a - b);

  if (latencies.length === 0) {
    return { avgMs: 0, p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  }

  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];

  return { avgMs: Math.round(avg), p50Ms: p50, p95Ms: p95, p99Ms: p99 };
}

export async function getQuotaAnalytics(): Promise<QuotaStatus> {
  const today = new Date().toISOString().split("T")[0];

  const [quota] = await db.select().from(squareQuotaLog).where(eq(squareQuotaLog.date, today)).limit(1);

  const todayPublished = quota?.postsPublished ?? 0;

  const [avgResult] = await db
    .select({ avgDaily: sql<number>`coalesce(avg(${squareQuotaLog.postsPublished}), 0)::int` })
    .from(squareQuotaLog)
    .where(gte(squareQuotaLog.date, getDateStr("30D")));

  return {
    todayPublished,
    todayRemaining: Math.max(0, 100 - todayPublished),
    dailyCap: 100,
    warningThreshold: todayPublished >= 80,
    avgDailyUsage: avgResult.avgDaily,
  };
}

export async function getScoreDistribution(range: TimeRange): Promise<ScoreDistribution[]> {
  const dateStr = getDateStr(range);

  const results = await db
    .select({
      range: sql<string>`case when ${squareOpportunities.score} >= 90 then '90-100' when ${squareOpportunities.score} >= 80 then '80-89' when ${squareOpportunities.score} >= 70 then '70-79' when ${squareOpportunities.score} >= 60 then '60-69' when ${squareOpportunities.score} >= 50 then '50-59' else '<50' end`,
      count: count(),
    })
    .from(squareOpportunities)
    .where(gte(squareOpportunities.createdAt, new Date(dateStr)))
    .groupBy(sql`case when ${squareOpportunities.score} >= 90 then '90-100' when ${squareOpportunities.score} >= 80 then '80-89' when ${squareOpportunities.score} >= 70 then '70-79' when ${squareOpportunities.score} >= 60 then '60-69' when ${squareOpportunities.score} >= 50 then '50-59' else '<50' end`)
    .orderBy(desc(count()));

  return results.map((r) => ({ range: r.range, count: r.count }));
}

export async function getSuccessRateTrend(range: TimeRange): Promise<SuccessRateTrend[]> {
  const dateStr = getDateStr(range);

  const results = await db
    .select({
      date: sql<string>`date(${squarePipelineExecutions.startedAt})`,
      published: sql<number>`coalesce(sum(${squarePipelineExecutions.published}), 0)::int`,
      failed: sql<number>`coalesce(sum(${squarePipelineExecutions.failed}), 0)::int`,
    })
    .from(squarePipelineExecutions)
    .where(gte(squarePipelineExecutions.startedAt, new Date(dateStr)))
    .groupBy(sql`date(${squarePipelineExecutions.startedAt})`)
    .orderBy(desc(sql`date(${squarePipelineExecutions.startedAt})`));

  return results.map((r) => {
    const total = r.published + r.failed;
    return {
      date: typeof r.date === "string" ? r.date : String(r.date),
      rate: total > 0 ? Math.round((r.published / total) * 10000) / 100 : 0,
      published: r.published,
      total,
    };
  });
}

export async function getTopCoins(range: TimeRange, limit = 10): Promise<CoinBreakdown[]> {
  const all = await getCoinBreakdown(range);
  return all.slice(0, limit);
}

export async function getTopNarratives(range: TimeRange, limit = 10): Promise<NarrativeBreakdown[]> {
  const all = await getNarrativeBreakdown(range);
  return all.slice(0, limit);
}
