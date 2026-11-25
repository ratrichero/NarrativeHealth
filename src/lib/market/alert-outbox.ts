// RADAR-TG P2 — outbox cho alert Radar.
//
// P1 gửi thẳng trong `dispatchRadarAlerts`: Telegram 429/5xx hay webhook sập
// một lần là alert mất, và dedupe chỉ ghi khi gửi thành công nên lượt cohort
// sau chỉ cứu được nếu bias còn "fresh". Outbox đảo thứ tự:
//
//   enqueue (ghi PENDING) → gửi → SENT | retry có backoff | FAILED | SUPPRESSED
//
// Dòng PENDING còn lại sau khi process chết vẫn được job `radar_alert_outbox`
// (FastAPI, 1 phút/lần) nhặt lại, nên lỗi tạm thời không làm mất alert. Cap
// ngày/kênh chặn dội tin; dedupe `symbol|bias|ngày` cũ vẫn là lớp chống trùng
// thứ nhất nên mỗi alert chỉ vào outbox một lần.

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { radarAlertOutbox } from "@/db/schema";
import { peekRadarRuntimeConfig } from "@/lib/settings/radar-config";
import {
  deliverTelegramMessage,
  type TelegramInlineButton,
} from "@/lib/services/alert-delivery.service";

export const RADAR_ALERT_DAILY_CAP_ENV = "RADAR_ALERT_DAILY_CAP";
/** Key app_settings chứa dedupe alert row (mảng SentAlert). */
export const RADAR_ALERTS_SENT_KEY = "radar.alerts.sent";
/** Key app_settings chứa dedupe alert cấp cụm. */
export const RADAR_CLUSTER_ALERTS_SENT_KEY = "radar.alerts.clusters.sent";
/** Số tin tối đa/kênh/ngày; 0 = không giới hạn. */
export const DEFAULT_RADAR_ALERT_DAILY_CAP = 12;
/** Số lần thử tối đa trước khi chuyển FAILED (lần đầu + 3 lần retry). */
export const RADAR_ALERT_OUTBOX_MAX_ATTEMPTS = 4;
/** Chờ sau lần lỗi thứ 1, 2, 3 (giây). Lần 4 → FAILED. */
export const RADAR_ALERT_OUTBOX_BACKOFF_SECONDS = [30, 120, 600] as const;
/** Số dòng xử lý mỗi lượt drain — giữ request scheduler ngắn. */
export const RADAR_ALERT_OUTBOX_BATCH = 20;

/** Timeout gửi mỗi dòng (khớp AbortSignal trong `productionDeps.send`). */
export const RADAR_OUTBOX_SEND_TIMEOUT_MS = 8_000;
/** Ngân sách mỗi dòng: gửi (tối đa 8s) + countSentToday + mark, dư cho mạng chậm. */
export const RADAR_OUTBOX_ROW_BUDGET_MS = 10_000;
export const RADAR_OUTBOX_LEASE_MIN_MS = 60_000;

/**
 * Lease claim phải phủ HẾT batch: 20 dòng × 8s timeout = 160s > lease 60s cũ,
 * nên worker thứ hai sẽ nhặt lại dòng cuối batch và gửi trùng. Dùng 10s/dòng
 * (200s cho batch 20) và luôn ít nhất 60s cho batch nhỏ.
 */
export function radarOutboxLeaseMs(limit: number = RADAR_ALERT_OUTBOX_BATCH): number {
  if (!Number.isFinite(limit) || limit <= 0) return RADAR_OUTBOX_LEASE_MIN_MS;
  return Math.max(RADAR_OUTBOX_LEASE_MIN_MS, Math.floor(limit) * RADAR_OUTBOX_ROW_BUDGET_MS);
}

export type RadarOutboxChannel = "telegram" | "webhook";
export type RadarOutboxRowStatus = "PENDING" | "SENT" | "FAILED" | "SUPPRESSED";

export interface RadarOutboxDelivery {
  /** Dedupe key của alert (`symbol|bias|ngày` hoặc `catalyst|symbol|externalId`). */
  alertKey: string;
  channel: RadarOutboxChannel;
  /** Kênh đích: `webhook` hoặc `telegram:<chatId>:<threadId?>`. */
  targetKey: string;
  /** Row `radar_bias_log` sinh ra alert — nguồn đo ATR/invalidation sau 1h/4h/24h. */
  biasLogId?: number | null;
  /** URGENT | ACTIONABLE | WATCH — dùng cho thống kê theo tier. */
  tier?: string | null;
  /** telegram: {html, buttons, chatId, threadId?}; webhook: payload cũ. */
  payload: Record<string, unknown>;
}

