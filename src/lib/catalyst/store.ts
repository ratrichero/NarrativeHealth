// RADAR-06 — lưu catalyst facts. Idempotent theo (source, external_id) để poll lại
// không nhân đôi. Bảng riêng, không FK coins, không đụng event_risks/P4.

import { and, count, desc, gt, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { catalystEvents } from "@/db/schema";
import type { CatalystFact, CatalystSource, CatalystType } from "./types";

const NEWS_TTL_DAYS = 14;
const ANNOUNCEMENT_TTL_DAYS = 30;
const UNLOCK_TTL_DAYS_AFTER = 2;
const INSERT_CHUNK = 100;

export function expiresAtFor(fact: CatalystFact, now = Date.now()): Date {
  if (fact.type === "UNLOCK") {
    const base = fact.eventDate ? Date.parse(`${fact.eventDate}T00:00:00Z`) : now;
    return new Date((Number.isFinite(base) ? base : now) + UNLOCK_TTL_DAYS_AFTER * 86_400_000);
  }
  if (fact.type === "NEWS") {
    return new Date(now + NEWS_TTL_DAYS * 86_400_000);
  }
  return new Date(now + ANNOUNCEMENT_TTL_DAYS * 86_400_000);
}

export interface UpsertResult {
  stored: number;
  skipped: number;
}

function isStorable(fact: CatalystFact): boolean {
  if (!fact.sourceUrl || !/^https?:\/\//.test(fact.sourceUrl)) return false;
  if (!fact.title || !fact.externalId) return false;
  return Number.isFinite(Date.parse(fact.publishedAt));
}

export async function upsertCatalystFacts(facts: CatalystFact[], now = Date.now()): Promise<UpsertResult> {
  const valid = facts.filter(isStorable);
  let stored = 0;

  for (let i = 0; i < valid.length; i += INSERT_CHUNK) {
    const chunk = valid.slice(i, i + INSERT_CHUNK);
    await db
      .insert(catalystEvents)
      .values(
        chunk.map((fact) => ({
          type: fact.type,
          source: fact.source,
          externalId: fact.externalId,
          title: fact.title,
          sourceUrl: fact.sourceUrl,
          symbols: fact.symbols,
          publishedAt: new Date(fact.publishedAt),
          eventDate: fact.eventDate ?? null,
          facts: fact.facts ?? null,
          raw: (fact.raw ?? null) as Record<string, unknown> | null,
          fetchedAt: new Date(now),
          expiresAt: expiresAtFor(fact, now),
        }))
      )
      .onConflictDoUpdate({
        target: [catalystEvents.source, catalystEvents.externalId],
        set: {
          title: sql`excluded.title`,
          symbols: sql`excluded.symbols`,
          facts: sql`excluded.facts`,
          publishedAt: sql`excluded.published_at`,
          eventDate: sql`excluded.event_date`,
          fetchedAt: sql`excluded.fetched_at`,
          expiresAt: sql`excluded.expires_at`,
        },
      });
    stored += chunk.length;
  }

  return { stored, skipped: facts.length - valid.length };
}

interface StoredRow {
  type: string;
  source: string;
  externalId: string;
  title: string;
  sourceUrl: string;
  symbols: unknown;
  publishedAt: Date;
  eventDate: string | null;
  facts: unknown;
}

function toFact(row: StoredRow): CatalystFact {
  return {
    type: row.type as CatalystType,
    source: row.source as CatalystSource,
    externalId: row.externalId,
    title: row.title,
    sourceUrl: row.sourceUrl,
    symbols: Array.isArray(row.symbols) ? row.symbols.filter((s): s is string => typeof s === "string") : [],
    publishedAt: row.publishedAt instanceof Date ? row.publishedAt.toISOString() : String(row.publishedAt),
    eventDate: row.eventDate ?? null,
    facts: row.facts && typeof row.facts === "object" ? (row.facts as Record<string, unknown>) : undefined,
  };
}

export async function readRecentCatalystFacts(options: {
  sinceDays?: number;
  limit?: number;
  now?: number;
} = {}): Promise<CatalystFact[]> {
  const now = options.now ?? Date.now();
  const sinceDays = options.sinceDays ?? 14;
  const limit = Math.min(500, Math.max(20, options.limit ?? 300));

  const rows = await db
    .select({
      type: catalystEvents.type,
      source: catalystEvents.source,
      externalId: catalystEvents.externalId,
      title: catalystEvents.title,
      sourceUrl: catalystEvents.sourceUrl,
      symbols: catalystEvents.symbols,
      publishedAt: catalystEvents.publishedAt,
      eventDate: catalystEvents.eventDate,
      facts: catalystEvents.facts,
    })
    .from(catalystEvents)
    .where(
      and(
        gt(catalystEvents.expiresAt, new Date(now)),
        gte(catalystEvents.publishedAt, new Date(now - sinceDays * 86_400_000))
      )
    )
    .orderBy(desc(catalystEvents.publishedAt))
    .limit(limit);

  return rows.map(toFact);
}

export interface LiveCatalystCount {
  source: CatalystSource;
  live: number;
}

/**
 * Tổng fact **còn hạn** trong `catalyst_events`, gộp theo source.
 *
 * Khác `stored` của một lượt sync: `stored` là số dòng upsert trong lần chạy cuối
 * (gồm cả update dòng đã có), không cho biết kho catalyst còn phục vụ panel được
 * bao nhiêu. Ops cần cả hai: `lastRun` để biết feed còn sống, số này để biết
 * nguồn đó còn đóng góp bao nhiêu fact thực sự dùng được.
 */
export async function countLiveCatalystFacts(now = Date.now()): Promise<LiveCatalystCount[]> {
  const rows = await db
    .select({ source: catalystEvents.source, live: count() })
    .from(catalystEvents)
    .where(gt(catalystEvents.expiresAt, new Date(now)))
    .groupBy(catalystEvents.source);

  return rows
    .map((row) => ({ source: row.source as CatalystSource, live: Number(row.live) }))
    .sort((a, b) => b.live - a.live || a.source.localeCompare(b.source));
}

export async function purgeExpiredCatalysts(now = Date.now()): Promise<number> {
  const result = await db
    .delete(catalystEvents)
    .where(lt(catalystEvents.expiresAt, new Date(now)))
    .returning({ id: catalystEvents.id });
  return result.length;
}
