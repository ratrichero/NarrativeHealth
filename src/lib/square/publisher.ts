// Binance Square Publisher
// Handles authentication, posting, deduplication, and quota management

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

export type PublicationStatus = "DRAFT" | "PUBLISHED" | "FAILED" | "SUPPRESSED";

export interface PublicationResult {
  success: boolean;
  publicationId?: number;
  externalPostId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface QuotaStatus {
  postsPublished: number;
  postsRemaining: number;
  dailyHardCap: number;
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

  return {
    postsPublished,
    postsRemaining: Math.max(0, dailyHardCap - postsPublished),
    dailyHardCap,
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

async function postText(
  text: string,
  title?: string
): Promise<{ success: boolean; id?: string; link?: string; error?: string; errorCode?: string }> {
  const apiKey = process.env.BINANCE_SQUARE_OPENAPI_KEY;
  if (!apiKey) {
    return { success: false, error: "BINANCE_SQUARE_OPENAPI_KEY not set" };
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
      };
    }

    return { success: false, error: stdout || stderr };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ─── Publication Pipeline ──────────────────────────────

export async function publishContent(
  opportunityId: number,
  text: string,
  title?: string,
  chartMetadata?: { chartSymbol: string | null; chartMatchesSource: boolean },
  thesisFingerprint?: string
): Promise<PublicationResult> {
  // 1. Check quota
  const quota = await getQuotaStatus();
  if (quota.postsRemaining <= 0) {
    return {
      success: false,
      errorCode: "QUOTA_EXCEEDED",
      errorMessage: "Daily post limit reached",
    };
  }

  // 2. Check for duplicate content
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
    };
  }

  // 3. Check thesis stability (E4)
  if (thesisFingerprint && (await isThesisStable(thesisFingerprint))) {
    return {
      success: false,
      errorCode: "THESIS_STABLE",
      errorMessage: "Similar thesis recently published",
    };
  }

  // 4. Post to Binance Square
  const result = await postText(text, title);

  // 5. Record publication
  const [publication] = await db
    .insert(squarePublications)
    .values({
      opportunityId,
      fingerprint,
      status: result.success ? "PUBLISHED" : "FAILED",
      publishedAt: result.success ? new Date() : null,
      externalPostId: result.id,
      contentVersion: CONTENT_VERSION,
      templateVersion: TEMPLATE_VERSION,
      llmUsed: false,
      errorCode: result.errorCode,
      errorMessage: result.error,
      contentSnapshot: { text, title, chartSymbol: chartMetadata?.chartSymbol ?? null, chartMatchesSource: chartMetadata?.chartMatchesSource ?? null },
    })
    .returning();

  // 6. Record fingerprint for deduplication
  if (result.success) {
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

  return {
    success: result.success,
    publicationId: publication?.id,
    externalPostId: result.id,
    errorCode: result.errorCode,
    errorMessage: result.error,
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
