// RADAR-06 — đồng bộ catalyst từ nhiều nguồn, mỗi nguồn hỏng độc lập.
// Không chặn radar: caller bọc try/catch; sync không throw vì một nguồn lỗi.
//
// Scope tách theo nhịp nguồn (xem docs/RADAR-06 §7.1):
//   announcements — Binance CMS 48/161/49, hợp poll 5 phút (tin listing/delist
//                   quyết định phần lớn outlier, trễ 5 phút là mất giá trị).
//   news          — 4 feed RSS, 15 phút là đủ (nội dung không phải tín hiệu).
//   unlocks       — chỉ đọc event_risks, đổi 1 lần/ngày → 60 phút.
//   all           — chạy cả ba (manual/admin + tương thích endpoint cũ).

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { BINANCE_CATALOGS, fetchBinanceCatalog } from "./binance-announcements";
import { RSS_FEEDS, fetchRssFeed } from "./rss";
import { readUnlockFacts } from "./unlocks";
import { purgeExpiredCatalysts, upsertCatalystFacts } from "./store";
import { catalystStaleness, computeEmptyStreak, dispatchCatalystStaleAlerts } from "./health";
import type { CatalystSourceState, CatalystSyncInfo } from "./types";

const SYNC_KEY = "catalyst.sync";

/**
 * Trạng thái sync lưu theo TỪNG scope. Trước đây cả 3 job ghi chung một summary
 * nên job announcement (5 phút) ghi đè kết quả RSS/unlock (15/60 phút) → panel
 * có thể nói sai nguồn nào đã được kiểm tra.
 */
export interface CatalystSyncStatus {
  version: 2;
  scopes: Partial<Record<CatalystSyncScope, CatalystSyncSummary>>;
}

export type CatalystSyncScope = "all" | "announcements" | "news" | "unlocks";

export const CATALYST_SYNC_SCOPES: readonly CatalystSyncScope[] = [
  "all",
  "announcements",
  "news",
  "unlocks",
];

/** Chuỗi lạ/không có scope → "all" (giữ hành vi endpoint cũ trước khi tách nhịp). */
export function parseCatalystSyncScope(raw: unknown): CatalystSyncScope {
  if (typeof raw !== "string") return "all";
  const value = raw.trim().toLowerCase();
  return (CATALYST_SYNC_SCOPES as readonly string[]).includes(value)
    ? (value as CatalystSyncScope)
    : "all";
}

export interface CatalystSourceResult {
  name: string;
  fetched: number;
  stored: number;
  skipped: number;
  error?: string;
  /** Số lượt liên tiếp fetch thành công nhưng 0 fact (RADAR-06-STALE). */
  emptyStreak?: number;
}

export interface CatalystSyncSummary {
  startedAt: string;
  finishedAt: string;
  scope: CatalystSyncScope;
  sources: CatalystSourceResult[];
  totals: { fetched: number; stored: number; failedSources: number };
  purged: number;
}

