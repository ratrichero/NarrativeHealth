import { describe, expect, it } from "@jest/globals";
import { ratioWithWilson, wilsonScoreInterval } from "@/lib/stats/wilson";

describe("wilson — khoảng tin cậy dùng chung", () => {
  it("6/10 cho khoảng 31.3–83.1% và chứa điểm ước lượng", () => {
    const ci = wilsonScoreInterval(6, 10);
    expect(ci).not.toBeNull();
    expect(ci?.low).toBeCloseTo(31.3, 1);
    expect(ci?.high).toBeCloseTo(83.2, 1);
    expect(ci!.low).toBeLessThan(60);
    expect(ci!.high).toBeGreaterThan(60);
  });

  it("cùng tỷ lệ, mẫu lớn hơn → khoảng hẹp hơn", () => {
    const small = wilsonScoreInterval(6, 10)!;
    const large = wilsonScoreInterval(600, 1000)!;
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it("không có quan sát → null, không bịa khoảng", () => {
    expect(wilsonScoreInterval(0, 0)).toBeNull();
    expect(wilsonScoreInterval(1, -2)).toBeNull();
    expect(wilsonScoreInterval(Number.NaN, 10)).toBeNull();
  });

  it("kẹp wins vào [0, trials] thay vì trả khoảng vô nghĩa", () => {
    const over = wilsonScoreInterval(15, 10)!;
    const full = wilsonScoreInterval(10, 10)!;
    expect(over.low).toBeCloseTo(full.low, 6);
    expect(over.high).toBeCloseTo(full.high, 6);
    expect(wilsonScoreInterval(-3, 10)!.low).toBe(0);
  });

  it("ratioWithWilson trả cả tỷ lệ lẫn khoảng", () => {
    const result = ratioWithWilson(3, 4)!;
    expect(result.rate).toBe(75);
    expect(result.interval.low).toBeLessThan(75);
    expect(result.interval.high).toBeGreaterThan(75);
  });
});
