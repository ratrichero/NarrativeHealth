// RADAR-TG P2: outbox alert radar — retry có backoff/429 và cap ngày/kênh.
// Không cần DB/network: drain nhận deps inject.

import { describe, expect, it, jest } from "@jest/globals";
import { db } from "@/db";
import {
  DEFAULT_RADAR_ALERT_DAILY_CAP,
  RADAR_ALERT_OUTBOX_BACKOFF_SECONDS,
  RADAR_ALERT_OUTBOX_BATCH,
  RADAR_ALERT_OUTBOX_MAX_ATTEMPTS,
  RADAR_OUTBOX_LEASE_MIN_MS,
  RADAR_OUTBOX_SEND_TIMEOUT_MS,
  drainRadarAlertOutbox,
  enqueueRadarOutbox,
  isOverDailyCap,
  nextRadarOutboxAttempt,
  radarAlertDailyCap,
  radarOutboxLeaseMs,
  type RadarOutboxDeps,
  type RadarOutboxRow,
  type RadarOutboxSendResult,
} from "@/lib/market/alert-outbox";

jest.mock("@/db", () => {
  const returning = jest.fn(async () => [{ id: 1 }]);
  const onConflictDoUpdate = jest.fn(() => ({ returning }));
  const values = jest.fn(() => ({ onConflictDoUpdate }));
  const insert = jest.fn(() => ({ values }));
  return {
    db: {
      insert,
      execute: jest.fn(),
      update: jest.fn(),
      // Chỉ để test soi cấu hình upsert của enqueue.
      values,
      onConflictDoUpdate,
      returning,
    },
  };
});

const NOW = Date.parse("2026-11-23T08:00:00.000Z");

function row(overrides: Partial<RadarOutboxRow> = {}): RadarOutboxRow {
  return {
    id: 1,
    alertKey: "WIF|continuation|2026-11-23",
    channel: "telegram",
    targetKey: "telegram:-100:42",
    payload: { html: "<b>x</b>" },
    attempts: 0,
    ...overrides,
  };
}

interface Event {
  type: "sent" | "retry" | "failed" | "suppressed" | "dedupe";
  id: number;
  attempts?: number;
  nextAt?: number;
  error?: string;
  alertKey?: string;
}

function harness(
  options: {
    rows?: RadarOutboxRow[];
    sentToday?: number;
    send?: RadarOutboxSendResult;
    activeDeliveries?: boolean;
    activeError?: boolean;
  } = {}
): { deps: RadarOutboxDeps; events: Event[] } {
  const events: Event[] = [];
  const deps: RadarOutboxDeps = {
    claimDue: jest.fn(async () => options.rows ?? [row()]),
    countSentToday: jest.fn(async () => options.sentToday ?? 0),
    send: jest.fn(async () => options.send ?? { ok: true }),
    markSent: jest.fn(async (id: number, attempts: number) => {
      events.push({ type: "sent", id, attempts });
    }),
    markRetry: jest.fn(async (id: number, attempts: number, nextAt: number, error: string) => {
      events.push({ type: "retry", id, attempts, nextAt, error });
    }),
    markFailed: jest.fn(async (id: number, attempts: number, error: string) => {
      events.push({ type: "failed", id, attempts, error });
    }),
    markSuppressed: jest.fn(async (id: number, error: string) => {
      events.push({ type: "suppressed", id, error });
    }),
    hasActiveDeliveries: jest.fn(async (_alertKey: string) => {
      if (options.activeError) throw new Error("db down");
      return options.activeDeliveries ?? false;
    }),
    releaseDedupe: jest.fn(async (alertKey: string) => {
      events.push({ type: "dedupe", id: 0, alertKey });
    }),
  };
  return { deps, events };
}

describe("cap tin/ngày/kênh", () => {
  it("mặc định 12, 0 = không giới hạn, giá trị hỏng dùng mặc định", () => {
    expect(radarAlertDailyCap("")).toBe(DEFAULT_RADAR_ALERT_DAILY_CAP);
    expect(radarAlertDailyCap("0")).toBe(0);
    expect(radarAlertDailyCap("8")).toBe(8);
    expect(radarAlertDailyCap("abc")).toBe(DEFAULT_RADAR_ALERT_DAILY_CAP);
    expect(radarAlertDailyCap("-3")).toBe(DEFAULT_RADAR_ALERT_DAILY_CAP);
  });

  it("chỉ chặn khi cap > 0 và kênh đã đủ", () => {
    expect(isOverDailyCap(11, 12)).toBe(false);
    expect(isOverDailyCap(12, 12)).toBe(true);
    expect(isOverDailyCap(999, 0)).toBe(false);
  });
});