async function runSource(
  name: string,
  load: () => Promise<{ fetched: number; skipped?: number; facts: Parameters<typeof upsertCatalystFacts>[0] }>
): Promise<CatalystSourceResult> {
  try {
    const { fetched, facts, skipped = 0 } = await load();
    const { stored, skipped: invalid } = await upsertCatalystFacts(facts);
    return { name, fetched, stored, skipped: skipped + invalid };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[CATALYST] ${name} failed:`, message);
    return { name, fetched: 0, stored: 0, skipped: 0, error: message };
  }
}

export async function syncCatalysts(
  now = Date.now(),
  scope: CatalystSyncScope = "all"
): Promise<CatalystSyncSummary> {
  const startedAt = new Date(now).toISOString();
  const wants = (part: Exclude<CatalystSyncScope, "all">) => scope === "all" || scope === part;

  const results: CatalystSourceResult[] = [];

  if (wants("announcements")) {
    for (const [key, catalogId] of Object.entries(BINANCE_CATALOGS)) {
      results.push(
        await runSource(`binance.${key}`, async () => {
          const facts = await fetchBinanceCatalog(catalogId);
          return { fetched: facts.length, facts };
        })
      );
    }
  }

  if (wants("news")) {
    for (const feed of RSS_FEEDS) {
      results.push(
        await runSource(`rss.${feed.source}`, async () => {
          const facts = await fetchRssFeed(feed);
          return { fetched: facts.length, facts };
        })
      );
    }
  }

  if (wants("unlocks")) {
    results.push(
      await runSource("unlocks.event_risks", async () => {
        const { facts, skippedNoSource } = await readUnlockFacts(new Date(now));
        return { fetched: facts.length + skippedNoSource, skipped: skippedNoSource, facts };
      })
    );
  }

  // Chuỗi 0 fact cần trạng thái của lượt trước: đọc trước khi ghi lượt này.
  const previousStatus = await readCatalystSyncStatus();
  const previousStreaks = new Map(
    catalystSourceStatuses(previousStatus).map((source) => [source.name, source.emptyStreak])
  );
  for (const result of results) {
    result.emptyStreak = computeEmptyStreak(result, previousStreaks.get(result.name));
  }

  let purged = 0;
  try {
    purged = await purgeExpiredCatalysts(now);
  } catch (error) {
    console.warn(
      "[CATALYST] purge failed:",
      error instanceof Error ? error.message : String(error)
    );
  }

  const summary: CatalystSyncSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    scope,
    sources: results,
    totals: {
      fetched: results.reduce((sum, r) => sum + r.fetched, 0),
      stored: results.reduce((sum, r) => sum + r.stored, 0),
      failedSources: results.filter((r) => r.error).length,
    },
    purged,
  };

  // Trạng thái sync để panel biết nguồn nào đã chạy/lỗi. Ghi theo từng scope:
  // mỗi job chỉ thay phần của mình, không xoá kết quả của job khác. Best-effort,
  // không chặn sync. (Hai job trùng thời điểm vẫn có thể đọc-trước-ghi-sau đè
  // nhau; lượt chạy kế tiếp của scope bị mất sẽ tự sửa trong 5–60 phút.)
  let status: CatalystSyncStatus | null = null;
  try {
    status = mergeSyncStatus(previousStatus, scope, summary);
    await db
      .insert(appSettings)
      .values({ key: SYNC_KEY, value: status, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: status, updatedAt: new Date() },
      });
  } catch (error) {
    console.warn(
      "[CATALYST] không lưu được trạng thái sync:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Feed chết âm thầm: quá hạn nhịp scope hoặc 2 lượt liền 0 fact. Cảnh báo
  // qua kênh alert sẵn có, có cooldown; lỗi cảnh báo không được làm vỡ sync.
  if (status) {
    try {
      const stale = catalystStaleness(catalystSourceStatuses(status), now).filter((row) => row.stale);
      if (stale.length > 0) {
        const delivered = await dispatchCatalystStaleAlerts(stale, now);
        if (delivered > 0) {
          console.warn(`[CATALYST] STALE: ${stale.map((row) => row.name).join(", ")}`);
        }
      }
    } catch (error) {
      console.warn(
        "[CATALYST] không gửi được cảnh báo STALE:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return summary;
}

function isSummary(value: unknown): value is CatalystSyncSummary {
  return Boolean(value) && typeof value === "object" && Array.isArray((value as CatalystSyncSummary).sources);
}

/** Đọc cả format cũ (một summary) lẫn format theo scope — deploy không mất trạng thái. */
export function normalizeSyncStatus(value: unknown): CatalystSyncStatus | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { scopes?: unknown; scope?: unknown };

  if (record.scopes && typeof record.scopes === "object") {
    const scopes: Partial<Record<CatalystSyncScope, CatalystSyncSummary>> = {};
    for (const [key, summary] of Object.entries(record.scopes as Record<string, unknown>)) {
      if (!(CATALYST_SYNC_SCOPES as readonly string[]).includes(key) || !isSummary(summary)) continue;
      scopes[key as CatalystSyncScope] = summary;
    }
    return Object.keys(scopes).length > 0 ? { version: 2, scopes } : null;
  }

  if (isSummary(value)) {
    const scope = (CATALYST_SYNC_SCOPES as readonly string[]).includes(String(record.scope))
      ? (record.scope as CatalystSyncScope)
      : "all";
    return { version: 2, scopes: { [scope]: value } };
  }

  return null;
}

/** Ghi đè đúng scope của mình, giữ nguyên các scope khác. */
export function mergeSyncStatus(
  current: CatalystSyncStatus | null,
  scope: CatalystSyncScope,
  summary: CatalystSyncSummary
): CatalystSyncStatus {
  return { version: 2, scopes: { ...(current?.scopes ?? {}), [scope]: summary } };
}

/**
 * Suy ra trạng thái phủ nguồn từ HỢP các scope trong `catalyst.sync`.
 * `null` = chưa từng chạy sync → panel phải nói “chưa đồng bộ nguồn”, không được
 * nói “chưa tìm thấy catalyst” (hai chuyện khác nhau).
 *
 * Mỗi nguồn lấy lần chạy mới nhất của chính nó (theo `finishedAt`), nên một job
 * chạy sau không làm mất/đổi kết quả nguồn của job khác.
 */
export function catalystSyncInfo(status: CatalystSyncStatus | null): CatalystSyncInfo {
  const summaries = status ? Object.values(status.scopes).filter(isSummary) : [];
  if (summaries.length === 0) {
    return { state: "never_synced", lastSyncAt: null, failedSources: [], checkedSources: [] };
  }

  const latest = new Map<string, { error?: string; finishedAt: number }>();
  let lastSyncMs = 0;

  for (const summary of summaries) {
    const parsed = Date.parse(summary.finishedAt);
    const finishedAt = Number.isFinite(parsed) ? parsed : 0;
    lastSyncMs = Math.max(lastSyncMs, finishedAt);

    for (const source of summary.sources) {
      const previous = latest.get(source.name);
      if (previous && previous.finishedAt > finishedAt) continue;
      latest.set(source.name, { error: source.error, finishedAt });
    }
  }

  const names = [...latest.entries()].sort(([a], [b]) => a.localeCompare(b));
  const checkedSources = names.filter(([, entry]) => !entry.error).map(([name]) => name);
  const failedSources = names.filter(([, entry]) => entry.error).map(([name]) => name);

  const state: CatalystSourceState = checkedSources.length === 0 ? "sources_failed" : "synced";
  return {
    state,
    lastSyncAt: lastSyncMs > 0 ? new Date(lastSyncMs).toISOString() : null,
    failedSources,
    checkedSources,
  };
}

/** Một nguồn trong bảng trạng thái (admin/ops) — lần chạy mới nhất của chính nó. */
export interface CatalystSourceStatus {
  name: string;
  scope: CatalystSyncScope;
  lastRunAt: string | null;
  fetched: number;
  stored: number;
  skipped: number;
  failing: boolean;
  error: string | null;
  /** Số lượt liên tiếp 0 fact; dùng để phát hiện feed chết âm thầm. */
  emptyStreak: number;
}

const SOURCE_SCOPE_ORDER: CatalystSyncScope[] = ["announcements", "news", "unlocks", "all"];

/**
 * Bảng trạng thái theo từng nguồn để admin thấy feed chết mà không cần SQL.
 * Hợp các scope, mỗi nguồn lấy lần chạy mới nhất của nó.
 */
export function catalystSourceStatuses(status: CatalystSyncStatus | null): CatalystSourceStatus[] {
  if (!status) return [];

  const latest = new Map<
    string,
    { scope: CatalystSyncScope; finishedAt: number; source: CatalystSourceResult }
  >();

  for (const [scope, summary] of Object.entries(status.scopes) as Array<
    [CatalystSyncScope, CatalystSyncSummary]
  >) {
    if (!isSummary(summary)) continue;
    const parsed = Date.parse(summary.finishedAt);
    const finishedAt = Number.isFinite(parsed) ? parsed : 0;

    for (const source of summary.sources) {
      const previous = latest.get(source.name);
      if (previous && previous.finishedAt > finishedAt) continue;
      latest.set(source.name, { scope, finishedAt, source });
    }
  }

  return [...latest.values()]
    .sort(
      (a, b) =>
        SOURCE_SCOPE_ORDER.indexOf(a.scope) - SOURCE_SCOPE_ORDER.indexOf(b.scope) ||
        a.source.name.localeCompare(b.source.name)
    )
    .map(({ scope, finishedAt, source }) => ({
      name: source.name,
      scope,
      lastRunAt: finishedAt > 0 ? new Date(finishedAt).toISOString() : null,
      fetched: source.fetched,
      stored: source.stored,
      skipped: source.skipped,
      failing: Boolean(source.error),
      error: source.error ?? null,
      emptyStreak: source.emptyStreak ?? 0,
    }));
}

export async function readCatalystSyncStatus(): Promise<CatalystSyncStatus | null> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SYNC_KEY)).limit(1);
    return normalizeSyncStatus(row?.value);
  } catch {
    return null;
  }
}
