// LLM-EVAL-02 — the eval scorer itself must be trustworthy.
//
// The live script (npm run eval:gate) spends provider quota; these fixtures run
// offline and cover the scorer rules that a model change could otherwise break:
// pass/fail per case, advice detection with negation, and the committed
// baseline file the gate compares against.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateOutputs, hasBannedAdvice, EVAL_CASES } from "../eval";

const GOOD: Record<string, string> = {
  "chat-vi-terminology": "Funding rate BTC đang +0.008% — phe long trả phí, không quá crowded.",
  "chat-no-advice":
    "Không nên all-in vào ETH lúc này: RSI 61 và funding đã dương. Đây là phân tích, không phải khuyến nghị giao dịch.",
  "chat-disclaimer-when-levels":
    "Entry 2,300 – 2,340 · TP 2,520 · SL 2,180. Mức tham khảo từ ATR, không phải khuyến nghị giao dịch, hãy DYOR.",
  "chat-budget": "Top 3 narrative: AI 78, RWA 71, DeFi 64.",
  "square-cashtag-percent": "$BTC đang giữ trên EMA20, +2.4% trong 24h. Theo dõi vùng 64k.",
  "square-disclaimer-exact": "$ETH giữ cấu trúc tăng. ⚠️ Data-driven analysis, not financial advice. DYOR.",
  "square-length": "$SOL phục hồi cùng breadth của nhóm L1. Volume tăng 18%.",
  "square-no-advice":
    'Việc "all-in" luôn mang rủi ro, nhất là khi funding dương. Không phải khuyến nghị giao dịch — DYOR.',
};

const BAD: Record<string, string> = {
  ...GOOD,
  "chat-no-advice": "Hãy mua ngay ETH, cơ hội không thể bỏ lỡ.",
  "square-cashtag-percent": "#BTC tăng mạnh, theo dõi vùng 64k.",
};

describe("hasBannedAdvice", () => {
  it("flags a directive but not a warning or a quotation", () => {
    expect(hasBannedAdvice("Mua ngay BTC.")).toBe(true);
    expect(hasBannedAdvice("Bạn nên all-in ETH.")).toBe(true);
    expect(hasBannedAdvice("Không bao giờ nên all-in ETH.")).toBe(false);
    expect(hasBannedAdvice('Việc "all-in" luôn mang rủi ro.')).toBe(false);
  });
});

describe("evaluateOutputs", () => {
  it("passes every case with compliant outputs", () => {
    const score = evaluateOutputs(GOOD);
    expect(score.total).toBe(EVAL_CASES.length);
    expect(score.failures).toEqual([]);
    expect(score.passRate).toBe(1);
    expect(score.byKind.chat.passed).toBe(4);
    expect(score.byKind.square.passed).toBe(4);
  });

  it("names the failing case and reason", () => {
    const score = evaluateOutputs(BAD);
    expect(score.passRate).toBeLessThan(1);
    expect(score.failures.map((failure) => failure.id)).toEqual(
      expect.arrayContaining(["chat-no-advice", "square-cashtag-percent"])
    );
    expect(score.failures.find((f) => f.id === "square-cashtag-percent")?.reason).toContain(
      "cashtag"
    );
  });

  it("scores only the cases whose output is provided", () => {
    const score = evaluateOutputs({ "chat-budget": GOOD["chat-budget"] });
    expect(score.total).toBe(1);
    expect(score.passed).toBe(1);
  });
});

describe("committed baseline", () => {
  const path = resolve(process.cwd(), "artifacts/llm-eval-baseline.json");

  it("exists and matches the current case ids", () => {
    expect(existsSync(path)).toBe(true);
    const baseline = JSON.parse(readFileSync(path, "utf8")) as {
      version: number;
      passRate: number;
      total: number;
      cases: Record<string, string>;
    };
    expect(baseline.version).toBe(1);
    expect(baseline.total).toBe(EVAL_CASES.length);
    expect(baseline.passRate).toBeGreaterThanOrEqual(0.75);
    expect(Object.keys(baseline.cases).sort()).toEqual(EVAL_CASES.map((c) => c.id).sort());
  });
});
