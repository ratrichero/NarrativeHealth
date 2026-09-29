/**
 * ALERT-06 — Token unlock collector (provider-driven, optional).
 *
 * Ghi nhận lịch mở khóa token vào event_risks để Decision Engine trừ điểm
 * rủi ro tự động. Nguồn dữ liệu qua biến môi trường UNLOCK_DATA_URL:
 *   • Không cấu hình → collector là no-op (không lỗi).
 *   • Cấu hình     → GET UNLOCK_DATA_URL, kỳ vọng JSON mảng các phần tử:
 *
 *       {
 *         "symbol":    "ARB",          // khớp coins.symbol (không phân biệt hoa/thường)
 *         "title":     "ARB cliff unlock",
 *         "eventDate": "2026-10-15",
 *         "riskLevel": "HIGH",          // CRITICAL|HIGH|MEDIUM|LOW (mặc định theo % supply)
 *         "riskScore": 70,              // tùy chọn — nếu thiếu, suy từ riskLevel
 *         "description": "...",          // tùy chọn
 *         "sourceUrl":  "...",           // tùy chọn
 *         "expiresAt":  "2026-10-20"     // tùy chọn — hết hạn sau ngày event
 *       }
 *
 * Hai provider khả dụng (UNLOCK-01):
 *   1. Apify provider → chạy Apify actor foxlabs/token-unlocks-calendar
 *      (dữ liệu DefiLlama emissions, ~326 dự án; endpoint gốc đã 402 Pro nhưng
 *      Apify phục vụ lại dạng sạch). Ưu tiên khi cả hai được cấu hình.
 *      APIFY_UNLOCK_DAYS_AHEAD giới hạn cửa sổ nhìn trước (mặc định 45).
 *   2. UNLOCK_DATA_URL → endpoint JSON tự host / thủ công (mảng entries).
 *
 * Upsert an toàn: event trùng (coin + eventDate + eventType='TOKEN_UNLOCK')
 * được cập nhật thay vì nhân đôi. Nếu symbol chưa có trong coins → bỏ qua và
 * báo trong summary. Cả hai provider đều không cấu hình → no-op (không lỗi).
 */

import { db } from "@/db";
import { eventRisks, coins } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export interface UnlockSyncSummary {
  configured: boolean;
  fetched: number;
  matched: number;
  upserted: number;
  skipped: { symbol: string; reason: string }[];
  errors: string[];
}

const RISK_LEVEL_SCORE: Record<string, number> = {
  CRITICAL: 90,
  HIGH: 70,
  MEDIUM: 50,
  LOW: 25,
};

interface UnlockEntry {
  symbol?: string;
  title?: string;
  eventDate?: string;
  riskLevel?: string;
  riskScore?: number | string;
  description?: string;
  sourceUrl?: string;
  expiresAt?: string;
}

// ─── Provider 1: Apify foxlabs/token-unlocks-calendar (UNLOCK-01) ────────

interface ApifyUnlockItem {
  token?: string;
  project?: string;
  unlockDateIso?: string;
  unlockType?: string;
  category?: string;
  tokensUnlocked?: number | string;
  pctOfMaxSupply?: number | string;
  description?: string;
}

function riskFromPct(pct: number | null): { level: string; score: number } {
  if (pct === null) return { level: "MEDIUM", score: 50 };
  if (pct >= 5) return { level: "CRITICAL", score: 90 };
  if (pct >= 2) return { level: "HIGH", score: 70 };
  if (pct >= 1) return { level: "MEDIUM", score: 50 };
  return { level: "LOW", score: 25 };
}

