// Binance Square Publisher — SQ-OPERATE-02 Enhanced
// Handles authentication, posting, deduplication, quota, retry, and failure classification

import { db } from "@/db";
import {
  squareOpportunities,
  squarePublications,
  squareQuotaLog,
  squareFingerprints,
} from "@/db/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { exec } from "child_process";
import { promisify } from "util";
import { createHash } from "crypto";
import { resolve } from "path";

const execAsync = promisify(exec);

// ─── Types ─────────────────────────────────────────────

export type PublicationStatus =
  | "DRAFT"
  | "PUBLISHED"
  | "FAILED"
  | "SUPPRESSED"
  | "RETRY_PENDING"
  | "UNKNOWN";

export type FailureCategory =
  | "TRANSIENT"
  | "PERMANENT"
  | "TIMEOUT"
  | "UNKNOWN";

export interface PublicationResult {
  success: boolean;
  publicationId?: number;
  externalPostId?: string;
  errorCode?: string;
  errorMessage?: string;
  retryCount: number;
  failureCategory?: FailureCategory;
}

export interface QuotaStatus {
  postsPublished: number;
  postsRemaining: number;
  dailyHardCap: number;
  warningThreshold: boolean;
}

// ─── Configuration ─────────────────────────────────────

const SQUARE_SKILL_DIR = resolve(
  process.cwd(),
  "node_modules/@anthropic/skills/binance/square-post"
);

const CONTENT_VERSION = "1.0.0";
const TEMPLATE_VERSION = "1.0.0";
const FINGERPRINT_TTL_HOURS = 72;
const THESIS_FINGERPRINT_TTL_HOURS = 168;
const MAX_RETRIES = 2;
const QUOTA_WARNING_THRESHOLD = 80; // Warn when 80% of daily cap used

// Retryable error codes from Binance API
const RETRYABLE_ERROR_CODES = new Set([
  "30008", // Account restriction (may be temporary)
  "2000001", // Device restriction (may be temporary)
]);

// Permanent error codes — do not retry
const PERMANENT_ERROR_CODES = new Set([
  "220003", // API key not found
  "220004", // API key expired
  "220009", // Daily post limit exceeded
  "220014", // Daily upload limit exceeded
  "20002", // Sensitive words detected
  "20022", // Sensitive words detected
  "20013", // Content length limited
  "20020", // Content body must not be empty
  "220011", // Content body must not be empty
  "2000002", // Account restriction
]);

// ─── Fingerprint Generation ────────────────────────────

function generateFingerprint(
  type: string,
  subjectId: number,
  coinSymbol: string | null,
  narrativeId: number | null,
  entryLevel: number | null,
  dataAsOf: string
): string {
  const components = [
    type,
    subjectId.toString(),
    coinSymbol || "",
    narrativeId?.toString() || "",
    entryLevel?.toFixed(4) || "",
    dataAsOf,
  ];
  return createHash("sha256").update(components.join("|")).digest("hex").slice(0, 64);
}

export function generateThesisFingerprint(params: {
  type: string;
  subjectId: number;
  narrativeId: number | null;
  coinSymbols: string[];
  signal: string;
  entryLow: number | null;
  entryHigh: number | null;
  tpLevels: number[];
  slLevel: number | null;
  invalidation: string | null;
}): string {
  const components = [
    params.type,
    params.subjectId.toString(),
    params.narrativeId?.toString() || "",
    params.coinSymbols.sort().join(","),
    params.signal,
    params.entryLow?.toFixed(4) || "",
    params.entryHigh?.toFixed(4) || "",
    params.tpLevels.map((l) => l.toFixed(4)).join(","),
    params.slLevel?.toFixed(4) || "",
    params.invalidation || "",
  ];
  return createHash("sha256").update(components.join("|")).digest("hex").slice(0, 64);
}

// ─── Failure Classification ────────────────────────────

