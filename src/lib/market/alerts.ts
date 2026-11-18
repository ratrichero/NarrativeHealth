// RADAR-ALERTS: gửi webhook khi có tín hiệu đủ mạnh, dedupe theo ngày.
// Webhook generic (Slack/Discord/Telegram bridge đều nhận JSON có `text`).
// Không cấu hình URL = no-op; không chặn luồng radar.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";
import type { RadarRow, RadarMarketContext } from "@/lib/market/radar";
import { isBearishBias, isBullishBias } from "@/lib/market/ledger";

const KEY = "radar.alerts.sent";
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

async function readSent(): Promise<SentAlert[]> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).limit(1);
    if (!Array.isArray(row?.value)) return [];
    return row.value.filter(
      (s): s is SentAlert =>
        Boolean(s) && typeof s === "object" && typeof (s as SentAlert).key === "string"
    );
  } catch {
    return [];
  }
}

async function writeSent(sent: SentAlert[]): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key: KEY, value: sent, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: sent, updatedAt: new Date() },
    });
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
  const keys = new Set(kept.map((s) => s.key));
  const opts = alertOptions();
  const cooldownStart = Date.now() - opts.cooldownHours * 3_600_000;
  const cooling = new Set(
    kept.filter((s) => Date.parse(s.at) >= cooldownStart).map((s) => s.symbol)
  );
  const candidates = selectAlertRows(rows, keys, day, opts).filter(
    (row) => !cooling.has(row.symbol)
  );
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
