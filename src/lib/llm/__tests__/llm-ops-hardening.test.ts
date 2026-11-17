// LLM-ERR/TELEMETRY/BUDGET/CAP/CONTEXT/EVAL — pure unit coverage.

import {
  classifyLlmFailure,
  isChainFatal,
  isProviderIndependentFailure,
  payloadFingerprint,
} from "../errors";
import { _resetLlmBudget, budgetStats, keyIdentity, keyOverBudget, recordTokenUsage } from "../budget";
import {
  _resetLlmCapabilities,
  learnModelRejectsTools,
  modelCapabilities,
  modelSupportsTools,
} from "../capabilities";
import { estimateTokens, messagesTokens, trimHistoryForBudget } from "../context";
import { EVAL_CASES, evaluateOutputs, hasBannedAdvice, scoreEval } from "../eval";
import { detectLlmStorms, type LlmTelemetryBucket } from "../telemetry";

describe("error taxonomy", () => {
  it("classifies statuses into actionable kinds", () => {
    expect(classifyLlmFailure(0)).toBe("transport");
    expect(classifyLlmFailure(401)).toBe("auth");
    expect(classifyLlmFailure(403)).toBe("auth");
    expect(classifyLlmFailure(429)).toBe("rate_limit");
    expect(classifyLlmFailure(503)).toBe("capacity");
    expect(classifyLlmFailure(500)).toBe("capacity");
    expect(
      classifyLlmFailure(400, JSON.stringify({ error: "invalid JSON in messages[1]" }))
    ).toBe("request_invalid");
    expect(classifyLlmFailure(400, "blocked by safety policy")).toBe("content_policy");
    expect(classifyLlmFailure(418)).toBe("unknown");
  });

  it("treats a malformed request as chain-fatal but not a policy refusal", () => {
    expect(isChainFatal("request_invalid")).toBe(true);
    expect(isChainFatal("content_policy")).toBe(false);
    expect(isChainFatal("rate_limit")).toBe(false);
  });

  it("only stops the chain for a provider-independent request fault", () => {
    expect(
      isProviderIndependentFailure("request_invalid", "request body is not valid JSON")
    ).toBe(true);
    expect(isProviderIndependentFailure("request_invalid", "Failed to parse body as JSON")).toBe(
      true
    );
    // Provider-shaped 400s must keep falling through to the next tier.
    expect(
      isProviderIndependentFailure(
        "request_invalid",
        "invalid JSON in messages[1].tool_calls[0].function.arguments"
      )
    ).toBe(false);
    expect(
      isProviderIndependentFailure(
        "request_invalid",
        "Function call is missing a thought_signature in functionCall parts"
      )
    ).toBe(false);
    expect(isProviderIndependentFailure("auth", "request body is not valid JSON")).toBe(false);
    expect(isProviderIndependentFailure("rate_limit", "invalid json body")).toBe(false);
  });

  it("fingerprints payloads without leaking content", () => {
    const a = payloadFingerprint({ model: "x", messages: [] });
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(payloadFingerprint({ model: "x", messages: [] })).toBe(a);
    expect(payloadFingerprint({ model: "y" })).not.toBe(a);
  });
});

describe("token budget", () => {
  beforeEach(() => _resetLlmBudget());

  it("skips a key only after its window is spent", () => {
    const key = "sk-test-abcdefgh1234";
    expect(keyOverBudget(key)).toBe(false);
    recordTokenUsage(key, 5_000);
    expect(keyOverBudget(key, 7_000)).toBe(true);
    expect(keyOverBudget(key, 1_000)).toBe(false);
    expect(budgetStats().keys[0]?.tokens).toBe(5_000);
  });

  it("respects LLM_KEY_TOKENS_PER_MIN", () => {
    const previous = process.env.LLM_KEY_TOKENS_PER_MIN;
    process.env.LLM_KEY_TOKENS_PER_MIN = "1000";
    try {
      const key = "sk-small-window-9999";
      recordTokenUsage(key, 900);
      expect(keyOverBudget(key, 200)).toBe(true);
    } finally {
      process.env.LLM_KEY_TOKENS_PER_MIN = previous;
    }
  });

  it("never stores the raw key", () => {
    const key = "sk-secret-value-9876";
    expect(keyIdentity(key)).not.toContain("secret");
    expect(keyIdentity(key).endsWith("9876")).toBe(true);
  });
});

describe("capability registry", () => {
  beforeEach(() => _resetLlmCapabilities());

  it("knows free routers are tool-poor and Gemini/Qwen are not", () => {
    expect(modelCapabilities("gemini-3.5-flash-lite").tools).toBe(true);
    expect(modelSupportsTools("Qwen3.8-27B")).toBe(true);
  });

  it("remembers a model that rejected a tool payload", () => {
    const model = "some/tool-strict-model";
    expect(modelSupportsTools(model)).toBe(true);
    learnModelRejectsTools(model);
    expect(modelSupportsTools(model)).toBe(false);
    expect(modelCapabilities(model).streaming).toBe(true);
  });
});

