// LLM-SHADOW-01 — candidate-tier shadow sampling.

import {
  _resetLlmShadow,
  maybeRunShadow,
  shadowComparison,
  shadowConfig,
  shadowSnapshot,
  shouldShadow,
} from "../shadow";
import { _resetGoogleKeyPool } from "@/lib/llm/google-key-pool";
import { isolateLlmEnv, type LlmTestEnv } from "./llm-env";

describe("shadow config", () => {
  const original = { ...process.env };

  beforeEach(() => {
    _resetLlmShadow();
    delete process.env.LLM_SHADOW_TIER;
    delete process.env.LLM_SHADOW_PCT;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("is off unless both tier and percentage are set", () => {
    expect(shadowConfig()).toEqual({ tier: null, pct: 0 });
    expect(shouldShadow(0.01)).toBe(false);
    process.env.LLM_SHADOW_TIER = "fallback1";
    process.env.LLM_SHADOW_PCT = "10";
    expect(shouldShadow(0.05)).toBe(true);
    expect(shouldShadow(0.5)).toBe(false);
    expect(shadowSnapshot()).toMatchObject({ enabled: true, tier: "fallback1", pct: 10 });
  });

  it("clamps the percentage to 100", () => {
    process.env.LLM_SHADOW_TIER = "primary";
    process.env.LLM_SHADOW_PCT = "900";
    expect(shadowConfig().pct).toBe(100);
  });
});

describe("shadow run", () => {
  const realFetch = global.fetch;
  let env: LlmTestEnv;

  beforeEach(() => {
    _resetLlmShadow();
    _resetGoogleKeyPool();
    env = isolateLlmEnv("shadow-google-key-1234");
    process.env.OPENAI_API_KEY = "shadow-primary-key-9999";
    process.env.MODEL_NAME = "shadow-primary-model";
    process.env.OPENAI_BASE_URL = "https://primary.test/v1";
    process.env.LLM_SHADOW_TIER = "primary";
    process.env.LLM_SHADOW_PCT = "100";
    process.env.LLM_SHADOW_TEST = "1";
  });

  afterEach(() => {
    global.fetch = realFetch;
    env.restore();
    delete process.env.LLM_SHADOW_TIER;
    delete process.env.LLM_SHADOW_PCT;
    delete process.env.LLM_SHADOW_TEST;
    _resetGoogleKeyPool();
  });

  it("records a candidate sample without touching the production answer", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "Funding +0.01%, không phải khuyến nghị giao dịch." } }],
          usage: { total_tokens: 120 },
        })
      )
    ) as unknown as typeof fetch;

    const sample = await maybeRunShadow({
      messages: [{ role: "user", content: "funding BTC?" }],
    });

    expect(sample).toMatchObject({ tier: "primary", model: "shadow-primary-model", ok: true, tokens: 120 });
    expect(sample?.adviceViolation).toBe(false);
    expect(sample?.chars).toBeGreaterThan(0);
  });

  it("flags an advice violation and a failed call", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "Mua ngay BTC!" } }] }))
      )
      .mockResolvedValueOnce(new Response("busy", { status: 503 })) as unknown as typeof fetch;

    const advised = await maybeRunShadow({ messages: [{ role: "user", content: "?" }] });
    expect(advised?.adviceViolation).toBe(true);

    const failed = await maybeRunShadow({ messages: [{ role: "user", content: "?" }] });
    expect(failed).toMatchObject({ ok: false, status: 503 });
  });

  it("does not sample when the dice say no", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    const sample = await maybeRunShadow({
      messages: [{ role: "user", content: "?" }],
      random: 1,
    });
    expect(sample).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("keeps the promotion verdict conservative", async () => {
    for (let i = 0; i < 5; i++) {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "ổn" } }] }))
      ) as unknown as typeof fetch;
      await maybeRunShadow({ messages: [{ role: "user", content: "?" }] });
    }
    const [comparison] = shadowComparison();
    expect(comparison.samples).toBe(5);
    expect(comparison.readyToPromote).toBe(false);
    expect(comparison.reason).toContain("20 mẫu");
  });
});
