// BT-02 — unit tests for the pure backtest engine (no DB).
import {
  computePickOutcome,
  aggregateOutcomes,
  pearson,
  isHorizonClosed,
  isSameSetupEpisode,
  type BacktestPickInput,
  type BacktestPriceRow,
  type PickOutcome,
} from "../engine";

const basePick = (over: Partial<BacktestPickInput> = {}): BacktestPickInput => ({
  pickId: 1,
  dataDate: "2026-09-01",
  coinId: 1,
  symbol: "TEST",
  direction: "BULLISH",
  signal: "WATCH",
  healthScore: 75,
  entryLow: 95,
  entryHigh: 105,
  entryMid: 100,
  tp1: 115,
  tp2: 130,
  stopLoss: 85,
  riskRewardRatio: 1.5,
  pickKind: "GENUINE",
  ...over,
});

const row = (date: string, high: number, low: number): BacktestPriceRow => ({
  date,
  high,
  low,
});

describe("computePickOutcome — BULLISH", () => {
  it("returns OPEN when there are no forward candles", () => {
    const o = computePickOutcome(basePick(), [row("2026-09-01", 100, 99)], 14);
    expect(o.outcome).toBe("OPEN");
    expect(o.exitR).toBeNull();
  });

  it("returns INVALID when levels are missing", () => {
    const o = computePickOutcome(basePick({ tp1: null }), [], 14);
    expect(o.outcome).toBe("INVALID");
  });

  it("wins at TP1 when high reaches tp1 before sl", () => {
    const prices = [row("2026-09-02", 116, 96), row("2026-09-03", 117, 110)];
    const o = computePickOutcome(basePick(), prices, 14);
    expect(o.outcome).toBe("TP1_WIN");
    expect(o.hitDay).toBe(1);
    expect(o.exitR).toBeCloseTo(1); // tp1Dist 15 / slDist 15
  });

  it("loses at SL when low reaches stop before tp1", () => {
    const prices = [row("2026-09-02", 104, 84)];
    const o = computePickOutcome(basePick(), prices, 14);
    expect(o.outcome).toBe("SL_LOSS");
    expect(o.exitR).toBe(-1);
    expect(o.hitDay).toBe(1);
  });

  it("is conservative when TP and SL are hit on the same candle", () => {
    const prices = [row("2026-09-02", 120, 80)];
    const o = computePickOutcome(basePick(), prices, 14);
    expect(o.outcome).toBe("SL_LOSS");
  });

  it("wins at TP2 and skips TP1 ordering", () => {
    const prices = [row("2026-09-02", 99, 98), row("2026-09-03", 132, 110)];
    const o = computePickOutcome(basePick(), prices, 14);
    expect(o.outcome).toBe("TP2_WIN");
    expect(o.exitR).toBeCloseTo(2); // tp2Dist 30 / slDist 15
  });

  it("stops counting MFE/MAE beyond the horizon", () => {
    const prices = [
      row("2026-09-02", 108, 95),
      row("2026-09-03", 112, 94),
      row("2026-09-04", 140, 80), // beyond horizon
    ];
    const o = computePickOutcome(basePick(), prices, 2);
    expect(o.outcome).toBe("OPEN");
    expect(o.mfePct).toBeCloseTo(12, 0);
    expect(o.maePct).toBeCloseTo(6, 0);
  });

  it("marks entry filled when price returns into the zone within 3 days", () => {
    const prices = [
      row("2026-09-02", 113, 110), // no fill, no TP/SL yet
      row("2026-09-03", 114, 100), // touched 100 <= entryHigh(105)
    ];
    const o = computePickOutcome(basePick(), prices, 14);
    expect(o.outcome).toBe("OPEN");
    expect(o.entryFilled).toBe(true);
    expect(o.mfePct).toBeGreaterThan(0);
  });

  it("marks entry unfilled when price never returns to the zone", () => {
    const prices = [row("2026-09-02", 140, 118), row("2026-09-03", 139, 117)];
    const o = computePickOutcome(basePick(), prices, 14);
    expect(o.entryFilled).toBe(false);
  });
});

describe("BT-03 — horizon closure semantics", () => {
  it("NO_HIT is final when the horizon window is closed", () => {
    const prices = [row("2026-09-02", 104, 98), row("2026-09-03", 106, 97)];
    const o = computePickOutcome(basePick(), prices, 2, { horizonClosed: true });
    expect(o.outcome).toBe("NO_HIT");
    expect(o.exitR).toBeNull();
    expect(o.mfePct).not.toBeNull();
  });

  it("stays OPEN when the window is not closed (stay PENDING)", () => {
    const prices = [row("2026-09-02", 104, 98), row("2026-09-03", 106, 97)];
    const o = computePickOutcome(basePick(), prices, 2);
    expect(o.outcome).toBe("OPEN");
  });

  it("closed window with a TP hit still resolves as a win", () => {
    const prices = [row("2026-09-02", 104, 98), row("2026-09-03", 116, 100)];
    const o = computePickOutcome(basePick(), prices, 2, { horizonClosed: true });
    expect(o.outcome).toBe("TP1_WIN");
  });

  it("isHorizonClosed boundary: exactly horizon days is closed", () => {
    expect(isHorizonClosed("2026-09-01", 14, "2026-09-15")).toBe(true);
    expect(isHorizonClosed("2026-09-01", 14, "2026-09-14")).toBe(false);
    expect(isHorizonClosed("2026-09-01", 14, "2026-10-01")).toBe(true);
  });
});

