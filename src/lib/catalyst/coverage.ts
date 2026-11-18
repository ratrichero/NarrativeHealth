// RADAR-06-COVERAGE — độ phủ catalyst của outlier, đọc từ dữ liệu sẵn có:
// signal ledger (`app_settings.radar.signals`) + `catalyst_events`. KHÔNG gọi mạng.
//
// Trả lời câu hỏi: trong các outlier radar đã ghi, bao nhiêu % có ít nhất một
// catalyst, tách theo nguồn (announcement / RSS / unlock) và theo loại outlier
// (gainer / loser / unusual), kèm danh sách outlier không có catalyst để đọc tay.
//
// Tín hiệu cũ (ghi trước RADAR-06-LEDGER) không có nhãn → match lại tại đúng thời
// điểm ghi bằng facts còn hạn trong DB (matching là pure). Vì vậy số liệu mang
// tính mô tả: fact hết TTL (news 14d, announcement 30d) sẽ rời khỏi mẫu.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { matchCatalystsForSymbol } from "./matching";
import { readRecentCatalystFacts } from "./store";
import type { CatalystFact } from "./types";

const SIGNALS_KEY = "radar.signals";
const GAP_LIMIT = 40;

export type CatalystSourceGroup = "announcement" | "rss" | "unlock";

export interface CoverageSignal {
  symbol: string;
  side: string;
  bias: string;
  score: number;
  at: string;
  /** Nhãn đã lưu khi ghi (RADAR-06-LEDGER); thiếu → match lại từ catalyst_events. */
  hasCatalyst?: boolean;
  catalystSources?: string[];
}

export interface CatalystCoverageGroup {
  key: string;
  label: string;
  total: number;
  covered: number;
  coveragePct: number | null;
  bySource: Record<CatalystSourceGroup, number>;
  sourcePct: Record<CatalystSourceGroup, number | null>;
}

export interface CatalystCoverageGap {
  symbol: string;
  side: string;
  bias: string;
  score: number;
  at: string;
  /** Số lần symbol xuất hiện như outlier không catalyst trong cửa sổ ledger. */
  occurrences: number;
}

export interface CatalystCoverageReport {
  generatedAt: string;
  totalSignals: number;
  outliers: number;
  factsAvailable: number;
  totals: CatalystCoverageGroup;
  bySide: CatalystCoverageGroup[];
  gaps: CatalystCoverageGap[];
  gapTotal: number;
  note: string;
}

export const COVERAGE_SIDE_LABELS: Record<string, string> = {
  gainer: "Top gainer",
  loser: "Top loser",
  unusual: "Unusual",
  neutral: "Neutral",
};

const SOURCE_GROUPS: CatalystSourceGroup[] = ["announcement", "rss", "unlock"];

export function catalystSourceGroup(source: string): CatalystSourceGroup | null {
  if (source === "BINANCE_ANNOUNCEMENT") return "announcement";
  if (source.startsWith("RSS_")) return "rss";
  if (source === "EVENT_RISKS_UNLOCK") return "unlock";
  return null;
}

function pct(part: number, total: number): number | null {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

export const CATALYST_COVERAGE_NOTE =
  "Độ phủ tính trên outlier radar đã ghi (gainer/loser/unusual, loại neutral). Nhãn lấy từ lần ghi nếu có; " +
  "tín hiệu cũ được match lại tại đúng thời điểm ghi với facts còn hạn trong catalyst_events nên số liệu có thể " +
  "giảm khi fact hết TTL. Đây là thống kê mô tả, không phải cam kết nguyên nhân và không tham gia scoring.";

function normalizeSignals(value: unknown): CoverageSignal[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (signal): signal is Record<string, unknown> =>
        Boolean(signal) &&
        typeof signal === "object" &&
        typeof (signal as { symbol?: unknown }).symbol === "string" &&
        typeof (signal as { at?: unknown }).at === "string" &&
        Number.isFinite(Date.parse((signal as { at: string }).at))
    )
    .map((signal) => ({
      symbol: String(signal.symbol),
      side: typeof signal.side === "string" ? signal.side : "unknown",
      bias: typeof signal.bias === "string" ? signal.bias : "unknown",
      score: Number.isFinite(Number(signal.score)) ? Number(signal.score) : 0,
      at: String(signal.at),
      hasCatalyst: typeof signal.hasCatalyst === "boolean" ? signal.hasCatalyst : undefined,
      catalystSources: Array.isArray(signal.catalystSources)
        ? signal.catalystSources.filter((s): s is string => typeof s === "string")
        : undefined,
    }));
}

interface Classified {
  signal: CoverageSignal;
  covered: boolean;
  groups: Set<CatalystSourceGroup>;
}