export interface RadarOutboxRow {
  id: number;
  alertKey: string;
  channel: string;
  targetKey: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface RadarOutboxSendResult {
  ok: boolean;
  retryAfterSeconds?: number;
  error?: string;
}

export interface RadarOutboxDeps {
  /** `leaseMs` phải phủ hết batch — xem `radarOutboxLeaseMs`. */
  claimDue: (now: number, limit: number, leaseMs: number) => Promise<RadarOutboxRow[]>;
  countSentToday: (targetKey: string, now: number) => Promise<number>;
  send: (row: RadarOutboxRow) => Promise<RadarOutboxSendResult>;
  markSent: (id: number, attempts: number, at: number) => Promise<void>;
  markRetry: (id: number, attempts: number, nextAt: number, error: string) => Promise<void>;
  markFailed: (id: number, attempts: number, error: string) => Promise<void>;
  markSuppressed: (id: number, error: string) => Promise<void>;
  /** Còn delivery PENDING/SENT khác cho cùng alertKey không? */
  hasActiveDeliveries?: (alertKey: string) => Promise<boolean>;
  /** Gỡ dedupe `radar.alerts.sent` để cohort sau được báo lại. */
  releaseDedupe?: (alertKey: string) => Promise<void>;
}

export interface RadarOutboxDrainResult {
  due: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
}

export interface RadarOutboxStatus {
  checked: true;
  pending: number;
  failed: number;
  sentToday: number;
  suppressedToday: number;
  oldestPendingAt: string | null;
  lastSentAt: string | null;
  lastError: string | null;
}

/** Cap tin/ngày/kênh từ env; thiếu/hỏng → mặc định 12; 0 = không giới hạn. */
export function radarAlertDailyCap(raw: string | undefined = process.env[RADAR_ALERT_DAILY_CAP_ENV]): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_RADAR_ALERT_DAILY_CAP;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_RADAR_ALERT_DAILY_CAP;
  return Math.min(100, Math.floor(value));
}

export function isOverDailyCap(sentToday: number, cap: number): boolean {
  return cap > 0 && sentToday >= cap;
}

/**
 * Thời điểm thử lại: ưu tiên `retry_after` của Telegram (429); nếu không có thì
 * backoff 30s → 2m → 10m. `failedAttempts` là số lần đã lỗi sau lần này.
 */
export function nextRadarOutboxAttempt(
  failedAttempts: number,
  now: number,
  retryAfterSeconds?: number | null
): number {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return now + Math.min(retryAfterSeconds, 3_600) * 1_000;
  }
  const index = Math.min(
    Math.max(failedAttempts, 1),
    RADAR_ALERT_OUTBOX_BACKOFF_SECONDS.length
  ) - 1;
  return now + RADAR_ALERT_OUTBOX_BACKOFF_SECONDS[index] * 1_000;
}

/**
 * Ghi alert vào outbox TRƯỚC khi gửi.
 *
 * Trùng (alert, kênh, đích) với dòng còn sống (PENDING/SENT/SUPPRESSED) bị bỏ
 * qua. Riêng dòng FAILED được hồi sinh thành PENDING với payload mới: cohort
 * sau chỉ chọn lại alert này khi dedupe đã được gỡ (xem `releaseDedupe`),
 * nhưng dòng FAILED cũ vẫn chiếm unique key nên phải reset thay vì bỏ qua.
 */