describe("retry backoff + tôn trọng retry_after", () => {
  it("429 dùng retry_after (kẹp 1 giờ), kể cả khi backoff thường ngắn hơn", () => {
    expect(nextRadarOutboxAttempt(1, NOW, 45)).toBe(NOW + 45_000);
    expect(nextRadarOutboxAttempt(1, NOW, 9_999)).toBe(NOW + 3_600_000);
  });

  it("không có retry_after: 30s → 2m → 10m; tối đa 4 lần", () => {
    expect(nextRadarOutboxAttempt(1, NOW)).toBe(NOW + RADAR_ALERT_OUTBOX_BACKOFF_SECONDS[0] * 1_000);
    expect(nextRadarOutboxAttempt(2, NOW)).toBe(NOW + RADAR_ALERT_OUTBOX_BACKOFF_SECONDS[1] * 1_000);
    expect(nextRadarOutboxAttempt(3, NOW)).toBe(NOW + RADAR_ALERT_OUTBOX_BACKOFF_SECONDS[2] * 1_000);
    expect(RADAR_ALERT_OUTBOX_MAX_ATTEMPTS).toBe(4);
  });

  it("Telegram 429: dòng quay lại PENDING với next_attempt = now + retry_after", async () => {
    const { deps, events } = harness({
      send: { ok: false, retryAfterSeconds: 45, error: "Telegram 429: Too Many Requests" },
    });

    const result = await drainRadarAlertOutbox({ now: NOW, deps });

    expect(result).toEqual({ due: 1, sent: 0, retried: 1, failed: 0, suppressed: 0 });
    expect(events).toEqual([
      { type: "retry", id: 1, attempts: 1, nextAt: NOW + 45_000, error: "Telegram 429: Too Many Requests" },
    ]);
  });

  it("lỗi thường: retry sau 30s; lần thử thứ 4 chuyển FAILED", async () => {
    const first = harness({ send: { ok: false, error: "webhook 502" } });
    await drainRadarAlertOutbox({ now: NOW, deps: first.deps });
    expect(first.events).toEqual([
      { type: "retry", id: 1, attempts: 1, nextAt: NOW + 30_000, error: "webhook 502" },
    ]);

    const fourth = harness({ rows: [row({ attempts: 3 })], send: { ok: false, error: "vẫn lỗi" } });
    const result = await drainRadarAlertOutbox({ now: NOW, deps: fourth.deps });
    expect(result).toEqual({ due: 1, sent: 0, retried: 0, failed: 1, suppressed: 0 });
    expect(fourth.events[0]).toMatchObject({ type: "failed", attempts: 4 });
  });

  it("gửi thành công: SENT và đếm vào cap của kênh", async () => {
    const { deps, events } = harness({ sentToday: 3 });
    const result = await drainRadarAlertOutbox({ now: NOW, deps, cap: 12 });

    expect(result).toEqual({ due: 1, sent: 1, retried: 0, failed: 0, suppressed: 0 });
    expect(events).toEqual([{ type: "sent", id: 1, attempts: 1 }]);
  });

  it("send throw: coi như lỗi tạm thời, không làm hỏng lượt drain", async () => {
    const { deps, events } = harness();
    (deps.send as unknown as jest.Mock).mockImplementationOnce(async () => {
      throw new Error("fetch failed");
    });

    const result = await drainRadarAlertOutbox({ now: NOW, deps });

    expect(result.retried).toBe(1);
    expect(events[0]).toMatchObject({ type: "retry", error: "fetch failed" });
  });
});

