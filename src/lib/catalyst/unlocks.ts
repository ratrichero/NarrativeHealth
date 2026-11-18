// RADAR-06 — unlock chỉ ĐỌC từ event_risks (nguồn đã có sẵn: Apify/UNLOCK_DATA_URL
// qua /api/admin/events/sync-unlocks). Không ghi vào event_risks, không gọi Apify
// trong V1 — owner chốt “tạm chỉ announcement”, nên lớp catalyst không tự chạy actor.
// Fact nào thiếu sourceUrl thì bỏ (nguyên tắc: mọi fact phải có link nguồn).

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { coins, eventRisks } from "@/db/schema";
import type { CatalystFact } from "./types";

export interface UnlockReadResult {
  facts: CatalystFact[];
  skippedNoSource: number;
}

export async function readUnlockFacts(
  now = new Date(),
  daysBack = 2,
  daysAhead = 14
): Promise<UnlockReadResult> {
  const from = new Date(now.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(now.getTime() + daysAhead * 86_400_000).toISOString().slice(0, 10);

  const rows = await db
    .select({
      title: eventRisks.title,
      eventDate: eventRisks.eventDate,
      sourceUrl: eventRisks.sourceUrl,
      riskLevel: eventRisks.riskLevel,
      createdAt: eventRisks.createdAt,
      symbol: coins.symbol,
    })
    .from(eventRisks)
    .innerJoin(coins, eq(eventRisks.coinId, coins.id))
    .where(
      and(
        eq(eventRisks.eventType, "TOKEN_UNLOCK"),
        eq(eventRisks.isActive, true),
        gte(eventRisks.eventDate, from),
        lte(eventRisks.eventDate, to)
      )
    )
    .orderBy(eventRisks.eventDate)
    .limit(500);

  const facts: CatalystFact[] = [];
  let skippedNoSource = 0;

  for (const row of rows) {
    if (!row.sourceUrl) {
      skippedNoSource += 1;
      continue;
    }
    const published = row.createdAt instanceof Date && Number.isFinite(row.createdAt.getTime())
      ? row.createdAt
      : new Date(`${row.eventDate}T00:00:00Z`);
    facts.push({
      type: "UNLOCK",
      source: "EVENT_RISKS_UNLOCK",
      externalId: `unlock:${row.symbol}:${row.eventDate}`.slice(0, 200),
      title: row.title.slice(0, 300),
      sourceUrl: row.sourceUrl,
      symbols: [row.symbol.toUpperCase()],
      publishedAt: published.toISOString(),
      eventDate: row.eventDate,
      facts: { riskLevel: row.riskLevel, unlockDate: row.eventDate },
      raw: { eventType: "TOKEN_UNLOCK", symbol: row.symbol },
    });
  }

  return { facts, skippedNoSource };
}
