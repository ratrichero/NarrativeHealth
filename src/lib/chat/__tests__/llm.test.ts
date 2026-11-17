// CHAT-LLM-BUDGET / CHAT-LLM-RETRY / SQ-CHAT-RESET / CHAT-LLM-MONITOR —
// unit tests for the chat provider chain: token clamp, transient-status retry,
// env-driven attempt budget, the reset signal after a mid-stream failure, and
// success reporting into the LLM monitor.

import { chatCompletion, chatCompletionStream } from "../llm";
import { _resetGoogleKeyPool } from "@/lib/llm/google-key-pool";
import { llmOutcomeSnapshot, _resetLlmMonitor } from "@/lib/llm/monitor";
import { isolateLlmEnv, type LlmTestEnv } from "@/lib/llm/__tests__/llm-env";

/** 200 with an assistant message. */
function okResponse(content = "ok"): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

/** Transient failure; retry-after is tiny so the retry backoff costs 1 ms. */
function transientResponse(status: number): Response {
  return new Response("busy", { status, headers: { "retry-after": "0.001" } });
}

function bodyOf(call: unknown[]): { messages: unknown[]; max_tokens: number } {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body));
}

const MESSAGES = [{ role: "user" as const, content: "hello" }];

/** A conversation that replays one assistant tool call (round 2 of a turn). */
const REPLAY_MESSAGES = () => [
  { role: "user" as const, content: "price of BTC?" },
  {
    role: "assistant" as const,
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function" as const,
        function: { name: "get_live_price", arguments: '{"symbol":"BTC"}' },
        extra_content: { google: { thought_signature: "sig-abc" } },
      },
    ],
  },
  { role: "tool" as const, tool_call_id: "call_1", content: '{"price":1}' },
];

function sseStream(chunks: string[], failAfter?: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (failAfter) setTimeout(() => controller.error(failAfter), 0);
      else controller.close();
    },
  });
}

describe("chat provider chain", () => {
  const realFetch = global.fetch;
  let env: LlmTestEnv;

  beforeEach(() => {
    _resetGoogleKeyPool();
    _resetLlmMonitor();
    env = isolateLlmEnv("chat-test-key-5678");
  });

  afterEach(() => {
    global.fetch = realFetch;
    _resetGoogleKeyPool();
    env.restore();
  });

  it("clamps max_tokens to 900 even when the caller asks for more", async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await chatCompletion({ messages: MESSAGES, maxTokens: 1200 });

    expect(result?.message.content).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]).max_tokens).toBe(900);
  });

  it("defaults max_tokens to 900 when the caller asks for nothing", async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    await chatCompletion({ messages: MESSAGES });

    expect(bodyOf(fetchMock.mock.calls[0]).max_tokens).toBe(900);
  });

  it("records the successful call in the LLM monitor with a real duration", async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch;

    await chatCompletion({ messages: MESSAGES });

    const [outcome] = llmOutcomeSnapshot().outcomes;
    expect(outcome).toMatchObject({ provider: "google", ok: true, status: 200 });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.error).toBeUndefined();
  });

  it("replays Gemini's thought_signature for the google tier", async () => {
    const fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    await chatCompletion({ messages: REPLAY_MESSAGES() });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.messages[1].tool_calls[0].extra_content).toEqual({
      google: { thought_signature: "sig-abc" },
    });
  });

  it("strips provider extras and repairs malformed arguments for non-google tiers", async () => {
    delete process.env.GOOGLE_AI_API_KEYS;
    process.env.OPENAI_API_KEY = "groq-test-key";
    process.env.OPENAI_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.MODEL_NAME = "qwen-test";

    const messages = REPLAY_MESSAGES();
    const replayedCall = messages[1].tool_calls![0]!;
    replayedCall.function.arguments = '{"symbol":"BT'; // truncated

    const fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    await chatCompletion({ messages });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const replayed = body.messages[1].tool_calls[0];
    // Groq rejects the whole request when arguments are not valid JSON, and
    // rejects unknown fields inside tool_calls.
    expect(replayed.function.arguments).toBe("{}");
    expect(replayed.extra_content).toBeUndefined();
  });

  it("retries HTTP 429 and succeeds on the next attempt", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(transientResponse(429))
      .mockResolvedValueOnce(okResponse("after retry"));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await chatCompletion({ messages: MESSAGES });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.message.content).toBe("after retry");
  });

  it("retries HTTP 503 twice (default budget) and then gives up on the tier", async () => {
    const fetchMock = jest.fn().mockResolvedValue(transientResponse(503));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await chatCompletion({ messages: MESSAGES });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toBeNull();
  });

  it("honours LLM_MAX_RETRIES=0 (single attempt, no retry)", async () => {
    process.env.LLM_MAX_RETRIES = "0";
    const fetchMock = jest.fn().mockResolvedValue(transientResponse(503));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await chatCompletion({ messages: MESSAGES });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("does not retry a non-transient status such as 401", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await chatCompletion({ messages: MESSAGES });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it("calls onReset when the provider dies mid-stream, before falling back", async () => {
    const stream = sseStream(
      ['data: {"choices":[{"delta":{"content":"partial answer"}}]}\n\n'],
      new Error("connection reset")
    );
    global.fetch = jest.fn().mockResolvedValue(new Response(stream)) as unknown as typeof fetch;

    const events: string[] = [];
    const result = await chatCompletionStream(
      { messages: MESSAGES },
      {
        onContentDelta: (text) => events.push(`delta:${text}`),
        onToolCallDelta: () => events.push("tool"),
        onReset: () => events.push("reset"),
      }
    );

    // The delta was already forwarded, so the caller must be told to drop it.
    expect(events).toEqual(["delta:partial answer", "reset"]);
    expect(result).toBeNull(); // single-provider chain exhausted

    const [outcome] = llmOutcomeSnapshot().outcomes;
    expect(outcome).toMatchObject({ provider: "google", ok: false, status: 0 });
  });

  it("does not call onReset when the stream fails before emitting anything", async () => {
    const stream = sseStream([], new Error("connection reset"));
    global.fetch = jest.fn().mockResolvedValue(new Response(stream)) as unknown as typeof fetch;

    const resets: string[] = [];
    const result = await chatCompletionStream(
      { messages: MESSAGES },
      {
        onContentDelta: () => undefined,
        onToolCallDelta: () => undefined,
        onReset: () => resets.push("reset"),
      }
    );

    expect(resets).toHaveLength(0);
    expect(result).toBeNull();
  });

  it("reports a successful stream to the monitor (used to be silent)", async () => {
    const stream = sseStream(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\n']);
    global.fetch = jest.fn().mockResolvedValue(new Response(stream)) as unknown as typeof fetch;

    const deltas: string[] = [];
    const result = await chatCompletionStream(
      { messages: MESSAGES },
      { onContentDelta: (text) => deltas.push(text), onToolCallDelta: () => undefined }
    );

    expect(deltas).toEqual(["hi"]);
    expect(result).toEqual({ provider: "google" });

    const [outcome] = llmOutcomeSnapshot().outcomes;
    expect(outcome).toMatchObject({ provider: "google", ok: true, status: 200 });
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
  });
});
