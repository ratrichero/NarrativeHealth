// SQ-LLM-LENGTH — an over-length generation is repairable: the model must get
// a repair round asking it to trim, instead of the chain skipping straight to
// the next provider (which made verbose models fall back to the template every
// single time).

import { generateContent } from "../content-generator";
import { _resetGoogleKeyPool } from "@/lib/llm/google-key-pool";
import { isolateLlmEnv, type LlmTestEnv } from "@/lib/llm/__tests__/llm-env";

function completion(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

// No direction / WHY NOW / INVALIDATION in the brief → only the cashtag and the
// length rule can reject the output, which keeps this test focused.
const brief = () => ({
  opportunityId: 2,
  contentType: "text" as const,
  text: "Test content with $BTC",
  cashtags: ["$BTC"],
  dataAsOf: "2026-08-20",
});

const OVER_LIMIT = `${"market context ".repeat(100)} $BTC`; // ~1510 chars
const WITHIN_LIMIT = "Tight $BTC read: price holds above the 20-day average, volume is steady.";

async function repairPromptOf(fetchMock: jest.Mock): Promise<string> {
  const body = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
  return body.messages[body.messages.length - 1].content as string;
}

describe("SQ-LLM-LENGTH: over-length output gets a repair round", () => {
  const realFetch = global.fetch;
  let env: LlmTestEnv;

  beforeEach(() => {
    _resetGoogleKeyPool();
    env = isolateLlmEnv("length-test-key-9012");
  });

  afterEach(() => {
    global.fetch = realFetch;
    _resetGoogleKeyPool();
    env.restore();
  });

  it("asks the model to trim and accepts the shortened answer", async () => {
    expect(OVER_LIMIT.length).toBeGreaterThan(1400);

    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(completion(OVER_LIMIT))
      .mockResolvedValueOnce(completion(WITHIN_LIMIT));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateContent(brief());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.llmUsed).toBe(true);
    expect(result.text).toBe(WITHIN_LIMIT);

    // The repair turn must carry the character budget, otherwise the model has
    // no way to know why it was rejected.
    const repairPrompt = await repairPromptOf(fetchMock);
    expect(repairPrompt).toContain("hard limit is 1400");
    expect(repairPrompt).toContain("every cashtag");
  });

  it("falls back to the template when the repaired answer is still over-length", async () => {
    // Fresh Response per call — a body can only be read once.
    const fetchMock = jest.fn().mockImplementation(async () => completion(OVER_LIMIT));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateContent(brief());

    // 3 attempts on the only provider (initial + 2 repairs), then template.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.llmUsed).toBe(false);
  });
});