describe("BT-04 — isSameSetupEpisode", () => {
  const prevSetup = {
    direction: "BULLISH",
    hasSetup: true,
    entryLow: "99.5",
    entryHigh: "100.5",
    entryMid: "100",
    tp1: "115",
    tp2: "130",
    stopLoss: "85",
  };
  const nextSetup = {
    direction: "BULLISH" as const,
    hasSetup: true,
    entryLow: 99.6,
    entryHigh: 100.4,
    entryMid: 100,
    tp1: 115.5,
    tp2: 130.2,
    stopLoss: 85.1,
  };

  it("treats a near-identical re-render as the same episode", () => {
    expect(isSameSetupEpisode(prevSetup, nextSetup)).toBe(true);
  });

  it("detects a new episode when direction flips", () => {
    expect(
      isSameSetupEpisode(prevSetup, { ...nextSetup, direction: "BEARISH" as const })
    ).toBe(false);
  });

  it("detects a new episode when levels move beyond tolerance", () => {
    expect(
      isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 125 })
    ).toBe(false);
  });

  it("tolerance mặc định 3%: drift ~2% vẫn là cùng episode (crypto noise)", () => {
    // tp1 115 → 117 (1.74%), entryMid 100 → 102 (2%), SL 85 → 83.5 (1.76%)
    expect(
      isSameSetupEpisode(prevSetup, {
        ...nextSetup,
        entryMid: 102,
        tp1: 117,
        stopLoss: 83.5,
      })
    ).toBe(true);
  });

  it("env BT_EPISODE_TOLERANCE_PCT mở rộng/thu hẹp biên mà không cần sửa code", () => {
    const prev = process.env.BT_EPISODE_TOLERANCE_PCT;
    try {
      // 10% → tp1 115 → 124 (7.83%) vẫn cùng episode
      process.env.BT_EPISODE_TOLERANCE_PCT = "10";
      expect(isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 124 })).toBe(true);

      // Kẹp tối thiểu 0.5%: nextSetup gốc (drift lớn nhất 0.43%) vẫn cùng episode
      process.env.BT_EPISODE_TOLERANCE_PCT = "0.1";
      expect(isSameSetupEpisode(prevSetup, nextSetup)).toBe(true);

      // 0.5% → tp1 115 → 116.2 (1.04%) là episode mới
      process.env.BT_EPISODE_TOLERANCE_PCT = "0.5";
      expect(isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 116.2 })).toBe(false);
    } finally {
      // không để env leak sang test khác (test pollution guard)
      if (prev === undefined) delete process.env.BT_EPISODE_TOLERANCE_PCT;
      else process.env.BT_EPISODE_TOLERANCE_PCT = prev;
    }
  });

  it("env rỗng/whitespace hoặc không hợp lệ → fallback default 3% (không phải 0.5%)", () => {
    const prev = process.env.BT_EPISODE_TOLERANCE_PCT;
    try {
      // Number("") === 0 → clamp về 0.5% là bug; phải về default 3%.
      // tp1 115 → 117.5 = 2.17%: dưới 3% (true) nhưng trên 0.5%.
      process.env.BT_EPISODE_TOLERANCE_PCT = "";
      expect(isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 117.5 })).toBe(true);

      process.env.BT_EPISODE_TOLERANCE_PCT = "   ";
      expect(isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 117.5 })).toBe(true);

      // Không phải số → default 3%: 2.17% vẫn cùng episode,
      // 4.35% (tp1 120) vẫn là episode mới.
      process.env.BT_EPISODE_TOLERANCE_PCT = "abc";
      expect(isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 117.5 })).toBe(true);
      expect(isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 120 })).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.BT_EPISODE_TOLERANCE_PCT;
      else process.env.BT_EPISODE_TOLERANCE_PCT = prev;
    }
  });

  it("env clamp tối đa 20%: giá trị lớn hơn bị kẹp về 20%", () => {
    const prev = process.env.BT_EPISODE_TOLERANCE_PCT;
    try {
      process.env.BT_EPISODE_TOLERANCE_PCT = "100"; // clamp → 20%
      // tp1 115 → 132 = 14.8% < 20% → cùng episode
      expect(isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 132 })).toBe(true);
      // tp1 115 → 140 = 21.7% > 20% → episode mới (nếu không clamp sẽ true)
      expect(isSameSetupEpisode(prevSetup, { ...nextSetup, tp1: 140 })).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.BT_EPISODE_TOLERANCE_PCT;
      else process.env.BT_EPISODE_TOLERANCE_PCT = prev;
    }
  });

  it("no-setup picks repeat when direction matches", () => {
    expect(
      isSameSetupEpisode(
        { direction: "BULLISH", hasSetup: false, entryLow: null, entryHigh: null, entryMid: null, tp1: null, tp2: null, stopLoss: null },
        { direction: "BULLISH", hasSetup: false, entryLow: null, entryHigh: null, entryMid: null, tp1: null, tp2: null, stopLoss: null }
      )
    ).toBe(true);
  });

  it("no-setup pick becomes a new episode when setup appears", () => {
    expect(
      isSameSetupEpisode(
        { direction: "BULLISH", hasSetup: false, entryLow: null, entryHigh: null, entryMid: null, tp1: null, tp2: null, stopLoss: null },
        nextSetup
      )
    ).toBe(false);
  });
});