export async function enqueueRadarOutbox(
  deliveries: RadarOutboxDelivery[],
  now: number = Date.now()
): Promise<number> {
  if (deliveries.length === 0) return 0;
  const inserted = await db
    .insert(radarAlertOutbox)
    .values(
      deliveries.map((delivery) => ({
        alertKey: delivery.alertKey,
        channel: delivery.channel,
        targetKey: delivery.targetKey,
        biasLogId: delivery.biasLogId ?? null,
        tier: delivery.tier ?? null,
        payload: delivery.payload,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(now),
      }))
    )
    .onConflictDoUpdate({
      target: [
        radarAlertOutbox.alertKey,
        radarAlertOutbox.channel,
        radarAlertOutbox.targetKey,
      ],
      set: {
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: new Date(now),
        payload: sql`excluded.payload`,
        biasLogId: sql`excluded.bias_log_id`,
        tier: sql`excluded.tier`,
        lastError: null,
        sentAt: null,
      },
      // Chỉ hồi sinh dòng đã bỏ cuộc; SENT/PENDING/SUPPRESSED giữ nguyên.
      setWhere: sql`${radarAlertOutbox.status} = 'FAILED'`,
    })
    .returning({ id: radarAlertOutbox.id });
  return inserted.length;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function productionDeps(): RadarOutboxDeps {
  return {
    claimDue: async (now, limit, leaseMs) => {
      // Lease = next_attempt_at, phủ hết batch (mỗi dòng tối đa 8s timeout).
      // Cohort drain và job 1 phút có thể chạy cùng lúc — UPDATE ... SKIP
      // LOCKED bảo đảm mỗi dòng chỉ một worker gửi; lease dài hơn tổng thời
      // gian batch nên worker thứ hai không nhặt lại dòng cuối batch. Process
      // chết giữa chừng thì dòng PENDING được nhặt lại sau khi lease hết.
      const result = await db.execute(sql`
        UPDATE radar_alert_outbox AS o
        SET next_attempt_at = ${new Date(now + leaseMs)}
        WHERE o.id IN (
          SELECT id FROM radar_alert_outbox
          WHERE status = 'PENDING' AND next_attempt_at <= ${new Date(now)}
          ORDER BY next_attempt_at ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING o.id, o.alert_key, o.channel, o.target_key, o.payload, o.attempts
      `);
      return rowsOf(result).map((row) => ({
        id: Number(row.id),
        alertKey: String(row.alert_key),
        channel: String(row.channel),
        targetKey: String(row.target_key),
        payload: (row.payload ?? {}) as Record<string, unknown>,
        attempts: Number(row.attempts ?? 0),
      }));
    },

    countSentToday: async (targetKey, now) => {
      const result = await db.execute(sql`
        SELECT count(*)::int AS sent
        FROM radar_alert_outbox
        WHERE target_key = ${targetKey}
          AND status = 'SENT'
          AND sent_at >= date_trunc('day', ${new Date(now)})
      `);
      return Number(rowsOf(result)[0]?.sent ?? 0);
    },

    send: async (row) => {
      if (row.channel === "webhook") {
        const url = peekRadarRuntimeConfig().alertWebhookUrl;
        if (!url) return { ok: false, error: "alertWebhookUrl chưa cấu hình" };
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(row.payload),
            signal: AbortSignal.timeout(RADAR_OUTBOX_SEND_TIMEOUT_MS),
          });
          return response.ok
            ? { ok: true }
            : { ok: false, error: `webhook ${response.status}` };
        } catch (error) {
          return { ok: false, error: errorText(error) };
        }
      }

      const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
      if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN chưa set" };
      const payload = row.payload as {
        html?: string;
        text?: string;
        buttons?: TelegramInlineButton[];
        chatId?: string;
        threadId?: number;
      };
      const recipient = payload.chatId ?? row.targetKey.split(":")[1];
      const result = await deliverTelegramMessage({
        token,
        chatId: recipient,
        threadId: payload.threadId,
        html: payload.html,
        text: payload.text,
        buttons: payload.buttons,
      });
      return {
        ok: result.ok,
        ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}),
        ...(result.error ? { error: result.error } : {}),
      };
    },

    markSent: async (id, attempts, at) => {
      await db
        .update(radarAlertOutbox)
        .set({ status: "SENT", sentAt: new Date(at), attempts, lastError: null })
        .where(sql`${radarAlertOutbox.id} = ${id}`);
    },
    markRetry: async (id, attempts, nextAt, error) => {
      await db
        .update(radarAlertOutbox)
        .set({ status: "PENDING", attempts, nextAttemptAt: new Date(nextAt), lastError: error })
        .where(sql`${radarAlertOutbox.id} = ${id}`);
    },
    markFailed: async (id, attempts, error) => {
      await db
        .update(radarAlertOutbox)
        .set({ status: "FAILED", attempts, lastError: error })
        .where(sql`${radarAlertOutbox.id} = ${id}`);
    },
    markSuppressed: async (id, error) => {
      await db
        .update(radarAlertOutbox)
        .set({ status: "SUPPRESSED", lastError: error })
        .where(sql`${radarAlertOutbox.id} = ${id}`);
    },

    hasActiveDeliveries: async (alertKey) => {
      const result = await db.execute(sql`
        SELECT count(*)::int AS active
        FROM radar_alert_outbox
        WHERE alert_key = ${alertKey}
          AND status IN ('PENDING', 'SENT')
      `);
      return Number(rowsOf(result)[0]?.active ?? 0) > 0;
    },

    // Dedupe được ghi ngay khi enqueue, nên alert FAILED hết retry sẽ bị chặn
    // 7 ngày. Gỡ đúng entry `key = alertKey` để lượt cohort sau chọn lại; dòng
    // FAILED còn lại được enqueue hồi sinh thành PENDING.
    releaseDedupe: async (alertKey) => {
      // Áp cho cả alert row và alert cụm: key của hai loại khác format nên
      // filter theo `key` không ảnh hưởng entry của loại còn lại.
      await db.execute(sql`
        UPDATE app_settings
        SET value = COALESCE((
          SELECT jsonb_agg(entry)
          FROM jsonb_array_elements(value) AS entry
          WHERE entry->>'key' <> ${alertKey}
        ), '[]'::jsonb),
        updated_at = now()
        WHERE key IN (${RADAR_ALERTS_SENT_KEY}, ${RADAR_CLUSTER_ALERTS_SENT_KEY})
          AND jsonb_typeof(value) = 'array'
      `);
    },
  };
}

