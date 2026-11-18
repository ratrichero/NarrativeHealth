// LLM-COST-01 — USD estimate and daily budget.

import {
  _resetLlmCost,
  costSnapshot,
  costTodayUsd,
  dailyBudgetRemainingUsd,
  estimateCostUsd,
  overDailyBudget,
  recordLlmCost,
} from "../cost";

describe("cost estimate", () => {
  beforeEach(() => {
    _resetLlmCost();
    delete process.env.LLM_DAILY_BUDGET_USD;
    delete process.env.LLM_COST_INPUT_SHARE;
  });

  it("prices flash-lite by the documented 70/30 split", () => {
    // 1M tokens: 0.7M in × $0.075 + 0.3M out × $0.30 = $0.1425
    expect(estimateCostUsd("gemini-3.5-flash-lite", 1_000_000)).toBeCloseTo(0.1425, 6);
  });

  it("accepts an explicit input split and ignores zero tokens", () => {
    const allInput = estimateCostUsd("gemini-3.5-flash-lite", 1_000_000, 1_000_000);
    expect(allInput).toBeCloseTo(0.075, 6);
    expect(estimateCostUsd("gemini-3.5-flash-lite", 0)).toBe(0);
  });

  it("accumulates today's spend by provider and enforces the daily cap", () => {
    recordLlmCost({ provider: "google", model: "gemini-3.5-flash-lite", source: "chat", tokens: 1_000_000 });
    recordLlmCost({ provider: "primary", model: "qwen/qwen3.8-27b", source: "chat", tokens: 1_000_000 });
    expect(costTodayUsd()).toBeGreaterThan(0.14);

    const snapshot = costSnapshot();
    expect(snapshot.today.byProvider.google).toBeGreaterThan(0);
    expect(snapshot.today.byProvider.primary).toBeGreaterThan(0);
    expect(snapshot.overBudget).toBe(false);

    process.env.LLM_DAILY_BUDGET_USD = "0.01";
    expect(overDailyBudget()).toBe(true);
    expect(dailyBudgetRemainingUsd()).toBe(0);
    expect(costSnapshot().overBudget).toBe(true);
  });
});
