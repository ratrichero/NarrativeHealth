// RADAR-ALERTS: gửi webhook khi có tín hiệu đủ mạnh, dedupe theo ngày.
// Webhook generic (Slack/Discord/Telegram bridge đều nhận JSON có `text`).
// Không cấu hình URL = no-op; không chặn luồng radar.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { RadarRow, RadarMarketContext } from "@/lib/market/radar";
import { isBearishBias, isBullishBias } from "@/lib/market/ledger";
import type { ClusterEvent } from "@/lib/market/cluster-history";

const KEY = "radar.alerts.sent";
const CLUSTER_KEY = "radar.alerts.clusters.sent";
const MAX_SENT = 200;
const KEEP_DAYS = 7;

export interface SentAlert {
  key: string;
  at: string;
  symbol: string;
}

export interface AlertOptions {
  minScore: number;
  minEntryQuality: number;
  maxImpulseAgeHours: number;
  cooldownHours: number;
}

export function alertOptions(): AlertOptions {
  const num = (name: string, fallback: number) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return {
    minScore: num("RADAR_ALERT_MIN_SCORE", 75),
    minEntryQuality: num("RADAR_ALERT_MIN_ENTRY", 50),
    maxImpulseAgeHours: num("RADAR_ALERT_MAX_IMPULSE_HOURS", 12),
    cooldownHours: num("RADAR_ALERT_COOLDOWN_HOURS", 6),
  };
}

export function alertKey(row: RadarRow, day: string): string {
  return `${row.symbol}|${row.bias}|${day}`;
}

export function selectAlertRows(
  rows: RadarRow[],
  sentKeys: Set<string>,
  day: string,
  opts: AlertOptions = alertOptions()
): RadarRow[] {
  return rows.filter((row) => {
    if (row.bias === "neutral") return false;
    if (!isBullishBias(row.bias) && !isBearishBias(row.bias)) return false;
    if (row.score < opts.minScore || row.entryQuality < opts.minEntryQuality) return false;
    if (row.impulseAgeHours !== null && row.impulseAgeHours !== undefined && row.impulseAgeHours > opts.maxImpulseAgeHours) {
      return false;
    }
    return !sentKeys.has(alertKey(row, day));
  });
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
  const url = process.env.RADAR_ALERT_WEBHOOK_URL?.trim();
  if (!url) return 0;

  const day = new Date().toISOString().slice(0, 10);
  const sent = await readSent();
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const kept = sent.filter((s) => {
    const at = new Date(s.at).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
  const opts = alertOptions();
  const candidates = selectCooldownRows(rows, kept, day, opts);
  if (candidates.length === 0) return 0;

  let delivered = 0;
  for (const row of candidates) {
    const direction = isBullishBias(row.bias) ? "LONG watch" : "SHORT watch";
    const text = [
      `[Radar] ${direction} $${row.symbol}`,
      `${row.label} · score ${row.score}/100 · freshness ${row.entryQuality}/100`,
      `Giá ${row.price} · 24h ${row.changePct > 0 ? "+" : ""}${row.changePct.toFixed(2)}%`,
      row.impulseAgeHours !== null && row.impulseAgeHours !== undefined
        ? `Impulse ${row.impulseAgeHours.toFixed(1)}h · extension ${row.impulseExtensionAtr ?? "—"} ATR`
        : null,
      row.clusterLabel ? `Cluster: ${row.clusterLabel} (${row.clusterSize} coin)` : null,
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
          text,
          symbol: row.symbol,
          bias: row.bias,
          score: row.score,
          price: row.price,
          at: new Date().toISOString(),
          url: `/radar?symbol=${row.symbol}`,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      kept.push({ key: alertKey(row, day), at: new Date().toISOString(), symbol: row.symbol });
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
  const url = process.env.RADAR_ALERT_WEBHOOK_URL?.trim();
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