describe("aggregateOutcomes — NO_HIT handling", () => {
  const mk = (over: Partial<PickOutcome>): PickOutcome => ({
    pickId: 1,
    dataDate: "2026-09-01",
    coinId: 1,
    symbol: "T",
    direction: "BULLISH",
    signal: "WATCH",
    healthScore: 70,
    pickKind: "GENUINE",
    entryMid: 100,
    outcome: "OPEN",
    exitR: null,
    hitDay: null,
    mfePct: null,
    maePct: null,
    entryFilled: null,
    ...over,
  });

  it("NO_HIT is counted separately and excluded from win rate", () => {
    const g = aggregateOutcomes("g", [
      mk({ outcome: "TP1_WIN", exitR: 1, hitDay: 2 }),
      mk({ outcome: "SL_LOSS", exitR: -1, hitDay: 3 }),
      mk({ outcome: "NO_HIT" }),
    ]);
    expect(g.noHit).toBe(1);
    expect(g.winRate).toBeCloseTo(50);
    expect(g.avgR).toBeCloseTo(0);
  });
});

describe("computePickOutcome — BEARISH", () => {
  it("wins at TP1 when low reaches tp1 below entry", () => {
    const pick = basePick({
      direction: "BEARISH",
      entryLow: 95,
      entryHigh: 105,
      entryMid: 100,
      tp1: 85,
      tp2: 70,
      stopLoss: 115,
    });
    const o = computePickOutcome(pick, [row("2026-09-02", 104, 84)], 14);
    expect(o.outcome).toBe("TP1_WIN");
    expect(o.exitR).toBeCloseTo(1); // tp1Dist 15 / slDist 15
  });

  it("loses at SL when high reaches stop above entry", () => {
    const pick = basePick({
      direction: "BEARISH",
      entryMid: 100,
      tp1: 85,
      stopLoss: 115,
    });
    const o = computePickOutcome(pick, [row("2026-09-02", 116, 100)], 14);
    expect(o.outcome).toBe("SL_LOSS");
  });
});

describe("aggregateOutcomes", () => {
  const mk = (over: Partial<PickOutcome>): PickOutcome => ({
    pickId: 1,
    dataDate: "2026-09-01",
    coinId: 1,
    symbol: "T",
    direction: "BULLISH",
    signal: "WATCH",
    healthScore: 70,
    pickKind: "GENUINE",
    entryMid: 100,
    outcome: "OPEN",
    exitR: null,
    hitDay: null,
    mfePct: null,
    maePct: null,
    entryFilled: null,
    ...over,
  });

  it("computes win rate excluding OPEN and averages R over resolved", () => {
    const g = aggregateOutcomes("all", [
      mk({ outcome: "TP1_WIN", exitR: 1.5, hitDay: 3, entryFilled: true, mfePct: 10, maePct: 2 }),
      mk({ outcome: "TP2_WIN", exitR: 3, hitDay: 5, entryFilled: true, mfePct: 20, maePct: 4 }),
      mk({ outcome: "SL_LOSS", exitR: -1, hitDay: 2, entryFilled: false, mfePct: 1, maePct: 15 }),
      mk({ outcome: "OPEN", mfePct: 3, maePct: 1 }),
      mk({ outcome: "INVALID" }),
    ]);
    expect(g.picks).toBe(5);
    expect(g.tp1Wins).toBe(1);
    expect(g.tp2Wins).toBe(1);
    expect(g.slLosses).toBe(1);
    expect(g.open).toBe(1);
    expect(g.winRate).toBeCloseTo(66.7);
    expect(g.avgR).toBeCloseTo(1.17, 1);
    expect(g.avgDaysToExit).toBeCloseTo(3.33, 1);
    expect(g.entryFillRate).toBeCloseTo(66.7);
    expect(g.avgMfePct).toBeCloseTo(8.5, 1);
  });

  it("returns nulls for an empty group", () => {
    const g = aggregateOutcomes("empty", []);
    expect(g.picks).toBe(0);
    expect(g.winRate).toBeNull();
    expect(g.avgR).toBeNull();
  });
});

describe("pearson", () => {
  it("detects a strong positive relationship", () => {
    const xs = [80, 85, 90, 95, 100, 78, 88, 92];
    const ys = [2, 2.5, 3, 3.6, 4, 1.8, 2.9, 3.3];
    const r = pearson(xs, ys);
    expect(r).not.toBeNull();
    expect(r as number).toBeGreaterThan(0.95);
  });

  it("returns null for too-few samples", () => {
    expect(pearson([1, 2], [1, 2])).toBeNull();
  });
});