/** Nhãn đã lưu ưu tiên; thiếu thì match lại tại thời điểm ghi (pure, không mạng). */
function classify(signal: CoverageSignal, facts: CatalystFact[]): Classified {
  let covered: boolean;
  let sources: string[];

  if (typeof signal.hasCatalyst === "boolean") {
    covered = signal.hasCatalyst;
    sources = signal.catalystSources ?? [];
  } else {
    const at = Date.parse(signal.at);
    const matched = matchCatalystsForSymbol(signal.symbol, facts, Number.isFinite(at) ? at : Date.now());
    covered = matched.length > 0;
    sources = matched.map((fact) => fact.source);
  }

  const groups = new Set<CatalystSourceGroup>();
  for (const source of sources) {
    const group = catalystSourceGroup(source);
    if (group) groups.add(group);
  }

  return { signal, covered, groups };
}

function buildGroup(key: string, label: string, rows: Classified[]): CatalystCoverageGroup {
  const total = rows.length;
  const covered = rows.filter((row) => row.covered).length;
  const bySource = {} as Record<CatalystSourceGroup, number>;
  for (const group of SOURCE_GROUPS) {
    bySource[group] = rows.filter((row) => row.groups.has(group)).length;
  }
  return {
    key,
    label,
    total,
    covered,
    coveragePct: pct(covered, total),
    bySource,
    sourcePct: {
      announcement: pct(bySource.announcement, total),
      rss: pct(bySource.rss, total),
      unlock: pct(bySource.unlock, total),
    },
  };
}

function buildGaps(rows: Classified[], limit: number): { gaps: CatalystCoverageGap[]; gapTotal: number } {
  const bySymbol = new Map<string, CatalystCoverageGap>();
  for (const row of rows) {
    if (row.covered) continue;
    const existing = bySymbol.get(row.signal.symbol);
    if (existing) {
      existing.occurrences += 1;
      if (Date.parse(row.signal.at) > Date.parse(existing.at)) {
        existing.at = row.signal.at;
        existing.side = row.signal.side;
        existing.bias = row.signal.bias;
        existing.score = row.signal.score;
      }
      continue;
    }
    bySymbol.set(row.signal.symbol, {
      symbol: row.signal.symbol,
      side: row.signal.side,
      bias: row.signal.bias,
      score: row.signal.score,
      at: row.signal.at,
      occurrences: 1,
    });
  }

  const all = [...bySymbol.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return { gaps: all.slice(0, limit), gapTotal: all.length };
}

/**
 * Pure: dựng báo cáo độ phủ từ ledger + facts. Test không cần DB/mạng.
 */
export function buildCatalystCoverageReport(
  signals: CoverageSignal[],
  facts: CatalystFact[],
  options: { now?: number; gapLimit?: number } = {}
): CatalystCoverageReport {
  const outliers = signals.filter((signal) => signal.side !== "neutral");
  const classified = outliers.map((signal) => classify(signal, facts));

  const sideKeys: string[] = ["gainer", "loser", "unusual"];
  for (const signal of outliers) {
    if (!sideKeys.includes(signal.side)) sideKeys.push(signal.side);
  }
  const bySide = sideKeys
    .map((key) => {
      const rows = classified.filter((row) => row.signal.side === key);
      return buildGroup(key, COVERAGE_SIDE_LABELS[key] ?? key, rows);
    })
    .filter((group) => group.total > 0);

  const { gaps, gapTotal } = buildGaps(classified, Math.max(0, options.gapLimit ?? GAP_LIMIT));

  return {
    generatedAt: new Date(options.now ?? Date.now()).toISOString(),
    totalSignals: signals.length,
    outliers: outliers.length,
    factsAvailable: facts.length,
    totals: buildGroup("all", "Tất cả outlier", classified),
    bySide,
    gaps,
    gapTotal,
    note: CATALYST_COVERAGE_NOTE,
  };
}

/** Đọc ledger + catalyst_events từ DB (không gọi mạng) rồi dựng báo cáo. */
export async function readCatalystCoverageReport(now = Date.now()): Promise<CatalystCoverageReport> {
  let signals: CoverageSignal[] = [];
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SIGNALS_KEY)).limit(1);
    signals = normalizeSignals(row?.value);
  } catch (error) {
    console.warn(
      "[CATALYST-COVERAGE] Không đọc được signal ledger:",
      error instanceof Error ? error.message : String(error)
    );
  }

  let facts: CatalystFact[] = [];
  try {
    facts = await readRecentCatalystFacts({ sinceDays: 14, limit: 500, now });
  } catch (error) {
    console.warn(
      "[CATALYST-COVERAGE] Không đọc được catalyst_events:",
      error instanceof Error ? error.message : String(error)
    );
  }

  return buildCatalystCoverageReport(signals, facts, { now });
}
