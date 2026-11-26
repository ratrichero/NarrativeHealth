// RADAR-ALERTS: gửi webhook khi có tín hiệu đủ mạnh, dedupe theo ngày.
// Webhook generic (Slack/Discord/Telegram bridge đều nhận JSON có `text`).
// Không cấu hình URL = no-op; không chặn luồng radar.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { RadarRow, RadarMarketContext } from "@/lib/market/radar";
import { isBearishBias, isBullishBias } from "@/lib/market/ledger";
import type { ClusterEvent } from "@/lib/market/cluster-history";
import { biasDirection } from "@/lib/market/bias-state";
import type { Bias } from "@/lib/market/scoring";
import { matchCatalystsForSymbol } from "@/lib/catalyst/matching";
import { readRecentCatalystFacts } from "@/lib/catalyst/store";
import type { CatalystFact } from "@/lib/catalyst/types";
import { peekRadarRuntimeConfig, readRadarRuntimeConfig } from "@/lib/settings/radar-config";

const KEY = "radar.alerts.sent";
const CLUSTER_KEY = "radar.alerts.clusters.sent";
const INVALIDATION_KEY = "radar.alerts.invalidations.sent";
const MAX_SENT = 200;
const KEEP_DAYS = 7;
/** Số fact tối đa kèm một alert catalyst (1–3, đủ để đọc, không thành bài báo). */
export const CATALYST_ALERT_FACT_LIMIT = 3;

export interface SentAlert {
  key: string;
  at: string;
  symbol: string;
  /** Fact dẫn dắt alert catalyst — chỉ để đọc lại lịch sử, dedupe nằm ở `key`. */
  externalId?: string;
}

export interface AlertOptions {
  minScore: number;
  minEntryQuality: number;
  maxImpulseAgeHours: number;
  cooldownHours: number;
}

export function alertOptions(): AlertOptions {
  const cfg = peekRadarRuntimeConfig();
  return {
    minScore: cfg.alertMinScore,
    minEntryQuality: cfg.alertMinEntry,
    maxImpulseAgeHours: cfg.alertMaxImpulseHours,
    cooldownHours: cfg.alertCooldownHours,
  };
}

export function alertKey(row: RadarRow, day: string): string {
  return `${row.symbol}|${row.bias}|${day}`;
}

function passesAlertThresholds(row: RadarRow, opts: AlertOptions): boolean {
  if (row.bias === "neutral") return false;
  if (!isBullishBias(row.bias) && !isBearishBias(row.bias)) return false;
  if (row.score < opts.minScore || row.entryQuality < opts.minEntryQuality) return false;
  if (row.impulseAgeHours !== null && row.impulseAgeHours !== undefined && row.impulseAgeHours > opts.maxImpulseAgeHours) {
    return false;
  }
  return true;
}

export function selectAlertRows(
  rows: RadarRow[],
  sentKeys: Set<string>,
  day: string,
  opts: AlertOptions = alertOptions()
): RadarRow[] {
  return rows.filter(
    (row) => passesAlertThresholds(row, opts) && !sentKeys.has(alertKey(row, day))
  );
}

/** RADAR-06: dedupe alert catalyst theo symbol + externalId của fact. */
export function catalystAlertKey(symbol: string, externalId: string): string {
  return `catalyst|${symbol.toUpperCase()}|${externalId}`;
}

export interface AlertCandidate {
  row: RadarRow;
  facts: CatalystFact[];
  key: string;
}

/**
 * Chọn alert kèm fact (RADAR-06). Row `catalystTriggered` + đạt ngưỡng RADAR-03
 * → gửi 1–3 fact có link và dedupe theo `symbol|externalId`; announcement được
 * sync 5 phút/lần nhưng cùng externalId chỉ báo một lần. Row không có fact khớp
 * (hoặc không trigger) quay về dedupe symbol+bias+ngày như cũ.
 *
 * Cooldown symbol vẫn áp dụng trước (hạ tầng RADAR-03), nên nhiều announcement
 * khác nhau trong cùng 6 giờ không dội alert.
 */
