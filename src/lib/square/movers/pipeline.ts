// SQ-MOVERS: Pipeline orchestration — 6 bài Top Movers riêng lẻ, post lần lượt
//
// Thiết kế theo yêu cầu owner (sửa từ bản gộp 1 bài): mỗi coin mover là MỘT
// bài post độc lập (3 gainers + 3 losers = 6 bài). Lợi ích:
//   * Mỗi bài có 1 cashtag duy nhất → Binance Square render chart widget
//     riêng, tăng diện tích hiển thị trên feed.
//   * Post lần lượt với stagger → tránh rate-limit 429 (pattern chung của
//     SQUARE_PUBLISH_STAGGER_MS).
//   * Một bài lỗi không phá các bài còn lại; kết quả tổng hợp theo bài.
//
// Idempotent: mover coin đã PUBLISHED hôm nay (fingerprint theo coin + business
// date) → skip, không đăng trùng khi restart/trigger tay.
//
// Lưu ý quota: hard cap 100 posts/ngày → 6 bài movers chiếm tối đa 6% quota.

import { db } from "@/db";
import {
  squareOpportunities,
  squarePublications,
  squarePipelineExecutions,
} from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getBusinessDate } from "@/lib/utils";
import { fetchMoversSnapshot, type MoverCoin, type MoversSnapshot } from "./collector";
import { generateMoversContent, type MoversSubjectBrief } from "./content";
import {
  getQuotaStatus,
  publishContent,
} from "@/lib/square/publisher";
import { resolveChartCoin, generateChartMetadata } from "@/lib/square/chart-utils";
import { MOVERS_PER_SIDE } from "./collector";

/** Stagger giữa các bài post liên tiếp (mặc định 90s, SQ_TEST_MODE=1 → 0). */
const PUBLISH_STAGGER_MS = process.env.SQ_TEST_MODE === "1"
  ? 0
  : Math.max(0, Number(process.env.SQUARE_PUBLISH_STAGGER_MS ?? 90_000));

export type MoverPostResult =
  | "PUBLISHED"
  | "FAILED"
  | "DUPLICATE"
  | "QUOTA_BLOCKED"
  | "DRY_RUN"; // chỉ ở dry-run: "sẽ đăng nếu chạy thật"

export interface MoverPostDetail {
  symbol: string;
  kind: "GAINER" | "LOSER";
  rank: number;
  result: MoverPostResult;
  llmUsed: boolean;
  errorCode?: string;
  externalPostId?: string;
  /** Chỉ có ở dry-run: nội dung sẽ được đăng (chưa persist/publish). */
  preview?: { title: string; text: string };
}

export interface MoversPipelineOptions {
  /** SCHEDULED = cron 07:15 (ghi MOVERS_CRON), MANUAL = trigger tay admin (ghi MOVERS_MANUAL). */
  trigger?: "SCHEDULED" | "MANUAL";
  /** Dry-run: chạy đủ collect + sinh content, KHÔNG persist/publish/ghi execution. */
  dryRun?: boolean;
}

export interface MoversPipelineResult {
  ok: boolean;
  dryRun: boolean;
  skipped?: "ALREADY_PUBLISHED" | "NO_DATA" | "QUOTA_EXHAUSTED";
  postsPublished: number;
  postsFailed: number;
  postsDeduped: number;
  postsQuotaBlocked: number;
  snapshot: { marketCount: number; collectedAt: string } | null;
  details: MoverPostDetail[];
  errors: string[];
}

/**
 * Fingerprint per-coin theo business date — idempotency key của 1 bài movers.
 * Khác generateFingerprint của publisher (theo opportunityId + ngày publish),
 * cái này dùng vào guard đầu pipeline: coin X đã đăng hôm nay → skip.
 */
export function generateMoversDayFingerprint(symbol: string, kind: string, date: string): string {
  return createHash("sha256")
    .update(["MOVERS", kind, symbol, date].join("|"))
    .digest("hex")
    .slice(0, 64);
}

/** Kiểm tra coin đã được publish hôm nay chưa (qua fingerprint lưu ở contentSnapshot). */
async function findTodayMoverPublication(symbol: string, date: string) {
  const [row] = await db
    .select({ id: squarePublications.id })
    .from(squarePublications)
    .innerJoin(squareOpportunities, eq(squarePublications.opportunityId, squareOpportunities.id))
    .where(
      and(
        eq(squareOpportunities.type, "MOVERS_SETUP"),
        eq(squareOpportunities.coinSymbol, symbol),
        eq(squareOpportunities.dataAsOf, date),
        eq(squarePublications.status, "PUBLISHED")
      )
    )
    .limit(1);
  return row ?? null;
}

