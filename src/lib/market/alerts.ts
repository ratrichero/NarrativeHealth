// RADAR-ALERTS: gửi alert khi có tín hiệu đủ mạnh, dedupe theo ngày.
// Hai kênh: webhook generic (Slack/Discord/bridge — JSON có `text`, shape cũ)
// và Telegram native nhiều chat/topic (RADAR-TG). Không cấu hình kênh nào =
// no-op; lỗi kênh không chặn luồng radar.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { RadarRow, RadarMarketContext } from "@/lib/market/radar";
import { isBearishBias, isBullishBias } from "@/lib/market/ledger";
import type { ClusterEvent } from "@/lib/market/cluster-history";
import { matchCatalystsForSymbol } from "@/lib/catalyst/matching";
import { readRecentCatalystFacts } from "@/lib/catalyst/store";
import type { CatalystFact } from "@/lib/catalyst/types";
import { peekRadarRuntimeConfig, readRadarRuntimeConfig } from "@/lib/settings/radar-config";
import { buildSetup, type SetupLevels } from "@/lib/market/setup";
import {
  escapeTelegramHtml,
  type TelegramInlineButton,
} from "@/lib/services/alert-delivery.service";
import {
  RADAR_ALERTS_SENT_KEY,
  RADAR_CLUSTER_ALERTS_SENT_KEY,
  drainRadarAlertOutbox,
  enqueueRadarOutbox,
  type RadarOutboxDelivery,
} from "@/lib/market/alert-outbox";
import { readActiveRadarSubscribers, type RadarSubscriber } from "@/lib/radar/subscribers";
import { alertDeliveryPolicy, type CohortMode } from "@/lib/market/fast-lane";
import {
  RADAR_TELEGRAM_TARGETS_ENV,
  parseRadarTelegramTargets,
  type RadarTelegramTarget,
} from "@/lib/settings/radar-telegram-targets";

// Re-export để code/test cũ vẫn import từ `@/lib/market/alerts` như trước.
export { RADAR_TELEGRAM_TARGETS_ENV, parseRadarTelegramTargets };
export type { RadarTelegramTarget };

const KEY = RADAR_ALERTS_SENT_KEY;
const CLUSTER_KEY = RADAR_CLUSTER_ALERTS_SENT_KEY;
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

// ─── RADAR-ALERT-METRICS: tier của alert ─────────────────────────────────
// Tier là dữ liệu để đo sent/failed/suppressed theo tầng, không phải if/else
// rải rác. Ngưỡng khởi điểm lấy từ kế hoạch Radar → Telegram; chỉnh sau khi có
// dữ liệu. Row đã qua ngưỡng alert chung nên tối thiểu là WATCH.
export type RadarAlertTier = "URGENT" | "ACTIONABLE" | "WATCH";

export const ALERT_TIER_URGENT = {
  minScore: 85,
  minEntryQuality: 70,
  maxImpulseAgeHours: 3,
} as const;

export const ALERT_TIER_ACTIONABLE = {
  minScore: 75,
  minEntryQuality: 50,
  maxImpulseAgeHours: 12,
} as const;

export const ALERT_TIER_WATCH_MIN_SCORE = 65;

