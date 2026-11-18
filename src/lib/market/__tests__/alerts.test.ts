import { selectAlertRows, type AlertOptions } from "@/lib/market/alerts";
import type { RadarRow } from "@/lib/market/radar";

const opts: AlertOptions = {
  minScore: 75,
  minEntryQuality: 50,
  maxImpulseAgeHours: 12,
  cooldownHours: 6,
};

function row(overrides: Partial<RadarRow>): RadarRow {
  return {
    symbol: "ALT",
    pair: "ALTUSDT",
    bias: "continuation",
    score: 80,
    entryQuality: 70,
    impulseAgeHours: 3,
    price: 1,
    label: "Tiếp diễn tăng",
    ...overrides,
  } as unknown as RadarRow;
}

describe("selectAlertRows", () => {
  it("chọn tín hiệu đủ score/freshness và impulse còn mới", () => {
    const selected = selectAlertRows(
      [
        row({ symbol: "AAA" }),
        row({ symbol: "BBB", score: 60 }),
        row({ symbol: "CCC", entryQuality: 20 }),
        row({ symbol: "DDD", impulseAgeHours: 20 }),
        row({ symbol: "EEE", bias: "neutral" }),
      ],
      new Set(),
      "2026-01-01",
      opts
    );
    expect(selected.map((r) => r.symbol)).toEqual(["AAA"]);
  });

  it("dedupe theo symbol+bias+ngày", () => {
    const selected = selectAlertRows(
      [row({ symbol: "AAA" }), row({ symbol: "BBB" })],
      new Set(["AAA|continuation|2026-01-01"]),
      "2026-01-01",
      opts
    );
    expect(selected.map((r) => r.symbol)).toEqual(["BBB"]);
  });

  it("cho phép impulse null (coin không có dữ liệu 1h) nhưng vẫn qua ngưỡng", () => {
    const selected = selectAlertRows([row({ symbol: "AAA", impulseAgeHours: null })], new Set(), "2026-01-01", opts);
    expect(selected).toHaveLength(1);
  });
});
