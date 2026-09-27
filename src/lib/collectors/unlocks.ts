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
 * Upsert an toàn: event trùng (coin + eventDate + eventType='TOKEN_UNLOCK')
 * được cập nhật thay vì nhân đôi. Nếu symbol chưa có trong coins → bỏ qua và
 * báo trong summary. Ghi chú: DefiLlama emissions đã chuyển API Pro (402);
 * UNLOCK_DATA_URL cho phép cắm bất kỳ provider nào (tự host, apify, manual
 * JSON endpoint...).
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

export async function syncTokenUnlocks(): Promise<UnlockSyncSummary> {
  const summary: UnlockSyncSummary = {
    configured: false,
    fetched: 0,
    matched: 0,
    upserted: 0,
    skipped: [],
    errors: [],
  };

  const url = process.env.UNLOCK_DATA_URL;
  if (!url) return summary;
  summary.configured = true;

  let entries: UnlockEntry[];
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
    summary.errors.push(`Fetch failed: ${error instanceof Error ? error.message : "Unknown"}`);
    return summary;
  }

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
