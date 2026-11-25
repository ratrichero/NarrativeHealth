// RADAR-TG P3: fast lane 3 phút + tier quyết định kênh/nhịp gửi.

import { describe, expect, it, jest } from "@jest/globals";
import { classifyAlertTier } from "@/lib/market/alerts";
import {
  alertDeliveryPolicy,
  fastCohortIntervalMinutes,
  normalizeCohortMode,
  selectFastUniverse,
} from "@/lib/market/fast-lane";
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

describe("fastCohortIntervalMinutes", () => {
  it("mặc định 3 phút, 0 = tắt, kẹp 1–5 phút", () => {
    expect(fastCohortIntervalMinutes(undefined)).toBe(3);
    expect(fastCohortIntervalMinutes(null)).toBe(3);
    expect(fastCohortIntervalMinutes("abc")).toBe(3);
    expect(fastCohortIntervalMinutes(-2)).toBe(3);
    expect(fastCohortIntervalMinutes(0)).toBe(0);
    expect(fastCohortIntervalMinutes("0")).toBe(0);
    expect(fastCohortIntervalMinutes(1)).toBe(1);
    expect(fastCohortIntervalMinutes("2")).toBe(2);
    expect(fastCohortIntervalMinutes(9)).toBe(5);
  });
});

describe("normalizeCohortMode", () => {
  it("chỉ chuỗi 'fast' bật fast lane", () => {
    expect(normalizeCohortMode("fast")).toBe("fast");
    expect(normalizeCohortMode("FAST")).toBe("full");
    expect(normalizeCohortMode("full")).toBe("full");
    expect(normalizeCohortMode(undefined)).toBe("full");
  });
});

describe("selectFastUniverse", () => {
  const tickers = Array.from({ length: 35 }, (_, index) => ({
    symbol: `S${index}USDT`,
    quoteVolume: String((index + 1) * 1_000_000),
  }));

  it("lấy top 30 theo quoteVolume, không sửa mảng vào", () => {
    const before = tickers.map((ticker) => ticker.symbol);
    const universe = selectFastUniverse(tickers);

    expect(universe).toHaveLength(30);
    expect(universe[0]?.symbol).toBe("S34USDT");
    expect(universe[29]?.symbol).toBe("S5USDT");
    expect(tickers.map((ticker) => ticker.symbol)).toEqual(before);
  });

  it("universe nhỏ hơn 30 giữ nguyên hết; limit 0 → rỗng", () => {
    expect(selectFastUniverse(tickers.slice(0, 7))).toHaveLength(7);
    expect(selectFastUniverse(tickers, 0)).toEqual([]);
  });
});

describe("classifyAlertTier ngưỡng", () => {
  it("URGENT đúng biên 85/70/3h khi có catalyst", () => {
    expect(
      classifyAlertTier(
        row({ score: 85, entryQuality: 70, impulseAgeHours: 3, catalystTriggered: true })
      )
    ).toBe("URGENT");
  });

  it("trượt bất kỳ điều kiện URGENT nào → ACTIONABLE hoặc thấp hơn", () => {
    expect(
      classifyAlertTier(
        row({ score: 84, entryQuality: 70, impulseAgeHours: 3, catalystTriggered: true })
      )
    ).toBe("ACTIONABLE");
    expect(
      classifyAlertTier(
        row({ score: 90, entryQuality: 69, impulseAgeHours: 3, catalystTriggered: true })
      )
    ).toBe("ACTIONABLE");
    expect(
      classifyAlertTier(
        row({ score: 90, entryQuality: 80, impulseAgeHours: 3.1, catalystTriggered: true })
      )
    ).toBe("ACTIONABLE");
  });

  it("ACTIONABLE đúng biên 75/50/12h; WATCH ≥65; dưới 65 → null", () => {
    expect(classifyAlertTier(row({ score: 75, entryQuality: 50, impulseAgeHours: 12 }))).toBe(
      "ACTIONABLE"
    );
    expect(classifyAlertTier(row({ score: 75, entryQuality: 49, impulseAgeHours: 12 }))).toBe(
      "WATCH"
    );
    expect(classifyAlertTier(row({ score: 65, entryQuality: 0, impulseAgeHours: 50 }))).toBe(
      "WATCH"
    );
    expect(classifyAlertTier(row({ score: 64, entryQuality: 0, impulseAgeHours: 50 }))).toBeNull();
  });
});

describe("alertDeliveryPolicy", () => {
  it("URGENT đi cả fast lane lẫn cohort đầy đủ, cả hai kênh", () => {
    const urgent = row({ score: 90, entryQuality: 80, impulseAgeHours: 1, catalystTriggered: true });
    const tier = classifyAlertTier(urgent);
    expect(tier).toBe("URGENT");
    expect(alertDeliveryPolicy(tier, "fast")).toEqual({ webhook: true, telegram: true });
    expect(alertDeliveryPolicy(tier, "full")).toEqual({ webhook: true, telegram: true });
  });

  it("ACTIONABLE chỉ gửi ở cohort đầy đủ (nhịp 30 phút)", () => {
    const tier = classifyAlertTier(row({ score: 80, entryQuality: 60, impulseAgeHours: 5 }));
    expect(tier).toBe("ACTIONABLE");
    expect(alertDeliveryPolicy(tier, "fast")).toEqual({ webhook: false, telegram: false });
    expect(alertDeliveryPolicy(tier, "full")).toEqual({ webhook: true, telegram: true });
  });

  it("WATCH đi cả webhook lẫn Telegram ở cohort đầy đủ, không vào fast lane", () => {
    const tier = classifyAlertTier(row({ score: 70, entryQuality: 30, impulseAgeHours: 20 }));
    expect(tier).toBe("WATCH");
    expect(alertDeliveryPolicy(tier, "fast")).toEqual({ webhook: false, telegram: false });
    expect(alertDeliveryPolicy(tier, "full")).toEqual({ webhook: true, telegram: true });
  });

  it("không rõ tier giữ hành vi cũ ở cohort đầy đủ, không vào fast lane", () => {
    expect(alertDeliveryPolicy(null, "full")).toEqual({ webhook: true, telegram: true });
    expect(alertDeliveryPolicy(null, "fast")).toEqual({ webhook: false, telegram: false });
  });
});