describe("lease claim phủ hết batch", () => {
  it("batch 20 × timeout 8s phải nằm trong lease, không phải 60s cố định", () => {
    const lease = radarOutboxLeaseMs(RADAR_ALERT_OUTBOX_BATCH);
    expect(lease).toBeGreaterThanOrEqual(RADAR_ALERT_OUTBOX_BATCH * RADAR_OUTBOX_SEND_TIMEOUT_MS);
    expect(lease).toBe(200_000);
  });

  it("batch nhỏ/hỏng vẫn có sàn 60s", () => {
    expect(radarOutboxLeaseMs(1)).toBe(RADAR_OUTBOX_LEASE_MIN_MS);
    expect(radarOutboxLeaseMs(0)).toBe(RADAR_OUTBOX_LEASE_MIN_MS);
    expect(radarOutboxLeaseMs(Number.NaN)).toBe(RADAR_OUTBOX_LEASE_MIN_MS);
    expect(radarOutboxLeaseMs(10)).toBe(100_000);
  });

  it("drain truyền đúng lease tính từ limit cho claim", async () => {
    const claimDue = jest.fn(async (_now: number, _limit: number, _leaseMs: number) => []);
    const { deps } = harness();

    await drainRadarAlertOutbox({ now: NOW, deps: { ...deps, claimDue } });

    expect(claimDue).toHaveBeenCalledWith(
      NOW,
      RADAR_ALERT_OUTBOX_BATCH,
      radarOutboxLeaseMs(RADAR_ALERT_OUTBOX_BATCH)
    );
  });

  it("hai worker chồng nhau: worker B không nhặt lại dòng đang trong lease của A", async () => {
    let leasedUntil = 0;
    const claimDue = jest.fn(async (now: number, _limit: number, leaseMs: number) => {
      if (now < leasedUntil) return [];
      leasedUntil = now + leaseMs;
      return [row({ id: 1 })];
    });
    let sends = 0;
    const { deps } = harness();
    const overlapping: RadarOutboxDeps = {
      ...deps,
      claimDue,
      send: jest.fn(async () => {
        sends += 1;
        return { ok: true } as RadarOutboxSendResult;
      }),
    };

    await drainRadarAlertOutbox({ now: NOW, deps: overlapping });
    // Worker B chạy 30s sau, lease 200s vẫn còn hạn → không claim, không gửi.
    const second = await drainRadarAlertOutbox({ now: NOW + 30_000, deps: overlapping });
    expect(second.due).toBe(0);
    expect(sends).toBe(1);

    // Hết lease mới được nhặt lại (ví dụ process A chết giữa chừng).
    await drainRadarAlertOutbox({
      now: NOW + radarOutboxLeaseMs(RADAR_ALERT_OUTBOX_BATCH),
      deps: overlapping,
    });
    expect(sends).toBe(2);
  });
});

describe("FAILED → gỡ dedupe để cohort sau báo lại", () => {
  it("lần thứ 4 thất bại và không còn kênh active → gỡ dedupe đúng alertKey", async () => {
    const { deps, events } = harness({
      rows: [row({ attempts: 3 })],
      send: { ok: false, error: "webhook 502" },
      activeDeliveries: false,
    });

    const result = await drainRadarAlertOutbox({ now: NOW, deps });

    expect(result).toEqual({ due: 1, sent: 0, retried: 0, failed: 1, suppressed: 0 });
    expect(deps.hasActiveDeliveries).toHaveBeenCalledWith("WIF|continuation|2026-11-23");
    expect(events).toContainEqual({
      type: "dedupe",
      id: 0,
      alertKey: "WIF|continuation|2026-11-23",
    });
  });

  it("còn kênh PENDING/SENT khác → giữ dedupe, không gửi lặp kênh đã thành công", async () => {
    const { deps, events } = harness({
      rows: [row({ attempts: 3 })],
      send: { ok: false, error: "telegram 403" },
      activeDeliveries: true,
    });

    const result = await drainRadarAlertOutbox({ now: NOW, deps });

    expect(result.failed).toBe(1);
    expect(deps.releaseDedupe).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "dedupe")).toBe(false);
  });

  it("lỗi khi kiểm tra delivery active → vẫn FAILED nhưng không gỡ dedupe", async () => {
    const { deps, events } = harness({
      rows: [row({ attempts: 3 })],
      send: { ok: false, error: "webhook 502" },
      activeError: true,
    });

    const result = await drainRadarAlertOutbox({ now: NOW, deps });

    expect(result.failed).toBe(1);
    expect(deps.releaseDedupe).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "dedupe")).toBe(false);
  });

  it("retry hoặc SENT không đụng dedupe", async () => {
    const retried = harness({ send: { ok: false, error: "webhook 502" } });
    await drainRadarAlertOutbox({ now: NOW, deps: retried.deps });
    expect(retried.deps.releaseDedupe).not.toHaveBeenCalled();

    const sent = harness();
    await drainRadarAlertOutbox({ now: NOW, deps: sent.deps });
    expect(sent.deps.releaseDedupe).not.toHaveBeenCalled();
  });
});