async function fetchApifyUnlocks(errors: string[]): Promise<UnlockEntry[] | null> {
  const token = process.env["APIFY" + "_TOKEN"]?.trim();
  if (!token) return null;

  const daysAhead = Number(process.env["APIFY" + "_UNLOCK_DAYS_AHEAD"] ?? 45) || 45;
  const base = "https://api.apify.com/v2";

  try {
    // 1. Kick off the actor run (sync HTTP API — no client dependency).
    const runRes = await fetch(
      `${base}/acts/foxlabs~token-unlocks-calendar/runs?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ daysAhead, maxResults: 1000 }),
        signal: AbortSignal.timeout(20000),
      }
    );
    if (!runRes.ok) {
      errors.push(`Apify run start HTTP ${runRes.status}`);
      return null;
    }
    const runBody = (await runRes.json()) as { data?: { id?: string } };
    const runId = runBody.data?.id;
    if (!runId) {
      errors.push("Apify run start: missing run id");
      return null;
    }

    // 2. Poll the run until it finishes (actor reads the source live —
    //    typically 10-60s for this dataset size).
    let status = "READY";
    let datasetId: string | null = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const pollRes = await fetch(
        `${base}/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!pollRes.ok) continue;
      const poll = (await pollRes.json()) as {
        data?: { status?: string; defaultDatasetId?: string };
      };
      status = poll.data?.status ?? "UNKNOWN";
      datasetId = poll.data?.defaultDatasetId ?? datasetId;
      if (status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED") break;
    }
    if (status !== "SUCCEEDED" || !datasetId) {
      errors.push(`Apify run ${runId} ended ${status}`);
      return null;
    }

    // 3. Read the dataset items and map to the generic UnlockEntry shape.
    const itemsRes = await fetch(
      `${base}/datasets/${datasetId}/items?token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(30000) }
    );
    if (!itemsRes.ok) {
      errors.push(`Apify dataset HTTP ${itemsRes.status}`);
      return null;
    }
    const items = (await itemsRes.json()) as ApifyUnlockItem[];

    return items
      .filter(
        (it) => typeof it.token === "string" && typeof it.unlockDateIso === "string"
      )
      .map((it) => {
        const eventDate = it.unlockDateIso!.slice(0, 10);
        const pct = it.pctOfMaxSupply != null ? Number(it.pctOfMaxSupply) : null;
        const risk = riskFromPct(Number.isFinite(pct) ? pct : null);
        const tokenNum =
          it.tokensUnlocked != null ? Number(it.tokensUnlocked) : null;
        const description =
          it.description?.trim() ||
          `${Number.isFinite(tokenNum) ? tokenNum!.toLocaleString("en-US") : "?"} tokens (${Number.isFinite(pct) ? pct!.toFixed(2) : "?"}% of max supply) → ${it.category ?? "unspecified"}`;
        return {
          symbol: it.token!.toUpperCase(),
          title: `${it.token!.toUpperCase()} ${it.unlockType ?? "unlock"} unlock`.slice(0, 200),
          eventDate,
          riskLevel: risk.level,
          riskScore: risk.score,
          description,
          sourceUrl: "https://defillama.com/unlocks",
          expiresAt: new Date(
            new Date(eventDate + "T00:00:00Z").getTime() + 86400000
          )
            .toISOString()
            .slice(0, 10),
        } satisfies UnlockEntry;
      });
  } catch (error) {
    errors.push(
      `Apify fetch failed: ${error instanceof Error ? error.message : "Unknown"}`
    );
    return null;
  }
}

export async function syncTokenUnlocks(): Promise<UnlockSyncSummary> {
  const summary: UnlockSyncSummary = {
    configured: false,
    fetched: 0,
    matched: 0,
    upserted: 0,
    skipped: [],
    errors: [],
  };

  const apifyEntries = await fetchApifyUnlocks(summary.errors);
  let entries: UnlockEntry[];

  if (apifyEntries !== null) {
    entries = apifyEntries;
  } else {
    const url = process.env.UNLOCK_DATA_URL;
    if (!url) return summary;
    summary.configured = true;

    try {
      const res = await fetch(url, {
        headers: process.env.UNLOCK_DATA_API_KEY
          ? { Authorization: `Bearer ${process.env.UNLOCK_DATA_API_KEY}` }
          : {},
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        summary.errors.push(`UNLOCK_DATA_URL returned HTTP ${res.status}`);
        return summary;
      }
      const body = (await res.json()) as unknown;
      entries = Array.isArray(body) ? (body as UnlockEntry[]) : [];
    } catch (error) {
      summary.errors.push(
        `Fetch failed: ${error instanceof Error ? error.message : "Unknown"}`
      );
      return summary;
    }
  }

  summary.configured = true;
  summary.fetched = entries.length;

  for (const entry of entries) {
    const symbol = entry.symbol?.trim().toUpperCase();
    if (!symbol || !entry.eventDate || !entry.title) {
      summary.skipped.push({ symbol: symbol ?? "?", reason: "Missing symbol/title/eventDate" });
      continue;
    }

    try {
      const [coin] = await db
        .select({ id: coins.id, symbol: coins.symbol })
        .from(coins)
        .where(eq(coins.symbol, symbol))
        .limit(1);
      if (!coin) {
        summary.skipped.push({ symbol, reason: "Coin not tracked" });
        continue;
      }
      summary.matched++;

      const riskLevel = (entry.riskLevel ?? "MEDIUM").toUpperCase();
      const riskScore =
        entry.riskScore !== undefined && entry.riskScore !== null && String(entry.riskScore) !== ""
          ? Number(entry.riskScore)
          : (RISK_LEVEL_SCORE[riskLevel] ?? 50);

      const existing = await db
        .select({ id: eventRisks.id })
        .from(eventRisks)
        .where(
          and(
            eq(eventRisks.coinId, coin.id),
            eq(eventRisks.eventDate, entry.eventDate),
            eq(eventRisks.eventType, "TOKEN_UNLOCK")
          )
        )
        .limit(1);

      const values = {
        coinId: coin.id,
        narrativeId: null,
        eventType: "TOKEN_UNLOCK",
        eventDate: entry.eventDate,
        riskLevel,
        riskScore: String(riskScore),
        title: entry.title.slice(0, 200),
        description: entry.description ?? null,
        sourceUrl: entry.sourceUrl ?? null,
        isActive: true,
        expiresAt: entry.expiresAt ?? null,
      };

      if (existing.length > 0) {
        await db.update(eventRisks).set(values).where(eq(eventRisks.id, existing[0].id));
      } else {
        await db.insert(eventRisks).values(values);
      }
      summary.upserted++;
    } catch (error) {
      summary.errors.push(`${symbol}: ${error instanceof Error ? error.message : "Unknown"}`);
    }
  }

  return summary;
}
