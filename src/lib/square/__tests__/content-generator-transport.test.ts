// SQ-LLM-TRANSPORT — a timeout / connection reset has no HTTP status, but it
// must still be reported to the google key pool: otherwise the hanging key
// stays "available" and is retried first on every following post.

import { generateContent } from "../content-generator";
import { googlePoolStats, _resetGoogleKeyPool } from "@/lib/llm/google-key-pool";
import { isolateLlmEnv, type LlmTestEnv } from "@/lib/llm/__tests__/llm-env";

// Minimal brief — same shape used by the existing content-generator smoke test.
const brief = () => ({
  opportunityId: 1,
  contentType: "text" as const,
  text: "Test content with $BTC",
  cashtags: ["$BTC"],
  dataAsOf: "2026-08-20",
});

describe("SQ-LLM-TRANSPORT: google key cooldown on transport failure", () => {
  const realFetch = global.fetch;
  let env: LlmTestEnv;

  beforeEach(() => {
    _resetGoogleKeyPool();
    env = isolateLlmEnv("transport-test-key-1234");
  });

  afterEach(() => {
    global.fetch = realFetch;
    _resetGoogleKeyPool();
    env.restore();
  });

  it("cools the key down and records status 0 instead of throwing", async () => {
    const timeoutError = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    const fetchMock = jest.fn().mockRejectedValue(timeoutError);
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateContent(brief());

    // Transport failures are not retried on the same provider (a retry would
    // burn another full timeout), so exactly one attempt is made.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.llmUsed).toBe(false); // deterministic template fallback

    const stats = googlePoolStats();
    expect(stats.total).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.available).toBe(0);
    expect(stats.perKey[0].cooling).toBe(true);
    expect(stats.perKey[0].lastStatus).toBe(0);
    expect(stats.perKey[0].failCount).toBe(1);
  });

  it("does not call the cooled key again on the next generation", async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
    global.fetch = fetchMock as unknown as typeof fetch;

    await generateContent(brief());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Pool is empty while the key is cooling → no provider left in the chain,
    // so this run must fall back to the template without touching the network.
    const second = await generateContent(brief());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.llmUsed).toBe(false);
  });
});
