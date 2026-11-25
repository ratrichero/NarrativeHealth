// RADAR-ALERT-METRICS: tier + ATR/invalidation + p95 detection→delivery.

import { describe, expect, it, jest } from "@jest/globals";
import { classifyAlertTier } from "@/lib/market/alerts";
import {
  alertPercentile,
  summarizeRadarAlertStats,
} from "@/lib/market/alert-stats";
import { atrMultipleFor, invalidationTouched } from "@/lib/market/bias-log";
import type { RadarRow } from "@/lib/market/radar";

jest.mock("@/db", () => ({ db: {} }));

function row(overrides: Partial<RadarRow> = {}): RadarRow {
  return {
    symbol: "WIF",
    pair: "WIFUSDT",
    price: 100,
    bias: "continuation",
    label: "Tiếp diễn tăng",
    score: 80,
    entryQuality: 70,
    impulseAgeHours: 3,
    ...overrides,
  } as unknown as RadarRow;
}

describe("classifyAlertTier", () => {
  it("URGENT khi score/entry/impulse đủ và có catalyst hoặc cụm ≥ 3 coin", () => {
    expect(classifyAlertTier(row({ score: 88, entryQuality: 76, impulseAgeHours: 1.2, catalystTriggered: true }))).toBe("URGENT");
    expect(classifyAlertTier(row({ score: 88, entryQuality: 76, impulseAgeHours: 1.2, clusterSize: 4 }))).toBe("URGENT");
  });

  it("thiếu xác nhận (không catalyst, cụm < 3) thì tụt xuống ACTIONABLE", () => {
    expect(
      classifyAlertTier(
        row({ score: 88, entryQuality: 76, impulseAgeHours: 1.2, catalystTriggered: false, clusterSize: 2 })
      )
    ).toBe("ACTIONABLE");
  });

  it("ACTIONABLE / WATCH / null theo ngưỡng", () => {
    expect(classifyAlertTier(row({ score: 78, entryQuality: 60, impulseAgeHours: 8 }))).toBe("ACTIONABLE");
    expect(classifyAlertTier(row({ score: 66, entryQuality: 40 }))).toBe("WATCH");
    expect(classifyAlertTier(row({ score: 60 }))).toBeNull();
  });

  it("impulse null (thiếu dữ liệu 1h) không bị loại oan", () => {
    expect(classifyAlertTier(row({ score: 90, entryQuality: 80, impulseAgeHours: null, catalystTriggered: true }))).toBe("URGENT");
  });
});

describe("atrMultipleFor", () => {
  it("MFE/ATR, làm tròn 2 chữ số", () => {
    expect(atrMultipleFor(5.5, 2.2)).toBe(2.5);
    expect(atrMultipleFor(1, 3)).toBe(0.33);
  });

  it("thiếu ATR hoặc ATR ≤ 0 → null, không bịa số", () => {
    expect(atrMultipleFor(5, null)).toBeNull();
    expect(atrMultipleFor(null, 2)).toBeNull();
    expect(atrMultipleFor(5, 0)).toBeNull();
    expect(atrMultipleFor(5, -1)).toBeNull();
  });
});

const candles = [
  { openTime: 0, high: 101, low: 95 },
  { openTime: 3_600_000, high: 108, low: 99 },
];