/**
 * Gửi các dòng đã tới hạn. `deps` cho phép test không cần DB/network.
 * Trả summary để endpoint/health/log đọc được.
 */
export async function drainRadarAlertOutbox(
  options: {
    now?: number;
    limit?: number;
    cap?: number;
    deps?: Partial<RadarOutboxDeps>;
  } = {}
): Promise<RadarOutboxDrainResult> {
  const now = options.now ?? Date.now();
  const deps: RadarOutboxDeps = { ...productionDeps(), ...options.deps };
  const cap = options.cap ?? radarAlertDailyCap();
  const limit = options.limit ?? RADAR_ALERT_OUTBOX_BATCH;
  const rows = await deps.claimDue(now, limit, radarOutboxLeaseMs(limit));
  const result: RadarOutboxDrainResult = {
    due: rows.length,
    sent: 0,
    retried: 0,
    failed: 0,
    suppressed: 0,
  };

  for (const row of rows) {
    // Cap theo kênh đích: kênh công khai và group trả phí có hạn mức riêng.
    if (isOverDailyCap(await deps.countSentToday(row.targetKey, now), cap)) {
      await deps.markSuppressed(row.id, `daily cap ${cap} reached for ${row.targetKey}`);
      result.suppressed += 1;
      continue;
    }

    const sent: RadarOutboxSendResult = await deps.send(row).catch((error) => ({
      ok: false,
      error: errorText(error),
    }));

    const attempts = (row.attempts ?? 0) + 1;
    if (sent.ok) {
      await deps.markSent(row.id, attempts, now);
      result.sent += 1;
      continue;
    }

    const error = sent.error ?? "delivery failed";
    if (attempts >= RADAR_ALERT_OUTBOX_MAX_ATTEMPTS) {
      await deps.markFailed(row.id, attempts, error);
      // Chỉ gỡ dedupe khi alert không còn kênh nào PENDING/SENT — nếu kênh
      // khác đã gửi được thì giữ nguyên để không gửi lặp. Lỗi khi kiểm tra/gỡ
      // thì bỏ qua (giữ dedupe an toàn hơn là gửi trùng cả kênh đã thành công).
      if (deps.hasActiveDeliveries && deps.releaseDedupe) {
        try {
          if (!(await deps.hasActiveDeliveries(row.alertKey))) {
            await deps.releaseDedupe(row.alertKey);
          }
        } catch (releaseError) {
          console.warn(
            "[RADAR-ALERT] Không gỡ được dedupe sau FAILED:",
            errorText(releaseError)
          );
        }
      }
      result.failed += 1;
      continue;
    }

    await deps.markRetry(
      row.id,
      attempts,
      nextRadarOutboxAttempt(attempts, now, sent.retryAfterSeconds),
      error
    );
    result.retried += 1;
  }

  return result;
}

/** Trạng thái outbox cho `/api/health` (không throw — bảng có thể chưa migrate). */
export async function readRadarAlertOutboxStatus(): Promise<RadarOutboxStatus> {
  const result = await db.execute(sql`
    SELECT
      count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
      count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
      count(*) FILTER (WHERE status = 'SENT' AND sent_at >= date_trunc('day', now()))::int AS sent_today,
      count(*) FILTER (WHERE status = 'SUPPRESSED' AND created_at >= date_trunc('day', now()))::int AS suppressed_today,
      min(next_attempt_at) FILTER (WHERE status = 'PENDING') AS oldest_pending,
      max(sent_at) AS last_sent,
      (SELECT last_error FROM radar_alert_outbox
        WHERE last_error IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS last_error
    FROM radar_alert_outbox
  `);
  const row = rowsOf(result)[0] ?? {};
  const iso = (value: unknown): string | null => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  };
  return {
    checked: true,
    pending: Number(row.pending ?? 0),
    failed: Number(row.failed ?? 0),
    sentToday: Number(row.sent_today ?? 0),
    suppressedToday: Number(row.suppressed_today ?? 0),
    oldestPendingAt: iso(row.oldest_pending),
    lastSentAt: iso(row.last_sent),
    lastError: typeof row.last_error === "string" ? row.last_error : null,
  };
}