export function selectAlertCandidates(
  rows: RadarRow[],
  sentKeys: Set<string>,
  coolingSymbols: Set<string>,
  day: string,
  opts: AlertOptions = alertOptions(),
  factsFor: (row: RadarRow) => CatalystFact[] = () => []
): AlertCandidate[] {
  const candidates: AlertCandidate[] = [];

  for (const row of rows) {
    if (!passesAlertThresholds(row, opts)) continue;
    if (coolingSymbols.has(row.symbol)) continue;

    const facts = row.catalystTriggered
      ? factsFor(row).slice(0, CATALYST_ALERT_FACT_LIMIT)
      : [];
    const key = facts.length > 0 ? catalystAlertKey(row.symbol, facts[0].externalId) : alertKey(row, day);
    if (sentKeys.has(key)) continue;

    candidates.push({ row, facts, key });
  }

  return candidates;
}

/** Nội dung alert radar — kèm 1–3 fact có link khi là catalyst-driven outlier. */
export function buildRadarAlertText(
  row: RadarRow,
  market: RadarMarketContext,
  facts: CatalystFact[] = []
): string {
  const direction = isBullishBias(row.bias) ? "LONG watch" : "SHORT watch";
  const shown = facts.slice(0, CATALYST_ALERT_FACT_LIMIT);
  const headline = shown.length > 0 ? `[Radar · catalyst] ${direction} $${row.symbol}` : `[Radar] ${direction} $${row.symbol}`;

  return [
    headline,
    `${row.label} · score ${row.score}/100 · freshness ${row.entryQuality}/100`,
    `Giá ${row.price} · 24h ${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%`,
    row.impulseAgeHours !== null && row.impulseAgeHours !== undefined
      ? `Impulse ${row.impulseAgeHours.toFixed(1)}h · extension ${row.impulseExtensionAtr ?? "—"} ATR`
      : null,
    row.clusterLabel ? `Cluster: ${row.clusterLabel} (${row.clusterSize} coin)` : null,
    `Regime: ${market.regime} · BTC ${market.btcChangePct?.toFixed(2) ?? "—"}%`,
    ...(shown.length > 0
      ? [
          `Catalyst (${shown.length} fact còn trong cửa sổ):`,
          ...shown.flatMap((fact) => [`• [${fact.type}] ${fact.title}`, `  ${fact.sourceUrl}`]),
        ]
      : []),
    "Không phải khuyến nghị đầu tư.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Dedupe theo ngày + cooldown cùng symbol trong `cooldownHours` giờ. */
export function selectCooldownRows(
  rows: RadarRow[],
  sent: SentAlert[],
  day: string,
  opts: AlertOptions = alertOptions(),
  now = Date.now()
): RadarRow[] {
  const keys = new Set(sent.map((item) => item.key));
  const cooldownStart = now - opts.cooldownHours * 3_600_000;
  const cooling = new Set(
    sent
      .filter((item) => Date.parse(item.at) >= cooldownStart)
      .map((item) => item.symbol)
  );
  return selectAlertRows(rows, keys, day, opts).filter(
    (row) => !cooling.has(row.symbol)
  );
}

async function readSent(key = KEY): Promise<SentAlert[]> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    if (!Array.isArray(row?.value)) return [];
    return row.value.filter(
      (s): s is SentAlert =>
        Boolean(s) && typeof s === "object" && typeof (s as SentAlert).key === "string"
    );
  } catch {
    return [];
  }
}

async function writeSent(sent: SentAlert[], key = KEY): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value: sent, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sent, updatedAt: new Date() },
    });
}

export function clusterAlertKey(event: ClusterEvent, day: string): string {
  return `${event.side}|${event.clusterId}|${event.type}|${day}`;
}

export function selectClusterAlertEvents(
  events: ClusterEvent[],
  sentKeys: Set<string>,
  day: string
): ClusterEvent[] {
  return events.filter((event) => !sentKeys.has(clusterAlertKey(event, day)));
}

/**
 * Gửi webhook cho các row đủ mạnh. Trả số alert đã gửi.
 * Lỗi webhook/DB đều bị nuốt để không ảnh hưởng radar.
 */