describe("context management", () => {
  it("estimates tokens from characters", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens(null)).toBe(0);
  });

  it("keeps system + newest turns and drops the oldest", () => {
    const messages = [
      { role: "system" as const, content: "system prompt " + "x".repeat(400) },
      ...Array.from({ length: 20 }, (_, i) => ({
        role: "user" as const,
        content: `message ${i} ` + "y".repeat(400),
      })),
    ];
    const trimmed = trimHistoryForBudget(messages, 1_000);
    expect(trimmed.messages[0].role).toBe("system");
    expect(trimmed.dropped).toBeGreaterThan(0);
    expect(trimmed.estimatedTokens).toBeLessThanOrEqual(1_400);
    expect(trimmed.messages.at(-1)?.content).toContain("message 19");
    expect(messagesTokens(trimmed.messages)).toBeGreaterThan(0);
  });

  it("keeps everything when it already fits", () => {
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "hello" },
    ];
    const trimmed = trimHistoryForBudget(messages, 5_000);
    expect(trimmed.dropped).toBe(0);
    expect(trimmed.messages).toHaveLength(2);
  });
});

describe("eval harness", () => {
  it("scores passing and failing outputs", () => {
    const score = evaluateOutputs({
      "chat-no-advice": "Không nên dồn toàn bộ vốn; hãy quản trị rủi ro. không phải khuyến nghị giao dịch, hãy DYOR",
      "square-length": "x".repeat(1_500),
    });
    expect(score.total).toBe(2);
    expect(score.passed).toBe(1);
    expect(score.failures.map((f) => f.id)).toEqual(["square-length"]);
  });

  it("only flags phrases used as advice, not warnings or quotes", () => {
    // Real answers that must pass:
    expect(hasBannedAdvice("Không bao giờ nên all-in vào bất kỳ tài sản nào.")).toBe(false);
    expect(
      hasBannedAdvice('Việc "all-in" vào bất kỳ tài sản nào luôn mang rủi ro rất cao.')
    ).toBe(false);
    expect(hasBannedAdvice("Đừng mua ngay, hãy chờ xác nhận.")).toBe(false);
    expect(hasBannedAdvice("Never buy now on a single candle.")).toBe(false);
    // Actual advice:
    expect(hasBannedAdvice("Mua ngay đi, ETH sẽ tăng.")).toBe(true);
    expect(hasBannedAdvice("All-in BTC ngay hôm nay!")).toBe(true);
    expect(hasBannedAdvice("Không nên chờ đợi; mua ngay khi có tín hiệu.")).toBe(true);
    expect(hasBannedAdvice("Bạn nên all-in ETH lúc này.")).toBe(true);
  });

  it("flags buy advice, missing cashtag and missing disclaimer", () => {
    const score = evaluateOutputs({
      "chat-no-advice": "Mua ngay đi!",
      "square-cashtag-percent": "ETH tăng 3% hôm nay.",
      "square-disclaimer-exact": "Post without disclaimer",
    });
    expect(score.passed).toBe(0);
    expect(score.failures).toHaveLength(3);
  });

  it("has unique ids and a check for every case", () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const testCase of EVAL_CASES) {
      const failure = testCase.check("x");
      expect(failure === null || typeof failure === "string").toBe(true);
    }
  });

  it("returns an empty score for an empty result set", () => {
    expect(scoreEval([])).toEqual({
      total: 0,
      passed: 0,
      passRate: 0,
      byKind: { chat: { total: 0, passed: 0 }, square: { total: 0, passed: 0 } },
      failures: [],
    });
  });
});

describe("storm detection", () => {
  const bucket = (over: Partial<LlmTelemetryBucket> = {}): LlmTelemetryBucket => ({
    hour: new Date().toISOString().slice(0, 13) + ":00:00.000Z",
    provider: "google",
    source: "chat",
    calls: 4,
    ok: 4,
    fail: 0,
    msSum: 100,
    tokens: 10,
    statuses: { "200": 4 },
    kinds: {},
    ...over,
  });

  it("alerts when a tier only fails", () => {
    const alerts = detectLlmStorms([bucket({ ok: 0, fail: 4, statuses: { "403": 4 } })]);
    expect(alerts[0]?.provider).toBe("google");
    expect(alerts[0]?.message).toContain("4/4");
  });

  it("alerts on repeated request_invalid even with successes", () => {
    const alerts = detectLlmStorms([bucket({ kinds: { request_invalid: 3 } })]);
    expect(alerts[0]?.message).toContain("invalid");
  });

  it("stays quiet for healthy traffic", () => {
    expect(detectLlmStorms([bucket()])).toEqual([]);
  });
});
