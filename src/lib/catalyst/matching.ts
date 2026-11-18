// RADAR-06 — ghép catalyst với một coin và quyết định có hiển thị panel
// “vì sao volume bất thường” hay không. Pure, test được.

import { peekRadarRuntimeConfig } from "@/lib/settings/radar-config";
import { titleMentionsSymbol } from "./normalize";
import type { CatalystFact, CatalystType } from "./types";

/** Cửa sổ thời gian theo loại catalyst (giờ, quanh thời điểm hiện tại). */
export const CATALYST_WINDOWS: Record<CatalystType, { beforeHours: number; afterHours: number }> = {
  LISTING: { beforeHours: 72, afterHours: 24 },
  FUTURES_LAUNCH: { beforeHours: 72, afterHours: 24 },
  DELISTING: { beforeHours: 168, afterHours: 24 },
  MONITORING_TAG: { beforeHours: 168, afterHours: 24 },
  NEWS: { beforeHours: 24, afterHours: 6 },
  UNLOCK: { beforeHours: 168, afterHours: 48 },
};

/** Thứ tự ưu tiên hiển thị: unlock/announcement cụ thể trước news chung. */
const TYPE_PRIORITY: Record<CatalystType, number> = {
  UNLOCK: 0,
  DELISTING: 1,
  LISTING: 2,
  FUTURES_LAUNCH: 3,
  MONITORING_TAG: 4,
  NEWS: 5,
};

const HOUR = 3_600_000;

export interface CatalystTriggerInput {
  volumeZ?: number | null;
  volumeRatio7d?: number | null;
  changePct?: number | null;
  clusterLeader?: boolean;
}

export interface CatalystTriggerOptions {
  volumeZ: number;
  volumeRatio: number;
  absChangePct: number;
}

export function catalystTriggerOptions(): CatalystTriggerOptions {
  const cfg = peekRadarRuntimeConfig();
  return {
    volumeZ: cfg.catalystTriggerVolumeZ,
    volumeRatio: cfg.catalystTriggerVolumeRatio,
    absChangePct: cfg.catalystTriggerAbsChangePct,
  };
}

/** Owner chốt: volume bất thường = volumeZ cao HOẶC volume ratio cao HOẶC |change| lớn. */
export function shouldExplainCatalyst(
  input: CatalystTriggerInput,
  options: CatalystTriggerOptions = catalystTriggerOptions()
): boolean {
  if (input.clusterLeader) return true;
  if (typeof input.volumeZ === "number" && input.volumeZ >= options.volumeZ) return true;
  if (typeof input.volumeRatio7d === "number" && input.volumeRatio7d >= options.volumeRatio) return true;
  if (typeof input.changePct === "number" && Math.abs(input.changePct) >= options.absChangePct) return true;
  return false;
}

function inWindow(fact: CatalystFact, now: number): boolean {
  const window = CATALYST_WINDOWS[fact.type] ?? CATALYST_WINDOWS.NEWS;

  if (fact.type === "UNLOCK") {
    if (!fact.eventDate) return false;
    const eventAt = Date.parse(`${fact.eventDate}T00:00:00Z`);
    if (!Number.isFinite(eventAt)) return false;
    return eventAt >= now - window.beforeHours * HOUR && eventAt <= now + window.afterHours * HOUR;
  }

  const published = Date.parse(fact.publishedAt);
  if (!Number.isFinite(published)) return false;
  return published >= now - window.beforeHours * HOUR && published <= now + window.afterHours * HOUR;
}

export function factMentionsSymbol(fact: CatalystFact, symbol: string): boolean {
  const sym = symbol.toUpperCase();
  if (fact.symbols.includes(sym)) return true;
  return titleMentionsSymbol(fact.title, sym);
}

/**
 * Trả facts khớp symbol trong cửa sổ thời gian, dedupe theo (source, externalId),
 * sắp theo loại rồi mới nhất, tối đa `limit`.
 */
export function matchCatalystsForSymbol(
  symbol: string,
  facts: CatalystFact[],
  now = Date.now(),
  limit = 5
): CatalystFact[] {
  const seen = new Set<string>();
  const matched: CatalystFact[] = [];

  for (const fact of facts) {
    if (!factMentionsSymbol(fact, symbol)) continue;
    if (!inWindow(fact, now)) continue;
    const key = `${fact.source}|${fact.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matched.push(fact);
  }

  return matched
    .sort((a, b) => {
      const priority = TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type];
      if (priority !== 0) return priority;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    })
    .slice(0, limit);
}