export async function dispatchRadarAlerts(
  rows: RadarRow[],
  market: RadarMarketContext
): Promise<number> {
  if (process.env.NODE_ENV === "test" || process.env.RADAR_DEMO === "1") return 0;
  await readRadarRuntimeConfig();
  const url = peekRadarRuntimeConfig().alertWebhookUrl;
  if (!url) return 0;

  const day = new Date().toISOString().slice(0, 10);
  const sent = await readSent();
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const kept = sent.filter((s) => {
    const at = new Date(s.at).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
  const opts = alertOptions();
  const keys = new Set(kept.map((s) => s.key));
  const cooldownStart = Date.now() - opts.cooldownHours * 3_600_000;
  const cooling = new Set(
    kept.filter((s) => Date.parse(s.at) >= cooldownStart).map((s) => s.symbol)
  );

  // Fact đã sync sẵn trong catalyst_events — alert không gọi mạng, chỉ đọc DB.
  // Cửa sổ matching rộng nhất là 168h nên đọc 8 ngày; match lại tại `now`.
  const factsBySymbol = new Map<string, CatalystFact[]>();
  const catalyticRows = rows.filter((row) => row.catalystTriggered);
  if (catalyticRows.length > 0) {
    try {
      const facts = await readRecentCatalystFacts({ sinceDays: 8, limit: 500 });
      for (const row of catalyticRows) {
        if (factsBySymbol.has(row.symbol)) continue;
        factsBySymbol.set(
          row.symbol,
          matchCatalystsForSymbol(row.symbol, facts, Date.now(), CATALYST_ALERT_FACT_LIMIT)
        );
      }
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Không đọc được catalyst facts:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const candidates = selectAlertCandidates(rows, keys, cooling, day, opts, (row) =>
    factsBySymbol.get(row.symbol) ?? []
  ).filter((candidate) => !isMuted(candidate.row.symbol));
  if (candidates.length === 0 || inQuietHours()) return 0;

  // Digest: gộp nhiều tín hiệu vào một tin để không dội kênh khi thị trường động.
  if (process.env.RADAR_ALERT_DIGEST === "1" && candidates.length > 1) {
    const texts = candidates.map(({ row, facts }) => buildRadarAlertText(row, market, facts));
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `[Radar] ${candidates.length} tín hiệu mới\n\n${texts.join("\n\n---\n\n")}`,
          digest: true,
          count: candidates.length,
          at: new Date().toISOString(),
          url: "/radar",
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return 0;
      for (const { row, key } of candidates) {
        kept.push({ key, at: new Date().toISOString(), symbol: row.symbol });
      }
      await writeSent(kept.slice(-MAX_SENT)).catch(() => undefined);
      return 1;
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Webhook digest lỗi:",
        error instanceof Error ? error.message : String(error)
      );
      return 0;
    }
  }

  let delivered = 0;
  for (const candidate of candidates) {
    const { row, facts, key } = candidate;
    const text = buildRadarAlertText(row, market, facts);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          symbol: row.symbol,
          bias: row.bias,
          score: row.score,
          price: row.price,
          at: new Date().toISOString(),
          url: `/radar?symbol=${row.symbol}`,
          ...(facts.length > 0
            ? {
                catalyst: true,
                facts: facts.map((fact) => ({
                  externalId: fact.externalId,
                  type: fact.type,
                  source: fact.source,
                  title: fact.title,
                  url: fact.sourceUrl,
                })),
              }
            : {}),
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      kept.push({
        key,
        at: new Date().toISOString(),
        symbol: row.symbol,
        ...(facts.length > 0 ? { externalId: facts[0].externalId } : {}),
      });
      delivered += 1;
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Webhook lỗi:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  if (delivered > 0) {
    try {
      await writeSent(kept.slice(-MAX_SENT));
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Không lưu được sent:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  return delivered;
}

export interface StateAlertInput {
  symbol: string;
  side: string;
  /** Nhãn của tín hiệu cũ (không phải nhãn vừa chấm). */
  bias: Bias;
  /** Giá hiện tại của row vừa chấm. */
  price: number;
  invalidationPrice: number | null;
  invalidationNote?: string | null;
  setup?: { entryLow: number; entryHigh: number } | null;
  /** Thời điểm ghi của tín hiệu — một phần của khoá dedupe. */
  prevAt: string;
}

export type StateAlertKind = "invalidation" | "entry-zone" | "missed-entry";

export function stateAlertKey(input: StateAlertInput, kind: StateAlertKind): string {
  return `state|${kind}|${input.symbol}|${input.side}|${input.prevAt}`;
}

/** Nhãn đã bị giá vượt qua mốc vô hiệu chưa. */
export function isInvalidated(input: StateAlertInput): boolean {
  const level = input.invalidationPrice;
  if (level === null || !Number.isFinite(level) || !Number.isFinite(input.price)) return false;
  const direction = biasDirection(input.bias);
  if (direction === 1) return input.price <= level;
  if (direction === -1) return input.price >= level;
  return false;
}

/**
 * Trạng thái vùng entry của tín hiệu cũ: giá đã vào vùng (có thể khớp), đã bỏ
 * lỡ (đi quá 1% ra ngoài), hoặc còn chờ (null — không báo để tránh nhiễu).
 */
export function entryZoneState(
  input: StateAlertInput
): "in-zone" | "missed" | null {
  if (!input.setup) return null;
  const direction = biasDirection(input.bias);
  if (direction === 0) return null;
  const { entryLow, entryHigh } = input.setup;
  if (!Number.isFinite(entryLow) || !Number.isFinite(entryHigh)) return null;
  if (input.price >= entryLow && input.price <= entryHigh) return "in-zone";
  if (direction === 1 && input.price > entryHigh * 1.01) return "missed";
  if (direction === -1 && input.price < entryLow * 0.99) return "missed";
  return null;
}

export interface SelectedStateAlert {
  input: StateAlertInput;
  kind: StateAlertKind;
}

/** Chọn cảnh báo trạng thái chưa gửi cho đúng lần ghi đó. */
export function selectStateAlerts(
  inputs: StateAlertInput[],
  sentKeys: Set<string>
): SelectedStateAlert[] {
  const selected: SelectedStateAlert[] = [];
  for (const input of inputs) {
    if (isInvalidated(input)) {
      if (!sentKeys.has(stateAlertKey(input, "invalidation"))) {
        selected.push({ input, kind: "invalidation" });
      }
      continue;
    }
    const zone = entryZoneState(input);
    const kind: StateAlertKind | null =
      zone === "in-zone" ? "entry-zone" : zone === "missed" ? "missed-entry" : null;
    if (kind && !sentKeys.has(stateAlertKey(input, kind))) {
      selected.push({ input, kind });
    }
  }
  return selected;
}

function stateAlertText(
  input: StateAlertInput,
  kind: StateAlertKind,
  market: RadarMarketContext
): string {
  const headline =
    kind === "invalidation"
      ? `[Radar] Nhãn vô hiệu: $${input.symbol} (${input.side})`
      : kind === "entry-zone"
        ? `[Radar] Giá vào vùng entry: $${input.symbol} (${input.side})`
        : `[Radar] Bỏ lỡ vùng entry: $${input.symbol} (${input.side})`;
  const detail =
    kind === "invalidation"
      ? `Nhãn ${input.bias} không còn đúng — giá ${pct(input.price)} đã vượt mốc vô hiệu ${input.invalidationPrice}.`
      : kind === "entry-zone"
        ? `Giá ${pct(input.price)} đã vào vùng ${input.setup?.entryLow}–${input.setup?.entryHigh} của tín hiệu ${input.bias}.`
        : `Giá ${pct(input.price)} đã đi quá vùng entry ${input.setup?.entryLow}–${input.setup?.entryHigh} — đừng đuổi.`;
  return [
    headline,
    detail,
    input.invalidationNote ? `Điều kiện vô hiệu: ${input.invalidationNote}.` : null,
    `Regime: ${market.regime} · BTC ${market.btcChangePct?.toFixed(2) ?? "—"}%`,
    "Không phải khuyến nghị đầu tư.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Muted symbols qua `RADAR_ALERT_MUTED=BTC,ETH` — tắt alert cho coin ồn. */
function isMuted(symbol: string): boolean {
  const list = (process.env.RADAR_ALERT_MUTED ?? "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return list.includes(symbol.toUpperCase());
}

/** Quiet hours qua `RADAR_ALERT_QUIET_UTC=22-7` (có thể qua đêm). */
function inQuietHours(now = new Date()): boolean {
  const raw = process.env.RADAR_ALERT_QUIET_UTC?.trim();
  if (!raw) return false;
  const [startRaw, endRaw] = raw.split("-");
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const hour = now.getUTCHours();
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Gửi cảnh báo trạng thái (vô hiệu / vào vùng entry / bỏ lỡ entry). */
export async function dispatchStateAlerts(
  inputs: StateAlertInput[],
  market: RadarMarketContext
): Promise<number> {
  if (process.env.NODE_ENV === "test" || process.env.RADAR_DEMO === "1") return 0;
  if (inputs.length === 0 || inQuietHours()) return 0;
  const url = peekRadarRuntimeConfig().alertWebhookUrl;
  if (!url) return 0;

  const sent = await readSent(INVALIDATION_KEY);
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const kept = sent.filter((item) => {
    const at = new Date(item.at).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
  const keys = new Set(kept.map((item) => item.key));
  const candidates = selectStateAlerts(
    inputs.filter((input) => !isMuted(input.symbol)),
    keys
  );
  if (candidates.length === 0) return 0;

  let delivered = 0;
  for (const candidate of candidates) {
    const { input, kind } = candidate;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: stateAlertText(input, kind, market),
          symbol: input.symbol,
          bias: input.bias,
          price: input.price,
          event: kind,
          at: new Date().toISOString(),
          url: `/radar?symbol=${input.symbol}`,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      kept.push({
        key: stateAlertKey(input, kind),
        at: new Date().toISOString(),
        symbol: input.symbol,
      });
      delivered += 1;
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Webhook state lỗi:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  if (delivered > 0) {
    try {
      await writeSent(kept.slice(-MAX_SENT), INVALIDATION_KEY);
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Không lưu được state sent:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  return delivered;
}

function pct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/**
 * Gửi cảnh báo cấp cụm: cụm mới, leader đổi, mạnh/yếu đi.
 * Dùng chung webhook với alert row; dedupe theo side+cluster+event+ngày.
 */
export async function dispatchClusterAlerts(
  events: ClusterEvent[],
  market: RadarMarketContext
): Promise<number> {
  if (process.env.NODE_ENV === "test" || process.env.RADAR_DEMO === "1") return 0;
  if (events.length === 0) return 0;
  const url = peekRadarRuntimeConfig().alertWebhookUrl;
  if (!url) return 0;

  const day = new Date().toISOString().slice(0, 10);
  const sent = await readSent(CLUSTER_KEY);
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const kept = sent.filter((item) => {
    const at = new Date(item.at).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
  const keys = new Set(kept.map((item) => item.key));
  const candidates = selectClusterAlertEvents(events, keys, day);
  if (candidates.length === 0) return 0;

  let delivered = 0;
  for (const event of candidates) {
    const title =
      event.type === "new"
        ? "Cụm mới"
        : event.type === "leader-change"
          ? "Leader đổi"
          : event.type === "strengthening"
            ? "Cụm mạnh lên"
            : "Cụm yếu đi";
    const lines = [
      `[Radar] ${title}: ${event.label} (${event.side})`,
      `${event.size} coin · TB 24h ${pct(event.avgChangePct)} · ${event.direction === "up" ? "cụm tăng" : "cụm giảm"}`,
      event.type === "leader-change"
        ? `Leader: $${event.leader ?? "—"} · trước $${event.previousLeader ?? "—"}`
        : `Leader: $${event.leader ?? "—"}`,
      event.type === "strengthening" || event.type === "weakening"
        ? `Sức mạnh ${event.deltaPct !== undefined && event.deltaPct > 0 ? "tăng" : "giảm"} ${Math.abs(event.deltaPct ?? 0).toFixed(2)} điểm % so với lần trước`
        : null,
      event.members.length > 0
        ? `Members: ${event.members.slice(0, 10).join(", ")}${event.members.length > 10 ? ` +${event.members.length - 10}` : ""}`
        : null,
      `Regime: ${market.regime} · BTC ${market.btcChangePct?.toFixed(2) ?? "—"}%`,
      "Không phải khuyến nghị đầu tư.",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: lines,
          clusterId: event.clusterId,
          clusterLabel: event.label,
          event: event.type,
          side: event.side,
          at: new Date().toISOString(),
          url: `/radar?side=${event.side}&cluster=${encodeURIComponent(event.clusterId)}`,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      kept.push({
        key: clusterAlertKey(event, day),
        at: new Date().toISOString(),
        symbol: event.clusterId,
      });
      delivered += 1;
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Webhook cluster lỗi:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  if (delivered > 0) {
    try {
      await writeSent(kept.slice(-MAX_SENT), CLUSTER_KEY);
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Không lưu được cluster sent:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  return delivered;
}
