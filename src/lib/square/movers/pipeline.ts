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
import { squareOpportunities, squarePublications } from "@/db/schema";
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
  | "QUOTA_BLOCKED";

export interface MoverPostDetail {
  symbol: string;
  kind: "GAINER" | "LOSER";
  rank: number;
  result: MoverPostResult;
  llmUsed: boolean;
  errorCode?: string;
  externalPostId?: string;
}

export interface MoversPipelineResult {
  ok: boolean;
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
 * Chạy pipeline movers: collect → 6 bài content → post lần lượt.
 * Không bao giờ throw — mọi lỗi đi vào result.errors/details.
 */
export async function runMoversPipeline(): Promise<MoversPipelineResult> {
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
    return {
      ok: false,
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
    return {
      ok: false,
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

      // Stagger giữa các bài (trừ bài đầu)
      if (idx > 0 && PUBLISH_STAGGER_MS > 0) {
        await new Promise((r) => setTimeout(r, PUBLISH_STAGGER_MS));
      }

      // Content (LLM → template)
      const generated = await generateMoversContent(subject, snapshot.marketCount);
      detail.llmUsed = generated.llmUsed;

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

  return {
    ok: postsPublished > 0 || (postsFailed === 0 && postsDeduped === postsPublished + postsDeduped),
    postsPublished,
    postsFailed,
    postsDeduped,
    postsQuotaBlocked,
    snapshot: { marketCount: snapshot.marketCount, collectedAt: snapshot.collectedAt },
    details,
    errors,
  };
}