function classifyFailure(
  errorCode: string | undefined,
  errorMessage: string | undefined,
  isTimeout: boolean
): { status: PublicationStatus; category: FailureCategory } {
  if (isTimeout) {
    return { status: "RETRY_PENDING", category: "TIMEOUT" };
  }

  if (errorCode && PERMANENT_ERROR_CODES.has(errorCode)) {
    return { status: "FAILED", category: "PERMANENT" };
  }

  if (errorCode && RETRYABLE_ERROR_CODES.has(errorCode)) {
    return { status: "RETRY_PENDING", category: "TRANSIENT" };
  }

  // Network errors, connection refused, etc.
  if (
    errorMessage &&
    (errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("ETIMEDOUT") ||
      errorMessage.includes("socket hang up") ||
      errorMessage.includes("fetch failed"))
  ) {
    return { status: "RETRY_PENDING", category: "TRANSIENT" };
  }

  return { status: "FAILED", category: "UNKNOWN" };
}

function isRetryable(category: FailureCategory | undefined): boolean {
  return category === "TRANSIENT" || category === "TIMEOUT";
}

// ─── Quota Management ──────────────────────────────────

export async function getQuotaStatus(): Promise<QuotaStatus> {
  const today = new Date().toISOString().split("T")[0];
  const dailyHardCap = 100;

  const [quota] = await db
    .select()
    .from(squareQuotaLog)
    .where(eq(squareQuotaLog.date, today))
    .limit(1);

  const postsPublished = quota?.postsPublished ?? 0;
  const remaining = Math.max(0, dailyHardCap - postsPublished);
  const warningThreshold = postsPublished >= QUOTA_WARNING_THRESHOLD;

  // Log warning if approaching quota
  if (warningThreshold && !(quota?.warningAtThreshold)) {
    console.warn(
      `[SQ-QUOTA] Approaching daily limit: ${postsPublished}/${dailyHardCap} posts published today`
    );
    // Mark warning as logged (prevents spam)
    if (quota) {
      await db
        .update(squareQuotaLog)
        .set({ warningAtThreshold: true, updatedAt: new Date() })
        .where(eq(squareQuotaLog.date, today));
    }
  }

  return {
    postsPublished,
    postsRemaining: remaining,
    dailyHardCap,
    warningThreshold,
  };
}

