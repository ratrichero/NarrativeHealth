// BT-06 — buildBacktestInsights: các rule deterministic của tab Backtest.
// Mục tiêu: mỗi rule có guard mẫu, không rule nào bắn khi số liệu cân bằng,
// và NO_SETUP/PENDING không bao giờ lẫn vào thống kê.

import {
  buildBacktestInsights,
  type InsightPick,
  type InsightOptions,
} from "../insights";

const pick = (over: Partial<InsightPick> = {}): InsightPick => ({
  dataDate: "2026-09-15",
  direction: "BULLISH",
  signal: "MOMENTUM_BREAK",
  healthScore: 70,
  outcome: "TP1_WIN",
  exitR: 1,
  ...over,
});

const build = (picks: InsightPick[], opts?: InsightOptions) =>
  buildBacktestInsights(picks, opts);

describe("BT-06 buildBacktestInsights", () => {
  test("thin sample (<30) → warning only, no conclusion rules", () => {
    // avgR 0.2 (giữa 0 và +0.3) để rule band không bắn song song.
    const insights = build(
      Array.from({ length: 10 }, () => pick({ exitR: 0.2 }))
    );
    expect(insights).toHaveLength(1);
    expect(insights[0].tone).toBe("warning");
    expect(insights[0].text).toContain("Mẫu mới 10 pick");
  });

  test("mixedHorizon option → warning about mixed horizons", () => {
    const picks = Array.from({ length: 40 }, (_, i) =>
      pick({ dataDate: i % 2 ? "2026-08-10" : "2026-09-10" })
    );
    const insights = build(picks, { mixedHorizon: true });
    expect(
      insights.some(
        (i) => i.tone === "warning" && i.text.includes("gộp nhiều horizon")
      )
    ).toBe(true);
  });

  test("direction gap ≥10pp → single positive LONG insight", () => {
    const picks: InsightPick[] = [];
    for (let i = 0; i < 30; i++) {
      picks.push(
        pick({
          direction: "BULLISH",
          outcome: i < 24 ? "TP1_WIN" : "SL_LOSS",
          exitR: i < 24 ? 1.5 : -1,
          healthScore: null,
          signal: "ONE_SIGNAL",
        })
      );
      picks.push(
        pick({
          direction: "BEARISH",
          outcome: i < 6 ? "TP1_WIN" : "SL_LOSS",
          exitR: i < 6 ? 1.5 : -1,
          healthScore: null,
          signal: "ONE_SIGNAL",
        })
      );
    }
    const insights = build(picks);
    expect(insights).toHaveLength(1);
    expect(insights[0].tone).toBe("positive");
    expect(insights[0].text).toContain("LONG thắng 80%");
    expect(insights[0].text).toContain("n=30");
    expect(insights[0].text).toContain("20%");
  });

  test("best health band avgR ≥ +0.3 → positive band insight", () => {
    const picks: InsightPick[] = [];
    for (let i = 0; i < 20; i++) {
      picks.push(pick({ healthScore: 85, outcome: "TP1_WIN", exitR: 2 }));
      picks.push(pick({ healthScore: 50, outcome: "SL_LOSS", exitR: -1 }));
    }
    const insights = build(picks);
    expect(insights).toHaveLength(1);
    expect(insights[0].tone).toBe("positive");
    expect(insights[0].text).toContain("Band health 80+");
    expect(insights[0].text).toContain("+2.00R");
  });

  test("monthly trend: last month ≥10pp better → positive improvement", () => {
    // 32 pick để vượt guard mẫu tổng (≥30) — nếu không warning mẫu sẽ
    // push kèm và làm hỏng assert length 1.
    const picks: InsightPick[] = [];
    for (let i = 0; i < 16; i++) {
      picks.push(
        pick({
          dataDate: "2026-08-10",
          outcome: i < 4 ? "TP1_WIN" : "SL_LOSS",
          exitR: i < 4 ? 1 : -1,
          healthScore: null,
          signal: "ONE_SIGNAL",
        })
      );
      picks.push(
        pick({
          dataDate: "2026-09-10",
          outcome: i < 14 ? "TP1_WIN" : "SL_LOSS",
          exitR: i < 14 ? 1 : -1,
          healthScore: null,
          signal: "ONE_SIGNAL",
        })
      );
    }
    const insights = build(picks);
    expect(insights).toHaveLength(1);
    expect(insights[0].tone).toBe("positive");
    expect(insights[0].text).toContain("Win rate 2026-09");
    expect(insights[0].text).toContain("đang cải thiện");
  });

  test("NO_HIT share ≥40% → info suggesting shorter horizon", () => {
    const picks: InsightPick[] = [];
    for (let i = 0; i < 50; i++) {
      picks.push(
        i < 25
          ? pick({ outcome: "NO_HIT", exitR: null, healthScore: null })
          : pick({
              outcome: i < 38 ? "TP1_WIN" : "SL_LOSS",
              exitR: i < 38 ? 1 : -1,
              healthScore: null,
            })
      );
    }
    const insights = build(picks);
    expect(insights).toHaveLength(1);
    expect(insights[0].tone).toBe("info");
    expect(insights[0].text).toContain("50%");
    expect(insights[0].text).toContain("không chạm TP lẫn SL");
  });

  test("balanced data → exactly one info fallback", () => {
    const picks: InsightPick[] = [];
    for (let i = 0; i < 40; i++) {
      picks.push(
        pick({
          dataDate: i < 20 ? "2026-08-10" : "2026-09-10",
          outcome: i % 2 === 0 ? "TP1_WIN" : "SL_LOSS",
          exitR: i % 2 === 0 ? 1 : -1,
        })
      );
    }
    const insights = build(picks);
    expect(insights).toHaveLength(1);
    expect(insights[0].tone).toBe("info");
    expect(insights[0].text).toContain("Số liệu cân bằng");
  });

  test("NO_SETUP / unsettled picks are excluded from stats", () => {
    const picks = Array.from({ length: 40 }, () =>
      pick({ outcome: "NO_SETUP", exitR: null })
    );
    const insights = build(picks);
    // trades = 0 → chỉ warning mẫu, không rule nào tính NO_SETUP.
    expect(insights).toHaveLength(1);
    expect(insights[0].tone).toBe("warning");
    expect(insights[0].text).toContain("Mẫu mới 0 pick");
  });

  test("max option caps the number of insights", () => {
    const picks = Array.from({ length: 10 }, () => pick());
    const insights = build(picks, { max: 1, mixedHorizon: true });
    expect(insights).toHaveLength(1);
  });

  test("custom guards: higher minTotalSample triggers warning earlier", () => {
    const picks = Array.from({ length: 35 }, () => pick());
    expect(build(picks)[0].tone).not.toBe("warning");
    expect(build(picks, { minTotalSample: 50 })[0]).toMatchObject({
      tone: "warning",
      text: expect.stringContaining("<50"),
    });
  });
});