describe("cluster alert đi qua outbox", () => {
  const clusterKey = "gainer|ai-abc123|new|2026-11-23";
  const clusterRow = () =>
    row({
      alertKey: clusterKey,
      channel: "webhook",
      targetKey: "webhook",
      payload: {
        text: "[Radar] Cụm mới: AI (gainer)",
        clusterId: "ai-abc123",
        event: "new",
        side: "gainer",
      },
    });

  it("lỗi tạm thời: giữ nguyên payload và retry theo backoff, dedupe chưa bị gỡ", async () => {
    const { deps, events } = harness({
      rows: [clusterRow()],
      send: { ok: false, error: "webhook 502" },
    });

    const result = await drainRadarAlertOutbox({ now: NOW, deps });

    expect(result).toEqual({ due: 1, sent: 0, retried: 1, failed: 0, suppressed: 0 });
    expect(deps.send).toHaveBeenCalledWith(
      expect.objectContaining({ alertKey: clusterKey, payload: clusterRow().payload })
    );
    expect(events[0]).toMatchObject({
      type: "retry",
      attempts: 1,
      nextAt: NOW + 30_000,
    });
    expect(deps.releaseDedupe).not.toHaveBeenCalled();
  });

  it("hết 4 lần thử: FAILED rồi gỡ dedupe cụm để cohort sau enqueue lại", async () => {
    const { deps, events } = harness({
      rows: [row({ ...clusterRow(), attempts: 3 })],
      send: { ok: false, error: "vẫn 502" },
      activeDeliveries: false,
    });

    const result = await drainRadarAlertOutbox({ now: NOW, deps });

    expect(result.failed).toBe(1);
    expect(events).toContainEqual({ type: "failed", id: 1, attempts: 4, error: "vẫn 502" });
    expect(events).toContainEqual({ type: "dedupe", id: 0, alertKey: clusterKey });
  });
});

describe("enqueue hồi sinh dòng FAILED", () => {
  it("upsert chỉ đổi FAILED thành PENDING với payload mới, không đụng dòng còn sống", async () => {
    const mocked = db as unknown as {
      values: jest.Mock;
      onConflictDoUpdate: jest.Mock;
    };
    mocked.values.mockClear();
    mocked.onConflictDoUpdate.mockClear();

    const inserted = await enqueueRadarOutbox(
      [
        {
          alertKey: "WIF|continuation|2026-11-23",
          channel: "telegram",
          targetKey: "telegram:-100:42",
          payload: { html: "<b>mới</b>" },
        },
      ],
      NOW
    );

    expect(inserted).toBe(1);
    const conflict = mocked.onConflictDoUpdate.mock.calls[0][0] as {
      target: unknown[];
      set: Record<string, unknown>;
      setWhere?: unknown;
    };
    expect(conflict.target).toHaveLength(3);
    expect(conflict.set).toMatchObject({
      status: "PENDING",
      attempts: 0,
      lastError: null,
      sentAt: null,
    });
    expect(conflict.setWhere).toBeDefined();
  });
});

describe("cap áp khi drain", () => {
  it("kênh đã đủ cap/ngày → SUPPRESSED, không gọi kênh gửi", async () => {
    const { deps, events } = harness({ sentToday: 12 });

    const result = await drainRadarAlertOutbox({ now: NOW, deps, cap: 12 });

    expect(result).toEqual({ due: 1, sent: 0, retried: 0, failed: 0, suppressed: 1 });
    expect(deps.send as unknown as jest.Mock).not.toHaveBeenCalled();
    expect(events[0]).toMatchObject({ type: "suppressed" });
  });

  it("cap 0 = không giới hạn: vẫn gửi dù đã gửi nhiều", async () => {
    const { deps } = harness({ sentToday: 500 });

    const result = await drainRadarAlertOutbox({ now: NOW, deps, cap: 0 });

    expect(result.sent).toBe(1);
  });

  it("không có dòng tới hạn → không làm gì", async () => {
    const { deps, events } = harness({ rows: [] });

    const result = await drainRadarAlertOutbox({ now: NOW, deps });

    expect(result).toEqual({ due: 0, sent: 0, retried: 0, failed: 0, suppressed: 0 });
    expect(events).toEqual([]);
  });
});