export async function incrementQuota(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  await db
    .insert(squareQuotaLog)
    .values({
      date: today,
      postsPublished: 1,
      lastRefreshAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [squareQuotaLog.date],
      set: {
        postsPublished: sql`${squareQuotaLog.postsPublished} + 1`,
        lastRefreshAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

// ─── Deduplication ─────────────────────────────────────

export async function isDuplicate(fingerprint: string): Promise<boolean> {
  const now = new Date();

  const [existing] = await db
    .select()
    .from(squareFingerprints)
    .where(
      and(
        eq(squareFingerprints.fingerprint, fingerprint),
        gte(squareFingerprints.expiresAt, now)
      )
    )
    .limit(1);

  return !!existing;
}

export async function isThesisStable(fingerprint: string): Promise<boolean> {
  const now = new Date();

  const [existing] = await db
    .select()
    .from(squareFingerprints)
    .where(
      and(
        eq(squareFingerprints.fingerprint, fingerprint),
        gte(squareFingerprints.expiresAt, now)
      )
    )
    .limit(1);

  return !!existing;
}

export async function recordFingerprint(
  fingerprint: string,
  opportunityId: number
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + FINGERPRINT_TTL_HOURS * 60 * 60 * 1000);

  await db.insert(squareFingerprints).values({
    fingerprint,
    opportunityId,
    publishedAt: now,
    expiresAt,
  });
}

export async function recordThesisFingerprint(
  fingerprint: string,
  opportunityId: number
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + THESIS_FINGERPRINT_TTL_HOURS * 60 * 60 * 1000);

  await db.insert(squareFingerprints).values({
    fingerprint,
    opportunityId,
    publishedAt: now,
    expiresAt,
  });
}

// ─── Content Posting ───────────────────────────────────

interface PostResult {
  success: boolean;
  id?: string;
  link?: string;
  error?: string;
  errorCode?: string;
  isTimeout: boolean;
}

async function postText(
  text: string,
  title?: string
): Promise<PostResult> {
  const apiKey = process.env.BINANCE_SQUARE_OPENAPI_KEY;
  if (!apiKey) {
    return { success: false, error: "BINANCE_SQUARE_OPENAPI_KEY not set", isTimeout: false };
  }

  const args = ["--text", text];
  if (title) {
    args.push("--title", title);
  }

  try {
    const { stdout, stderr } = await execAsync(
      `node scripts/post-text.mjs ${args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`,
      {
        cwd: SQUARE_SKILL_DIR,
        env: { ...process.env, BINANCE_SQUARE_OPENAPI_KEY: apiKey },
        timeout: 30000,
      }
    );

    const idMatch = stdout.match(/ID:\s*(\S+)/);
    const linkMatch = stdout.match(/Link:\s*(\S+)/);

    if (stdout.includes("Success")) {
      return {
        success: true,
        id: idMatch?.[1],
        link: linkMatch?.[1],
        isTimeout: false,
      };
    }

    // Parse error code from response
    const errorCodeMatch = stdout.match(/code["\s:]+(\d{6})/);
    return {
      success: false,
      error: stdout || stderr,
      errorCode: errorCodeMatch?.[1],
      isTimeout: false,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    const isTimeout = msg.includes("timeout") || msg.includes("TIMEOUT");
    return { success: false, error: msg, isTimeout };
  }
}

// ─── Publication Pipeline ──────────────────────────────

export async function publishContent(
  opportunityId: number,
  text: string,
  title?: string,
  chartMetadata?: { chartSymbol: string | null; chartMatchesSource: boolean },
  thesisFingerprint?: string,
  llmUsed?: boolean
): Promise<PublicationResult> {
  // 1. Check quota
  const quota = await getQuotaStatus();
  if (quota.postsRemaining <= 0) {
    return {
      success: false,
      errorCode: "QUOTA_EXCEEDED",
      errorMessage: "Daily post limit reached",
      retryCount: 0,
      failureCategory: "PERMANENT",
    };
  }

  // 2. Check if there's already a PUBLISHED record for this opportunity
  const [existingPublished] = await db
    .select()
    .from(squarePublications)
    .where(
      and(
        eq(squarePublications.opportunityId, opportunityId),
        eq(squarePublications.status, "PUBLISHED")
      )
    )
    .limit(1);

  if (existingPublished) {
    return {
      success: false,
      errorCode: "ALREADY_PUBLISHED",
      errorMessage: "This opportunity was already published",
      publicationId: existingPublished.id,
      externalPostId: existingPublished.externalPostId ?? undefined,
      retryCount: existingPublished.retryCount ?? 0,
    };
  }

  // 3. Check if there's a RETRY_PENDING record (this is a retry attempt)
  const [retryPending] = await db
    .select()
    .from(squarePublications)
    .where(
      and(
        eq(squarePublications.opportunityId, opportunityId),
        eq(squarePublications.status, "RETRY_PENDING")
      )
    )
    .orderBy(desc(squarePublications.retryCount))
    .limit(1);

  const isRetry = !!retryPending;
  const retryCount = isRetry ? (retryPending.retryCount ?? 0) + 1 : 0;

  // 4. If this is a first attempt (not retry), check deduplication
  if (!isRetry) {
    const fingerprint = generateFingerprint(
      "TEXT",
      opportunityId,
      null,
      null,
      null,
      new Date().toISOString().split("T")[0]
    );

    if (await isDuplicate(fingerprint)) {
      return {
        success: false,
        errorCode: "DUPLICATE",
        errorMessage: "Similar content recently published",
        retryCount: 0,
        failureCategory: "PERMANENT",
      };
    }

    // Check thesis stability
    if (thesisFingerprint && (await isThesisStable(thesisFingerprint))) {
      return {
        success: false,
        errorCode: "THESIS_STABLE",
        errorMessage: "Similar thesis recently published",
        retryCount: 0,
        failureCategory: "PERMANENT",
      };
    }
  }

  // 5. Check retry budget
  if (retryCount > MAX_RETRIES) {
    // Max retries exceeded — mark as UNKNOWN
    if (retryPending) {
      await db
        .update(squarePublications)
        .set({
          status: "UNKNOWN",
          errorMessage: `Max retries (${MAX_RETRIES}) exceeded`,
          failureCategory: "UNKNOWN",
        })
        .where(eq(squarePublications.id, retryPending.id));
    }
    return {
      success: false,
      errorCode: "MAX_RETRIES_EXCEEDED",
      errorMessage: `Max retries (${MAX_RETRIES}) exceeded — post may or may not have been created`,
      retryCount,
      failureCategory: "UNKNOWN",
    };
  }

  // 6. Post to Binance Square
  const startTime = Date.now();
  const result = await postText(text, title);
  const latencyMs = Date.now() - startTime;

  // 7. Classify failure if not successful
  const classification = result.success
    ? null
    : classifyFailure(result.errorCode, result.error, result.isTimeout);

  // 8. Handle idempotency: if timeout but we got an external post ID, treat as success
  if (result.isTimeout && result.id) {
    // Binance may have created the post — we have the ID
    console.warn(
      `[SQ-PUBLISHER] Timeout with post ID ${result.id} — treating as PUBLISHED`
    );
  }

  const finalStatus: PublicationStatus = result.success
    ? "PUBLISHED"
    : classification?.status ?? "FAILED";

  const finalCategory: FailureCategory | null = result.success
    ? null
    : classification?.category ?? "UNKNOWN";

  // 9. Record or update publication
  if (isRetry && retryPending) {
    // Update existing retry record
    await db
      .update(squarePublications)
      .set({
        status: finalStatus,
        publishedAt: result.success || (result.isTimeout && result.id) ? new Date() : null,
        externalPostId: result.id,
        retryCount,
        failureCategory: finalCategory,
        errorCode: result.errorCode,
        errorMessage: result.error,
      })
      .where(eq(squarePublications.id, retryPending.id));

    var publicationId = retryPending.id;
    var externalPostId = result.id;
  } else {
    // First attempt — create new record
    const fingerprint = generateFingerprint(
      "TEXT",
      opportunityId,
      null,
      null,
      null,
      new Date().toISOString().split("T")[0]
    );

    const [publication] = await db
      .insert(squarePublications)
      .values({
        opportunityId,
        fingerprint,
        status: finalStatus,
        publishedAt: result.success || (result.isTimeout && result.id) ? new Date() : null,
        externalPostId: result.id,
        contentVersion: CONTENT_VERSION,
        templateVersion: TEMPLATE_VERSION,
        llmUsed: llmUsed ?? false,
        retryCount: 0,
        failureCategory: finalCategory,
        errorCode: result.errorCode,
        errorMessage: result.error,
        contentSnapshot: {
          text,
          title,
          chartSymbol: chartMetadata?.chartSymbol ?? null,
          chartMatchesSource: chartMetadata?.chartMatchesSource ?? null,
          latencyMs,
        },
      })
      .returning();

    publicationId = publication?.id;
    externalPostId = result.id;
  }

  // 10. If successful, record deduplication and quota
  if (result.success || (result.isTimeout && result.id)) {
    const fingerprint = generateFingerprint(
      "TEXT",
      opportunityId,
      null,
      null,
      null,
      new Date().toISOString().split("T")[0]
    );
    await recordFingerprint(fingerprint, opportunityId);
    if (thesisFingerprint) {
      await recordThesisFingerprint(thesisFingerprint, opportunityId);
    }
    await incrementQuota();

    await db
      .update(squareOpportunities)
      .set({ status: "PUBLISHED" })
      .where(eq(squareOpportunities.id, opportunityId));
  }

  // 11. Log publication result for observability
  console.log(
    `[SQ-PUBLISHER] ${finalStatus} opp=${opportunityId} ` +
    `retry=${retryCount} latency=${latencyMs}ms ` +
    `category=${finalCategory ?? "null"} ` +
    `externalId=${externalPostId ?? "none"}`
  );

  return {
    success: result.success || (result.isTimeout && !!result.id),
    publicationId,
    externalPostId,
    errorCode: result.errorCode,
    errorMessage: result.error,
    retryCount,
    failureCategory: finalCategory ?? undefined,
  };
}

// ─── Opportunity Persistence ───────────────────────────

export async function persistOpportunity(
  opportunity: import("./opportunity-engine").SquareOpportunity
): Promise<number> {
  const [row] = await db
    .insert(squareOpportunities)
    .values({
      type: opportunity.type,
      subjectId: opportunity.subjectId,
      narrativeId: opportunity.narrativeId,
      coinSymbol: opportunity.coinSymbol,
      score: opportunity.score.toString(),
      dataAsOf: opportunity.dataAsOf,
      dataQuality: opportunity.dataQuality,
      rationale: opportunity.rationale,
      entryZone: opportunity.entry,
      takeProfits: opportunity.takeProfits,
      stopLoss: opportunity.stopLoss,
      expiresAt: opportunity.expiresAt ? new Date(opportunity.expiresAt) : null,
      status: opportunity.status,
    })
    .returning();

  return row?.id ?? 0;
}