/** Persist 1 opportunity movers (type MOVERS_SETUP) — mỗi coin 1 row. */
async function persistMoverOpportunity(
  subject: MoversSubjectBrief,
  date: string,
  marketCount: number
): Promise<number> {
  const { coin } = subject;
  const score = Math.min(99, Math.round(Math.abs(coin.changePct) * 2 + (subject.rank === 1 ? 10 : 0)));

  const [row] = await db
    .insert(squareOpportunities)
    .values({
      type: "MOVERS_SETUP",
      subjectId: null,
      narrativeId: null,
      coinSymbol: coin.symbol,
      score: score.toString(),
      dataAsOf: date,
      dataQuality: coin.fundingRate != null && coin.volumeRatio != null ? "HIGH" : "MEDIUM",
      rationale: [
        `${subject.kind === "GAINER" ? "Top gainer" : "Top loss"} #${subject.rank} trên ${marketCount} futures USDT markets (24h)`,
        `Change: ${coin.changePct >= 0 ? "+" : ""}${coin.changePct.toFixed(2)}%`,
        `Volume 24h: ${Math.round(coin.quoteVolume).toLocaleString("en-US")} USD`,
        coin.volumeRatio != null ? `Volume vs 7d avg: ${coin.volumeRatio.toFixed(2)}x` : null,
        coin.fundingRate != null ? `Funding: ${(coin.fundingRate * 100).toFixed(4)}%` : null,
      ].filter((x): x is string => x !== null),
      status: "QUALIFIED",
    })
    .returning();

  return row?.id ?? 0;
}

function buildSubjects(snapshot: MoversSnapshot): MoversSubjectBrief[] {
  const subjects: MoversSubjectBrief[] = [];
  snapshot.gainers.forEach((coin: MoverCoin, i: number) =>
    subjects.push({ kind: "GAINER", rank: i + 1, coin })
  );
  snapshot.losers.forEach((coin: MoverCoin, i: number) =>
    subjects.push({ kind: "LOSER", rank: i + 1, coin })
  );
  return subjects;
}

/**
 * Ghi 1 dòng execution vào square_pipeline_executions (triggerType MOVERS_*)
 * — nguồn dữ liệu cho card "Top Movers Pipeline" trong admin tab Analytics.
 * Lỗi ghi log không bao giờ làm fail pipeline.
 */
async function recordMoversExecution(f: {
  trigger: "SCHEDULED" | "MANUAL";
  startedAt: number;
  quotaRemainingStart: number;
  quotaWarning: boolean;
  llmUsedCount: number;
  templateFallbackCount: number;
  evaluated: number;
  qualified: number;
  published: number;
  failed: number;
  deduplicated: number;
  quotaBlocked: number;
  errors: string[];
}): Promise<void> {
  try {
    await db.insert(squarePipelineExecutions).values({
      startedAt: new Date(f.startedAt),
      completedAt: new Date(),
      triggerType: f.trigger === "MANUAL" ? "MOVERS_MANUAL" : "MOVERS_CRON",
      evaluated: f.evaluated,
      qualified: f.qualified,
      published: f.published,
      failed: f.failed,
      deduplicated: f.deduplicated,
      quotaBlocked: f.quotaBlocked,
      retryPending: 0,
      contentGenerationFailed: 0,
      llmUsedCount: f.llmUsedCount,
      templateFallbackCount: f.templateFallbackCount,
      durationMs: Date.now() - f.startedAt,
      quotaRemainingStart: f.quotaRemainingStart,
      quotaRemainingEnd: Math.max(0, f.quotaRemainingStart - f.published),
      quotaWarning: f.quotaWarning,
      errorSummary: f.errors.length > 0 ? { errors: f.errors, error_count: f.errors.length } : null,
    });
  } catch (err) {
    console.error("[SQ-MOVERS] Failed to record execution:", err);
  }
}

/**
 * Chạy pipeline movers: collect → 6 bài content → post lần lượt.
 * Không bao giờ throw — mọi lỗi đi vào result.errors/details.
 * Dry-run (dryRun: true): chỉ collect + sinh content để xem trước, không đăng.
 */