describe("invalidationTouched", () => {
  it("long: chạm khi low ≤ invalidation", () => {
    expect(invalidationTouched(candles, 0, 2 * 3_600_000, 97, "continuation")).toBe(true);
    expect(invalidationTouched(candles, 0, 2 * 3_600_000, 94, "continuation")).toBe(false);
  });

  it("short: chạm khi high ≥ invalidation", () => {
    expect(invalidationTouched(candles, 0, 2 * 3_600_000, 103, "exhaustion")).toBe(true);
    expect(invalidationTouched(candles, 0, 2 * 3_600_000, 120, "exhaustion")).toBe(false);
  });

  it("không có invalidation/nến/chiều rõ ràng → null", () => {
    expect(invalidationTouched(candles, 0, 2 * 3_600_000, null, "continuation")).toBeNull();
    expect(invalidationTouched(candles, 0, 2 * 3_600_000, 97, "neutral")).toBeNull();
    expect(invalidationTouched(candles, 9 * 3_600_000, 10 * 3_600_000, 97, "continuation")).toBeNull();
  });

  it("chỉ xét nến trong horizon", () => {
    const late = [{ openTime: 24 * 3_600_000, high: 90, low: 80 }];
    expect(invalidationTouched(late, 0, 4 * 3_600_000, 85, "continuation")).toBeNull();
    expect(invalidationTouched(late, 0, 24 * 3_600_000, 85, "continuation")).toBe(true);
  });
});

describe("summarizeRadarAlertStats", () => {
  const rows = [
    { tier: "URGENT", status: "SENT", sentAt: "2026-11-23T10:00:10.000Z", detectedAt: "2026-11-23T10:00:00.000Z" },
    { tier: "URGENT", status: "SENT", sentAt: "2026-11-23T10:00:20.000Z", detectedAt: "2026-11-23T10:00:00.000Z" },
    { tier: "ACTIONABLE", status: "FAILED", sentAt: null, detectedAt: "2026-11-23T10:00:00.000Z" },
    { tier: "ACTIONABLE", status: "SUPPRESSED", sentAt: null, detectedAt: "2026-11-23T10:00:00.000Z" },
    { tier: "WATCH", status: "PENDING", sentAt: null, detectedAt: "2026-11-23T10:00:00.000Z" },
    { tier: null, status: "SENT", sentAt: "2026-11-23T10:00:30.000Z", detectedAt: "2026-11-23T10:00:00.000Z" },
    { tier: "URGENT", status: "SENT", sentAt: "2026-11-23T09:59:00.000Z", detectedAt: "2026-11-23T10:00:00.000Z" },
  ];

  it("đếm sent/failed/suppressed/pending theo tier, giữ thứ tự URGENT→UNKNOWN", () => {
    const stats = summarizeRadarAlertStats(rows, 7);

    expect(stats.byTier).toEqual([
      // 3 SENT, nhưng dòng delta âm không vào mẫu p95.
      { tier: "URGENT", sent: 3, failed: 0, suppressed: 0, pending: 0 },
      { tier: "ACTIONABLE", sent: 0, failed: 1, suppressed: 1, pending: 0 },
      { tier: "WATCH", sent: 0, failed: 0, suppressed: 0, pending: 1 },
      { tier: "UNKNOWN", sent: 1, failed: 0, suppressed: 0, pending: 0 },
    ]);
    expect(stats.windowDays).toBe(7);
  });

  it("p95 detection→delivery chỉ tính mẫu SENT hợp lệ (bỏ delta âm)", () => {
    const stats = summarizeRadarAlertStats(rows, 7);
    expect(stats.deliverySamples).toBe(3);
    expect(stats.deliveryP95Seconds).toBe(29); // [10, 20, 30]
  });

  it("không có mẫu → p95 null", () => {
    const stats = summarizeRadarAlertStats([], 7);
    expect(stats.byTier).toEqual([]);
    expect(stats.deliveryP95Seconds).toBeNull();
  });
});

describe("alertPercentile", () => {
  it("nội suy tuyến tính, rỗng → null", () => {
    expect(alertPercentile([], 0.95)).toBeNull();
    expect(alertPercentile([5], 0.95)).toBe(5);
    expect(alertPercentile([10, 20, 30], 0.5)).toBe(20);
    expect(alertPercentile([10, 20, 30], 0.95)).toBeCloseTo(29, 6);
    expect(alertPercentile([1, 2, 3], 0)).toBe(1);
    expect(alertPercentile([1, 2, 3], 1)).toBe(3);
  });
});
