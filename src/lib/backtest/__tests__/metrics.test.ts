// BT-07 — metrics: chi phí (fee/slippage → net R song song gross) + risk depth
// (Wilson CI, max drawdown, profit factor, chuỗi thua). Pure — không I/O.

import {
  readFeeConfig,
  computeCostR,
  computeNetR,
  wilsonInterval,
  maxDrawdownR,
  profitFactor,
  longestLosingStreak,
} from "../metrics";

describe("BT-07 fee config (env-driven)", () => {
  const OLD = process.env;

  beforeEach(() => {
    process.env = { ...OLD };
    delete process.env.BT_FEE_BPS;
    delete process.env.BT_SLIPPAGE_BPS;
  });

  afterAll(() => {
    process.env = OLD;
  });

  test("default: taker 5bps + slippage 2bps → round-trip 14bps", () => {
    expect(readFeeConfig()).toEqual({ feeBps: 5, slippageBps: 2, roundTripBps: 14 });
  });

  test("env override + invalid/clamp", () => {
    process.env.BT_FEE_BPS = "10";
    process.env.BT_SLIPPAGE_BPS = "abc"; // không hợp lệ → default 2
    expect(readFeeConfig()).toEqual({ feeBps: 10, slippageBps: 2, roundTripBps: 24 });

    process.env.BT_FEE_BPS = "99999"; // clamp 1000
    process.env.BT_SLIPPAGE_BPS = ""; // rỗng → default 2
    expect(readFeeConfig().feeBps).toBe(1000);
  });
});

describe("BT-07 computeCostR / computeNetR", () => {
  test("round-trip cost quy về R: (14bps × entry) / risk", () => {
    // risk = 100 − 94 = 6; cost = 0.0014 × 100 / 6 = 0.02333…
    expect(computeCostR(100, 94, 14)).toBe(0.0233);
  });

  test("nhận decimal string (drizzle map) và các ca bất khả thi → null", () => {
    expect(computeCostR("100", "94", 14)).toBe(0.0233);
    expect(computeCostR(null, 94, 14)).toBeNull();
    expect(computeCostR(100, null, 14)).toBeNull();
    expect(computeCostR(100, 100, 14)).toBeNull(); // risk = 0
    expect(computeCostR(-1, 94, 14)).toBeNull();
  });

  test("computeNetR: exitR − costR (làm tròn 2dp như exitR); NO_HIT (null) giữ null", () => {
    expect(computeNetR(1, 0.0233)).toBe(0.98); // 0.9767 → 2dp
    expect(computeNetR(-1, 0.05)).toBe(-1.05);
    expect(computeNetR(null, 0.05)).toBeNull();
    expect(computeNetR(1, null)).toBe(1); // không có cost → giữ gross
  });
});

describe("BT-07 wilsonInterval", () => {
  test("0 trade → null", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
  });

  test("5/5 (n=10) đối xung quanh 50% và rộng (mẫu nhỏ → CI rộng)", () => {
    const ci = wilsonInterval(5, 5)!;
    expect(ci.lo).toBeLessThan(50);
    expect(ci.hi).toBeGreaterThan(50);
    // Đối xung: lo + hi ≈ 100
    expect(Math.abs(ci.lo + ci.hi - 100)).toBeLessThan(1);
    expect(ci.hi - ci.lo).toBeGreaterThan(40); // n=10 → khoảng > 40 điểm %
  });

  test("10/10: không bao giờ tự tin 100% — cận trên kẹp 100, cận dưới < 100", () => {
    const ci = wilsonInterval(10, 0)!;
    expect(ci.lo).toBeGreaterThan(60);
    expect(ci.hi).toBe(100);
  });
});

describe("BT-07 maxDrawdownR", () => {
  test("equity không giảm → 0", () => {
    expect(maxDrawdownR([])).toBe(0);
    expect(maxDrawdownR([1, 1.5, 0.5])).toBe(0);
  });

  test("đáy drawdown tính từ đỉnh (âm)", () => {
    // cum: 1 → −2 (đỉnh 1, dd = −3) → 0
    expect(maxDrawdownR([1, -3, 2])).toBe(-3);
    // cum: 2 → 1 → 0 → −1 (đỉnh 2, dd cuối = −1… nhưng dd nhỏ nhất = −3?)
    expect(maxDrawdownR([2, -1, -1, -1])).toBe(-3);
  });
});

describe("BT-07 profitFactor", () => {
  test("chưa đủ cả thắng lẫn thua → null", () => {
    expect(profitFactor([])).toBeNull();
    expect(profitFactor([1, 2])).toBeNull(); // chưa có lệnh thua
    expect(profitFactor([-1])).toBeNull(); // chưa có lệnh thắng
  });

  test("tổng R thắng / |tổng R thua|", () => {
    expect(profitFactor([2, 2, -1, -1])).toBe(2);
    expect(profitFactor([1, 1, -1, -1])).toBe(1); // hòa
    expect(profitFactor([0.5, 0.5, -1, -1])).toBe(0.5); // 1R thắng vs 2R thua
    expect(profitFactor([3, -1, -1])).toBe(1.5);
  });
});

describe("BT-07 longestLosingStreak", () => {
  test("chuỗi SL liên tiếp; NO_HIT/null đứt chuỗi", () => {
    expect(longestLosingStreak([])).toBe(0);
    expect(longestLosingStreak(["SL_LOSS", "SL_LOSS", "TP1_WIN", "SL_LOSS"])).toBe(2);
    expect(longestLosingStreak(["SL_LOSS", null, "SL_LOSS", "SL_LOSS"])).toBe(2);
    expect(longestLosingStreak(["SL_LOSS", "NO_HIT", "SL_LOSS"])).toBe(1);
    expect(longestLosingStreak(["TP1_WIN", "TP2_WIN"])).toBe(0);
  });
});