/** URGENT cần xác nhận thêm: catalyst hoặc nằm trong cụm ≥ 3 coin. */
export function classifyAlertTier(row: RadarRow): RadarAlertTier | null {
  const impulse = row.impulseAgeHours;
  const freshEnough = (max: number) => impulse === null || impulse === undefined || impulse <= max;
  const confirmed = row.catalystTriggered === true || (row.clusterSize ?? 1) >= 3;

  if (
    row.score >= ALERT_TIER_URGENT.minScore &&
    row.entryQuality >= ALERT_TIER_URGENT.minEntryQuality &&
    freshEnough(ALERT_TIER_URGENT.maxImpulseAgeHours) &&
    confirmed
  ) {
    return "URGENT";
  }
  if (
    row.score >= ALERT_TIER_ACTIONABLE.minScore &&
    row.entryQuality >= ALERT_TIER_ACTIONABLE.minEntryQuality &&
    freshEnough(ALERT_TIER_ACTIONABLE.maxImpulseAgeHours)
  ) {
    return "ACTIONABLE";
  }
  if (row.score >= ALERT_TIER_WATCH_MIN_SCORE) return "WATCH";
  return null;
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

// ─── RADAR-TG: Telegram native + nhiều chat/topic ─────────────────────────
//
// Trước đây alert Radar chỉ POST JSON tới một `alertWebhookUrl`; muốn có
// Telegram phải dựng bridge bên ngoài. Khối này nối thẳng vào adapter Telegram
// của alert-delivery (cùng `TELEGRAM_BOT_TOKEN`) nhưng cấu hình riêng, để một
// lượt alert đi đồng thời tới kênh công khai, group trả phí (topic riêng) và
// DM admin — mỗi target có label + ngưỡng score riêng.
//
// Danh sách kênh nay là một field của radar runtime config
// (`telegramTargets`, DB > env); `RADAR_TELEGRAM_TARGETS` chỉ còn là fallback.
// Alert đọc qua `peekRadarRuntimeConfig()` sau khi `dispatch*` đã await bản
// async, nên sửa kênh/topic/minScore trên Admin áp dụng ngay (cache 10 giây).
//
// Webhook cũ vẫn nhận đúng payload cũ — Telegram là kênh THÊM, không thay thế.
/** Gốc URL công khai để dựng deep link/nút; thiếu thì bỏ nút Radar. */
export const RADAR_PUBLIC_URL_ENV = "RADAR_PUBLIC_URL";

/** Fallback env-only; config runtime dùng `telegramTargets` trong snapshot. */
export function radarTelegramTargets(): RadarTelegramTarget[] {
  return parseRadarTelegramTargets(process.env[RADAR_TELEGRAM_TARGETS_ENV]);
}

/** Gộp target tĩnh (DB/env) với subscriber, bỏ trùng theo chat+topic. */
export function mergeRadarTelegramTargets(
  ...groups: RadarTelegramTarget[][]
): RadarTelegramTarget[] {
  const seen = new Set<string>();
  const merged: RadarTelegramTarget[] = [];
  for (const group of groups) {
    for (const target of group) {
      const key = `${target.chatId}:${target.threadId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(target);
    }
  }
  return merged;
}

/** Subscriber tối thiểu để dựng target — tách khỏi row DB cho dễ test. */
export interface RadarSubscriberTargetSource {
  id: number;
  chatId: string;
  threadId: number;
  minScore: number | null;
  status: string;
}

/**
 * RADAR-TG P4: kênh đích = target tĩnh (DB/env) + subscriber ACTIVE. Dedupe
 * theo chat+topic; target tĩnh đứng trước nên thắng khi trùng (giữ label/
 * ngưỡng cấu hình tay). "ACTIVE" được lọc lại ở đây dù DB đã lọc.
 */
export function buildRadarTelegramTargets(
  staticTargets: RadarTelegramTarget[],
  subscribers: RadarSubscriberTargetSource[]
): RadarTelegramTarget[] {
  const subscriberTargets: RadarTelegramTarget[] = subscribers
    .filter((subscriber) => subscriber.status === "ACTIVE")
    .map((subscriber) => ({
      chatId: subscriber.chatId,
      ...(subscriber.threadId > 0 ? { threadId: subscriber.threadId } : {}),
      label: `subscriber:${subscriber.id}`,
      ...(subscriber.minScore !== null ? { minScore: subscriber.minScore } : {}),
    }));
  return mergeRadarTelegramTargets(staticTargets, subscriberTargets);
}

/** Ngưỡng riêng của từng target lọc theo score của row. */
export function selectRadarTelegramTargets(
  targets: RadarTelegramTarget[],
  score: number
): RadarTelegramTarget[] {
  return targets.filter(
    (target) => target.minScore === undefined || score >= target.minScore
  );
}

/** Gốc URL công khai (http/https), bỏ dấu `/` cuối; thiếu/hỏng → null. */
export function radarPublicBaseUrl(): string | null {
  const raw = process.env[RADAR_PUBLIC_URL_ENV]?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 6;
  const text = value.toFixed(digits);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

function signedPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Entry/SL tham chiếu từ ATR, cùng công thức với trang chi tiết radar. */
export function radarSetupLevels(row: RadarRow): SetupLevels | null {
  if (!row.atrPct || row.atrPct <= 0) return null;
  const atr = (row.price * row.atrPct) / 100;
  if (isBullishBias(row.bias)) return buildSetup("BULLISH", row.price, atr);
  if (isBearishBias(row.bias)) return buildSetup("BEARISH", row.price, atr);
  return null;
}

export function buildRadarAlertButtons(
  row: RadarRow,
  baseUrl: string | null = radarPublicBaseUrl()
): TelegramInlineButton[] {
  const buttons: TelegramInlineButton[] = [
    { text: "Chart Binance", url: `https://www.binance.com/en/futures/${row.pair}` },
  ];
  if (baseUrl) {
    buttons.push({ text: "Mở Radar", url: `${baseUrl}/radar?symbol=${encodeURIComponent(row.symbol)}` });
  }
  return buttons;
}

function ictClock(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Tin Telegram dạng HTML: đủ để quyết định trong 30 giây — coin, vì sao, giá,
 * vùng entry + mức vô hiệu tham chiếu (owner đã cho phép), giờ ICT. Nút deep
 * link tách riêng ở `buildRadarAlertButtons`.
 */
export function buildRadarAlertHtml(
  row: RadarRow,
  market: RadarMarketContext,
  facts: CatalystFact[] = [],
  options: { baseUrl?: string | null; now?: Date } = {}
): string {
  const esc = escapeTelegramHtml;
  const bullish = isBullishBias(row.bias);
  const direction = bullish ? "LONG watch" : "SHORT watch";
  const shown = facts.slice(0, CATALYST_ALERT_FACT_LIMIT);
  const setup = radarSetupLevels(row);
  const invalidation = row.invalidationPrice;

  const lines: string[] = [
    `${bullish ? "🟢" : "🔴"} <b>RADAR</b> · <b>$${esc(row.symbol)}</b> · ${direction}`,
    `${esc(row.label)} · score <b>${row.score}</b>/100 · entry ${row.entryQuality}/100`,
    `Giá <b>${fmtPrice(row.price)}</b> · 24h ${signedPct(row.changePct)}${
      row.impulseAgeHours !== null && row.impulseAgeHours !== undefined
        ? ` · impulse ${row.impulseAgeHours.toFixed(1)}h`
        : ""
    }`,
  ];

  if (row.clusterLabel) {
    lines.push(`Cluster: ${esc(row.clusterLabel)} (${row.clusterSize ?? 1} coin)`);
  }
  lines.push(
    `Regime: ${esc(market.regime)} · BTC ${market.btcChangePct !== null ? signedPct(market.btcChangePct) : "—"}`
  );

  if (shown.length > 0) {
    lines.push("", "<b>Vì sao lúc này</b>");
    for (const fact of shown) {
      lines.push(`• <a href="${esc(fact.sourceUrl)}">[${esc(fact.type)}] ${esc(fact.title)}</a>`);
    }
  }

  if (setup || invalidation !== null && invalidation !== undefined) {
    lines.push("", "<b>Kế hoạch tham chiếu</b>");
    if (setup) {
      lines.push(`• Entry: ${fmtPrice(setup.entryLow)}–${fmtPrice(setup.entryHigh)}`);
    }
    if (invalidation !== null && invalidation !== undefined && Number.isFinite(invalidation)) {
      const distancePct = ((invalidation - row.price) / row.price) * 100;
      const note = row.invalidationNote ? ` · ${esc(row.invalidationNote)}` : "";
      lines.push(`• Vô hiệu: ${fmtPrice(invalidation)} (${signedPct(distancePct)})${note}`);
    }
  }

  lines.push("", `Cập nhật ${ictClock(options.now ?? new Date())} ICT · không phải khuyến nghị đầu tư.`);
  return lines.join("\n");
}

/** Payload webhook cũ — giữ nguyên shape để tích hợp hiện có không bị phá. */
export interface RadarWebhookPayload {
  text: string;
  symbol: string;
  bias: string;
  score: number;
  price: number;
  at: string;
  url: string;
  catalyst?: true;
  facts?: Array<{ externalId: string; type: string; source: string; title: string; url: string }>;
}

export function buildRadarWebhookPayload(
  row: RadarRow,
  market: RadarMarketContext,
  facts: CatalystFact[] = [],
  at: Date = new Date()
): RadarWebhookPayload {
  return {
    text: buildRadarAlertText(row, market, facts),
    symbol: row.symbol,
    bias: row.bias,
    score: row.score,
    price: row.price,
    at: at.toISOString(),
    url: `/radar?symbol=${row.symbol}`,
    ...(facts.length > 0
      ? {
          catalyst: true as const,
          facts: facts.map((fact) => ({
            externalId: fact.externalId,
            type: fact.type,
            source: fact.source,
            title: fact.title,
            url: fact.sourceUrl,
          })),
        }
      : {}),
  };
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
  market: RadarMarketContext,
  options: {
    /** `radar_bias_log.id` theo symbol — gắn vào alert để đo outcome sau 1h/4h/24h. */
    biasLogIds?: Map<string, number>;
    /** RADAR-TG P3: `fast` chỉ gửi tier URGENT (xem alertDeliveryPolicy). */
    lane?: CohortMode;
  } = {}
): Promise<number> {
  if (process.env.NODE_ENV === "test" || process.env.RADAR_DEMO === "1") return 0;
  await readRadarRuntimeConfig();
  const runtime = peekRadarRuntimeConfig();
  const url = runtime.alertWebhookUrl;
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  // DB > env: danh sách kênh/topic/minScore nằm trong snapshot runtime.
  const staticTargets = runtime.telegramTargets;
  // RADAR-TG P4: chat/group tự đăng ký qua /start cũng là kênh đích. Lỗi DB
  // chỉ bỏ subscriber lượt này, alert tĩnh vẫn chạy.
  let subscribers: RadarSubscriber[] = [];
  if (botToken) {
    try {
      subscribers = await readActiveRadarSubscribers();
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Không đọc được radar_subscribers:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  const targets = buildRadarTelegramTargets(staticTargets, subscribers);
  const canTelegram = Boolean(botToken) && targets.length > 0;
  const baseUrl = radarPublicBaseUrl();
  if (!url && !canTelegram) return 0;

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
  );
  if (candidates.length === 0) return 0;

  // RADAR-TG P2: dựng delivery rồi GHI OUTBOX trước khi gửi. Lỗi kênh tạm thời
  // để lại dòng PENDING cho job drain retry thay vì mất alert.
  const queuedAt = new Date();
  const deliveries: RadarOutboxDelivery[] = [];
  const queuedKeys = new Set<string>();

  for (const candidate of candidates) {
    const { row, facts, key } = candidate;
    const forCandidate: RadarOutboxDelivery[] = [];
    const tier = classifyAlertTier(row);
    const biasLogId = options.biasLogIds?.get(row.symbol) ?? null;
    // RADAR-TG P3: tier quyết định kênh + nhịp (URGENT vào fast lane,
    // ACTIONABLE/WATCH chỉ cohort đầy đủ).
    const policy = alertDeliveryPolicy(tier, options.lane ?? "full");

    // Kênh cũ: webhook generic, payload giữ nguyên shape.
    if (url && policy.webhook) {
      forCandidate.push({
        alertKey: key,
        channel: "webhook",
        targetKey: "webhook",
        tier,
        biasLogId,
        payload: buildRadarWebhookPayload(row, market, facts, queuedAt) as unknown as Record<
          string,
          unknown
        >,
      });
    }

    // Telegram native: fan-out tới từng chat/topic đã cấu hình. Mỗi target có
    // thể siết ngưỡng score riêng (kênh công khai chặt hơn DM admin).
    if (canTelegram && policy.telegram) {
      const eligible = selectRadarTelegramTargets(targets, row.score);
      if (eligible.length > 0) {
        const html = buildRadarAlertHtml(row, market, facts, { baseUrl, now: queuedAt });
        const buttons = buildRadarAlertButtons(row, baseUrl);
        for (const target of eligible) {
          forCandidate.push({
            alertKey: key,
            channel: "telegram",
            targetKey: `telegram:${target.chatId}:${target.threadId ?? ""}`,
            tier,
            biasLogId,
            payload: {
              html,
              buttons,
              chatId: target.chatId,
              ...(target.threadId ? { threadId: target.threadId } : {}),
            },
          });
        }
      }
    }

    if (forCandidate.length === 0) continue;
    deliveries.push(...forCandidate);
    queuedKeys.add(key);
  }

  if (deliveries.length === 0) return 0;

  try {
    const inserted = await enqueueRadarOutbox(deliveries, queuedAt.getTime());
    if (inserted === 0) return 0;
  } catch (error) {
    console.warn(
      "[RADAR-ALERT] Không ghi được outbox:",
      error instanceof Error ? error.message : String(error)
    );
    return 0;
  }

  // Dedupe chỉ ghi sau khi outbox đã có dòng: lượt cohort sau không tạo trùng,
  // còn retry thì do outbox tự lo.
  for (const candidate of candidates) {
    if (!queuedKeys.has(candidate.key)) continue;
    kept.push({
      key: candidate.key,
      at: queuedAt.toISOString(),
      symbol: candidate.row.symbol,
      ...(candidate.facts.length > 0 ? { externalId: candidate.facts[0].externalId } : {}),
    });
  }
  try {
    await writeSent(kept.slice(-MAX_SENT));
  } catch (error) {
    console.warn(
      "[RADAR-ALERT] Không lưu được sent:",
      error instanceof Error ? error.message : String(error)
    );
  }

  // Drain ngay trong lượt cohort để alert thường vẫn đi tức thì; lỗi tạm thời
  // để lại PENDING cho job `radar_alert_outbox` (1 phút/lần) retry.
  const drained = await drainRadarAlertOutbox().catch((error) => {
    console.warn(
      "[RADAR-ALERT] Drain outbox lỗi:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  });
  return drained?.sent ?? 0;
}

function pct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

/** Tiêu đề ngắn theo loại sự kiện cụm. */
export function clusterEventTitle(event: ClusterEvent): string {
  if (event.type === "new") return "Cụm mới";
  if (event.type === "leader-change") return "Leader đổi";
  if (event.type === "strengthening") return "Cụm mạnh lên";
  return "Cụm yếu đi";
}

/** Text thuần — giữ đúng nội dung webhook cũ khi chuyển sang outbox. */
export function buildClusterAlertText(
  event: ClusterEvent,
  market: RadarMarketContext
): string {
  return [
    `[Radar] ${clusterEventTitle(event)}: ${event.label} (${event.side})`,
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
}

/** Deep link tới đúng cụm trên Radar. */
export function buildClusterAlertButtons(
  event: ClusterEvent,
  baseUrl: string | null = radarPublicBaseUrl()
): TelegramInlineButton[] {
  if (!baseUrl) return [];
  return [
    {
      text: "Mở cụm Radar",
      url: `${baseUrl}/radar?side=${encodeURIComponent(event.side)}&cluster=${encodeURIComponent(event.clusterId)}`,
    },
  ];
}

/** Tin Telegram HTML cho sự kiện cụm — cùng style với alert row. */
export function buildClusterAlertHtml(
  event: ClusterEvent,
  market: RadarMarketContext,
  options: { baseUrl?: string | null; now?: Date } = {}
): string {
  const esc = escapeTelegramHtml;
  const lines: string[] = [
    `🛰️ <b>RADAR CLUSTER</b> · ${esc(clusterEventTitle(event))}`,
    `<b>${esc(event.label)}</b> · ${event.size} coin · ${event.direction === "up" ? "cụm tăng" : "cụm giảm"}`,
    `TB 24h <b>${pct(event.avgChangePct)}</b> · side ${esc(event.side)}`,
    event.type === "leader-change"
      ? `Leader: $${esc(event.leader ?? "—")} · trước $${esc(event.previousLeader ?? "—")}`
      : `Leader: $${esc(event.leader ?? "—")}`,
  ];

  if (event.type === "strengthening" || event.type === "weakening") {
    const delta = Math.abs(event.deltaPct ?? 0).toFixed(2);
    lines.push(
      `Sức mạnh ${event.deltaPct !== undefined && event.deltaPct > 0 ? "tăng" : "giảm"} ${delta} điểm % so với lần trước`
    );
  }
  if (event.members.length > 0) {
    const shown = event.members.slice(0, 10).join(", ");
    const more = event.members.length > 10 ? ` +${event.members.length - 10}` : "";
    lines.push(`Members: ${esc(`${shown}${more}`)}`);
  }
  lines.push(
    `Regime: ${esc(market.regime)} · BTC ${market.btcChangePct !== null ? pct(market.btcChangePct) : "—"}`,
    "",
    `Cập nhật ${ictClock(options.now ?? new Date())} ICT · không phải khuyến nghị đầu tư.`
  );
  return lines.join("\n");
}

/** Payload webhook cũ — giữ nguyên shape để tích hợp hiện có không bị phá. */
export interface RadarClusterWebhookPayload {
  text: string;
  clusterId: string;
  clusterLabel: string;
  event: string;
  side: string;
  at: string;
  url: string;
}

export function buildClusterWebhookPayload(
  event: ClusterEvent,
  market: RadarMarketContext,
  at: Date = new Date()
): RadarClusterWebhookPayload {
  return {
    text: buildClusterAlertText(event, market),
    clusterId: event.clusterId,
    clusterLabel: event.label,
    event: event.type,
    side: event.side,
    at: at.toISOString(),
    url: `/radar?side=${event.side}&cluster=${encodeURIComponent(event.clusterId)}`,
  };
}

/**
 * Dựng delivery outbox cho alert cụm: webhook (payload cũ) + Telegram (HTML +
 * deep link) cho các target đang cấu hình. Hàm thuần để test enqueue.
 */
export function buildClusterDeliveries(params: {
  events: ClusterEvent[];
  market: RadarMarketContext;
  day: string;
  webhook: boolean;
  targets: RadarTelegramTarget[];
  baseUrl: string | null;
  at?: Date;
}): RadarOutboxDelivery[] {
  const at = params.at ?? new Date();
  const deliveries: RadarOutboxDelivery[] = [];

  for (const event of params.events) {
    const alertKey = clusterAlertKey(event, params.day);
    if (params.webhook) {
      deliveries.push({
        alertKey,
        channel: "webhook",
        targetKey: "webhook",
        tier: null,
        biasLogId: null,
        payload: buildClusterWebhookPayload(event, params.market, at) as unknown as Record<
          string,
          unknown
        >,
      });
    }
    if (params.targets.length > 0) {
      const html = buildClusterAlertHtml(event, params.market, {
        baseUrl: params.baseUrl,
        now: at,
      });
      const buttons = buildClusterAlertButtons(event, params.baseUrl);
      for (const target of params.targets) {
        deliveries.push({
          alertKey,
          channel: "telegram",
          targetKey: `telegram:${target.chatId}:${target.threadId ?? ""}`,
          tier: null,
          biasLogId: null,
          payload: {
            html,
            buttons,
            chatId: target.chatId,
            ...(target.threadId ? { threadId: target.threadId } : {}),
          },
        });
      }
    }
  }

  return deliveries;
}

/** I/O của `dispatchClusterAlerts` — inject để test không cần DB/outbox thật. */
export interface ClusterAlertDeps {
  readSent: (key?: string) => Promise<SentAlert[]>;
  writeSent: (sent: SentAlert[], key?: string) => Promise<void>;
  enqueue: typeof enqueueRadarOutbox;
  drain: typeof drainRadarAlertOutbox;
}

/**
 * Gửi cảnh báo cấp cụm: cụm mới, leader đổi, mạnh/yếu đi.
 *
 * Cùng đường với alert row: ghi outbox TRƯỚC khi gửi, dedupe ghi sau khi
 * enqueue thành công, retry/backoff do outbox lo. Gồm webhook (payload cũ) và
 * Telegram (HTML) cho target env + subscriber; lỗi tạm thời để lại PENDING.
 */
export async function dispatchClusterAlerts(
  events: ClusterEvent[],
  market: RadarMarketContext,
  deps: Partial<ClusterAlertDeps> = {}
): Promise<number> {
  if (process.env.NODE_ENV === "test" || process.env.RADAR_DEMO === "1") return 0;
  if (events.length === 0) return 0;

  const io: ClusterAlertDeps = {
    readSent,
    writeSent,
    enqueue: enqueueRadarOutbox,
    drain: drainRadarAlertOutbox,
    ...deps,
  };

  // Cluster có thể chạy trước lần đọc config nào trong request → tự await để
  // lấy kênh/minScore mới nhất từ DB thay vì env cũ trong cache.
  await readRadarRuntimeConfig();
  const runtime = peekRadarRuntimeConfig();
  const url = runtime.alertWebhookUrl;
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  let subscribers: RadarSubscriber[] = [];
  if (botToken) {
    try {
      subscribers = await readActiveRadarSubscribers();
    } catch (error) {
      console.warn(
        "[RADAR-ALERT] Không đọc được radar_subscribers cho cluster:",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
  const targets = botToken ? buildRadarTelegramTargets(runtime.telegramTargets, subscribers) : [];
  const canTelegram = Boolean(botToken) && targets.length > 0;
  if (!url && !canTelegram) return 0;

  const baseUrl = radarPublicBaseUrl();
  const day = new Date().toISOString().slice(0, 10);
  const sent = await io.readSent(CLUSTER_KEY);
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const kept = sent.filter((item) => {
    const at = new Date(item.at).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
  const keys = new Set(kept.map((item) => item.key));
  const candidates = selectClusterAlertEvents(events, keys, day);
  if (candidates.length === 0) return 0;

  const queuedAt = new Date();
  const deliveries = buildClusterDeliveries({
    events: candidates,
    market,
    day,
    webhook: Boolean(url),
    targets: canTelegram ? targets : [],
    baseUrl,
    at: queuedAt,
  });
  if (deliveries.length === 0) return 0;

  try {
    const inserted = await io.enqueue(deliveries, queuedAt.getTime());
    if (inserted === 0) return 0;
  } catch (error) {
    console.warn(
      "[RADAR-ALERT] Không ghi được outbox cluster:",
      error instanceof Error ? error.message : String(error)
    );
    return 0;
  }

  const queuedKeys = new Set(deliveries.map((delivery) => delivery.alertKey));
  for (const event of candidates) {
    const key = clusterAlertKey(event, day);
    if (!queuedKeys.has(key)) continue;
    kept.push({ key, at: queuedAt.toISOString(), symbol: event.clusterId });
  }
  try {
    await io.writeSent(kept.slice(-MAX_SENT), CLUSTER_KEY);
  } catch (error) {
    console.warn(
      "[RADAR-ALERT] Không lưu được cluster sent:",
      error instanceof Error ? error.message : String(error)
    );
  }

  const drained = await io.drain().catch((error) => {
    console.warn(
      "[RADAR-ALERT] Drain outbox cluster lỗi:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  });
  return drained?.sent ?? 0;
}