export async function runMoversPipeline(
  options: MoversPipelineOptions = {}
): Promise<MoversPipelineResult> {
  const dryRun = options.dryRun === true;
  const trigger = options.trigger ?? "SCHEDULED";
  const startedAt = Date.now();
  const errors: string[] = [];
  const details: MoverPostDetail[] = [];
  let postsPublished = 0;
  let postsFailed = 0;
  let postsDeduped = 0;
  let postsQuotaBlocked = 0;

  // Guard 1: coin nào đã publish hôm nay? (idempotency per coin)
  const today = getBusinessDate();

  // Guard 2: quota
  const quota = await getQuotaStatus();
  if (quota.postsRemaining <= 0) {
    if (!dryRun) {
      await recordMoversExecution({
        trigger,
        startedAt,
        quotaRemainingStart: 0,
        quotaWarning: quota.warningThreshold,
        llmUsedCount: 0,
        templateFallbackCount: 0,
        evaluated: 0,
        qualified: 0,
        published: 0,
        failed: 0,
        deduplicated: 0,
        quotaBlocked: 0,
        errors: ["QUOTA_EXHAUSTED: Daily post quota exhausted"],
      });
    }
    return {
      ok: false,
      dryRun,
      skipped: "QUOTA_EXHAUSTED",
      postsPublished: 0,
      postsFailed: 0,
      postsDeduped: 0,
      postsQuotaBlocked: 0,
      snapshot: null,
      details: [],
      errors: ["Daily post quota exhausted"],
    };
  }

  // Collect snapshot
  const snapshot = await fetchMoversSnapshot();
  if (!snapshot) {
    if (!dryRun) {
      await recordMoversExecution({
        trigger,
        startedAt,
        quotaRemainingStart: quota.postsRemaining,
        quotaWarning: quota.warningThreshold,
        llmUsedCount: 0,
        templateFallbackCount: 0,
        evaluated: 0,
        qualified: 0,
        published: 0,
        failed: 0,
        deduplicated: 0,
        quotaBlocked: 0,
        errors: ["NO_DATA: Movers snapshot unavailable (source error or insufficient movers)"],
      });
    }
    return {
      ok: false,
      dryRun,
      skipped: "NO_DATA",
      postsPublished: 0,
      postsFailed: 0,
      postsDeduped: 0,
      postsQuotaBlocked: 0,
      snapshot: null,
      details: [],
      errors: ["Movers snapshot unavailable (source error or insufficient movers)"],
    };
  }

  const subjects = buildSubjects(snapshot);
  let quotaRemaining = quota.postsRemaining;
  // Số detail đã thật sự qua bước generate content — dedup/quota-blocked
  // dừng TRƯỚC generate nên KHÔNG được tính là template fallback.
  let generatedCount = 0;

  for (const [idx, subject] of subjects.entries()) {
    const symbol = subject.coin.symbol;
    const detail: MoverPostDetail = {
      symbol,
      kind: subject.kind,
      rank: subject.rank,
      result: "FAILED",
      llmUsed: false,
    };

    try {
      // Idempotency per coin per day
      const already = await findTodayMoverPublication(symbol, today);
      if (already) {
        detail.result = "DUPLICATE";
        details.push(detail);
        postsDeduped++;
        continue;
      }

      // Quota trước mỗi bài
      if (quotaRemaining <= 0) {
        detail.result = "QUOTA_BLOCKED";
        details.push(detail);
        postsQuotaBlocked++;
        continue;
      }

      // Stagger giữa các bài (trừ bài đầu) — dry-run không đăng nên không cần
      if (!dryRun && idx > 0 && PUBLISH_STAGGER_MS > 0) {
        await new Promise((r) => setTimeout(r, PUBLISH_STAGGER_MS));
      }

      // Content (LLM → template)
      const generated = await generateMoversContent(subject, snapshot.marketCount);
      detail.llmUsed = generated.llmUsed;
      generatedCount++;

      // Dry-run: dừng ở đây — trả preview, không persist/publish
      if (dryRun) {
        detail.result = "DRY_RUN";
        detail.preview = { title: generated.title ?? "", text: generated.text };
        details.push(detail);
        continue;
      }

      // Persist opportunity + publish
      const opportunityId = await persistMoverOpportunity(subject, today, snapshot.marketCount);
      const cashtags = [`$${symbol}`];
      const chartCoin = resolveChartCoin(null, cashtags);
      const chartMeta = generateChartMetadata(chartCoin, symbol);

      const result = await publishContent(
        opportunityId,
        generated.text,
        generated.title,
        chartMeta,
        undefined, // thesisFingerprint: movers không có thesis TP/SL ổn định
        generated.llmUsed,
        generated.llmProvider
      );

      if (result.success) {
        detail.result = "PUBLISHED";
        detail.externalPostId = result.externalPostId;
        postsPublished++;
        quotaRemaining--;
      } else if (result.errorCode === "DUPLICATE") {
        detail.result = "DUPLICATE";
        postsDeduped++;
      } else {
        detail.result = "FAILED";
        detail.errorCode = result.errorCode;
        errors.push(`${symbol}: ${result.errorCode ?? "unknown"} — ${result.errorMessage ?? ""}`);
        postsFailed++;
      }
    } catch (err) {
      detail.result = "FAILED";
      errors.push(
        `${symbol}: ${err instanceof Error ? err.message : String(err)}`
      );
      postsFailed++;
    }

    details.push(detail);
  }

  const llmUsedCount = details.filter((d) => d.llmUsed).length;
  if (!dryRun) {
    await recordMoversExecution({
      trigger,
      startedAt,
      quotaRemainingStart: quota.postsRemaining,
      quotaWarning: quota.warningThreshold,
      llmUsedCount,
      // Chỉ tính detail đã generate (PUBLISHED/FAILED post-generate) — không
      // đếm DUPLICATE/QUOTA_BLOCKED dừng trước generate vào "template".
      templateFallbackCount: Math.max(0, generatedCount - llmUsedCount),
      evaluated: subjects.length,
      qualified: subjects.length,
      published: postsPublished,
      failed: postsFailed,
      deduplicated: postsDeduped,
      quotaBlocked: postsQuotaBlocked,
      errors,
    });
  }

  return {
    ok: postsPublished > 0 || (postsFailed === 0 && postsDeduped === postsPublished + postsDeduped),
    dryRun,
    postsPublished,
    postsFailed,
    postsDeduped,
    postsQuotaBlocked,
    snapshot: { marketCount: snapshot.marketCount, collectedAt: snapshot.collectedAt },
    details,
    errors,
  };
}
