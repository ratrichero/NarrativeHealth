import { describe, expect, it } from "@jest/globals";
import {
  BIAS_TTL_HOURS,
  MIN_TTL_RUNS,
  buildHoldRuns,
  deriveBiasTtl,
  effectiveTtlHours,
  median,
} from "@/lib/market/bias-ttl";

describe("bias TTL — suy từ dữ liệu đo", () => {
  it("median xử lý chẵn/lẻ và bỏ giá trị không hữu hạn", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([Number.NaN, 2])).toBe(2);
    expect(median([])).toBeNull();
  });

  it("đủ mẫu → dùng trung vị đo được thay bảng tĩnh", () => {
    const runs = Array.from({ length: MIN_TTL_RUNS }, (_, index) => ({
      bias: "exhaustion",
      // trung vị 6h, trong khi bảng tĩnh là 8h
      hours: index === 0 ? 6 : 6,
    }));
    const ttl = deriveBiasTtl(runs);
    expect(ttl.exhaustion.source).toBe("measured");
    expect(ttl.exhaustion.measuredHours).toBe(6);
    expect(ttl.exhaustion.staticHours).toBe(BIAS_TTL_HOURS.exhaustion);
    expect(effectiveTtlHours(ttl).exhaustion).toBe(6);
  });

  it("thiếu mẫu → giữ bảng tĩnh, không suy từ 3 lần quan sát", () => {
    const ttl = deriveBiasTtl([
      { bias: "breakout", hours: 3 },
      { bias: "breakout", hours: 3 },
      { bias: "breakout", hours: 3 },
    ]);
    expect(ttl.breakout.source).toBe("static");
    expect(ttl.breakout.measuredHours).toBeNull();
    expect(ttl.breakout.samples).toBe(3);
    expect(effectiveTtlHours(ttl).breakout).toBe(BIAS_TTL_HOURS.breakout);
  });

  it("kẹp trung vị vào 4–72h", () => {
    const fast = deriveBiasTtl(
      Array.from({ length: MIN_TTL_RUNS }, () => ({ bias: "exhaustion", hours: 1 }))
    );
    expect(fast.exhaustion.measuredHours).toBe(4);

    const slow = deriveBiasTtl(
      Array.from({ length: MIN_TTL_RUNS }, () => ({ bias: "accumulation", hours: 200 }))
    );
    expect(slow.accumulation.measuredHours).toBe(72);
  });

  it("đo từ lần chấm CUỐI của bias cũ tới lần chấm ĐẦU của bias mới", () => {
    const hour = 3_600_000;
    const start = Date.parse("2026-11-20T00:00:00Z");
    const runs = buildHoldRuns([
      { symbol: "BTC", side: "gainer", bias: "continuation", atMs: start },
      { symbol: "BTC", side: "gainer", bias: "continuation", atMs: start + 6 * hour },
      // Lật nhãn 3h sau lần chấm cuối — cách cũ (đầu→cuối) báo 6h, hụt 3h.
      { symbol: "BTC", side: "gainer", bias: "exhaustion", atMs: start + 9 * hour },
      { symbol: "BTC", side: "gainer", bias: "exhaustion", atMs: start + 13 * hour },
      { symbol: "BTC", side: "gainer", bias: "breakout", atMs: start + 16 * hour },
    ]);

    expect(runs).toEqual([
      { bias: "continuation", hours: 3 },
      { bias: "exhaustion", hours: 3 },
    ]);
    // breakout là run cuối của BTC|gainer, chưa lật → bỏ, không đoán 0h.
  });

  it("bỏ run cuối chưa đóng của TỪNG symbol+side", () => {
    const hour = 3_600_000;
    const start = Date.parse("2026-11-20T00:00:00Z");
    const runs = buildHoldRuns([
      // BTC đóng run continuation tại lần lật 20h.
      { symbol: "BTC", side: "gainer", bias: "continuation", atMs: start },
      { symbol: "BTC", side: "gainer", bias: "continuation", atMs: start + 5 * hour },
      { symbol: "BTC", side: "gainer", bias: "breakout", atMs: start + 20 * hour },
      // ETH chỉ có một nhãn tới hết cửa sổ → không run nào đóng.
      { symbol: "ETH", side: "gainer", bias: "exhaustion", atMs: start },
      { symbol: "ETH", side: "gainer", bias: "exhaustion", atMs: start + 10 * hour },
      // SOL cùng symbol nhưng side khác là khoá riêng, cũng chưa đóng.
      { symbol: "SOL", side: "loser", bias: "breakdown", atMs: start },
    ]);

    expect(runs).toEqual([{ bias: "continuation", hours: 15 }]);
  });

  it("run bị cắt ở mép trái cửa sổ vẫn đo đủ khoảng tới lúc lật", () => {
    const hour = 3_600_000;
    // Các lần chấm đầu tiên của run nằm TRƯỚC `since` và không được đọc; nếu đo
    // từ lúc bắt đầu run thì run này bị cắt còn 5h, còn đo tới lúc lật là 6h.
    const since = Date.parse("2026-11-01T00:00:00Z");
    const runs = buildHoldRuns([
      { symbol: "BTC", side: "gainer", bias: "accumulation", atMs: since + 2 * hour },
      { symbol: "BTC", side: "gainer", bias: "accumulation", atMs: since + 5 * hour },
      { symbol: "BTC", side: "gainer", bias: "continuation", atMs: since + 11 * hour },
    ]);

    expect(runs).toEqual([{ bias: "accumulation", hours: 6 }]);
  });

  it("một lần chấm duy nhất không tạo run", () => {
    expect(
      buildHoldRuns([
        { symbol: "BTC", side: "gainer", bias: "breakout", atMs: Date.parse("2026-11-20T00:00:00Z") },
      ])
    ).toEqual([]);
  });
});
