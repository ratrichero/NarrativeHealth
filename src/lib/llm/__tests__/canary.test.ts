// LLM-CANARY-02 — a single timeout must not mark a tier dead.

import { _resetLlmCanary, canarySnapshot, runLlmCanary } from "../canary";
import { _resetLlmMonitor, llmTierStats } from "../monitor";
import { _resetLlmTelemetry } from "../telemetry";
import { _resetGoogleKeyPool } from "../google-key-pool";
import { isolateLlmEnv, type LlmTestEnv } from "./llm-env";

const realFetch = global.fetch;
let env: LlmTestEnv;

function okResponse(): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: "ok" } }] }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function timeoutError(): Error {
  const error = new Error("The operation was aborted due to timeout");
  error.name = "TimeoutError";
  return error;
}

beforeEach(() => {
  _resetGoogleKeyPool();
  _resetLlmMonitor();
  _resetLlmCanary();
  _resetLlmTelemetry();
  env = isolateLlmEnv("canary-test-key-9999");
  process.env.LLM_CANARY_RETRY_DELAY_MS = "1";
  process.env.LLM_CANARY_STAGGER_MS = "1";
});

afterEach(() => {
  global.fetch = realFetch;
  env.restore();
  for (const name of [
    "LLM_CANARY_TIMEOUT_MS",
    "LLM_CANARY_SKIP",
    "LLM_CANARY_PREFLIGHT",
    "LLM_CANARY_RETRY_DELAY_MS",
    "LLM_CANARY_STAGGER_MS",
  ]) {
    delete process.env[name];
  }
});

describe("canary probe policy", () => {
  it("retries a timeout once and reports the recovered probe as ok", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    const [result] = await runLlmCanary();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ provider: "google", ok: true });
    expect(result.degraded).toBe(false);
    expect(result.consecutiveMisses).toBe(0);
  });

  it("treats one failed sweep as degraded and the next as a real failure", async () => {
    global.fetch = jest.fn().mockRejectedValue(timeoutError()) as unknown as typeof fetch;

    const [first] = await runLlmCanary();
    expect(first.ok).toBe(false);
    expect(first.degraded).toBe(true);
    expect(first.kind).toBe("timeout");
    expect(first.consecutiveMisses).toBe(1);

    const statsAfterDegraded = llmTierStats();
    expect(statsAfterDegraded[0]).toMatchObject({ calls: 1, ok: 1, fail: 0, degraded: 1 });

    const [second] = await runLlmCanary();
    expect(second.ok).toBe(false);
    expect(second.degraded).toBe(false);
    expect(second.consecutiveMisses).toBe(2);

    const statsAfterFail = llmTierStats();
    expect(statsAfterFail[0]).toMatchObject({ calls: 2, ok: 1, fail: 1, degraded: 1 });
  });

  it("resets the miss streak after a successful sweep", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    await runLlmCanary(); // degraded (1 miss)
    const [recovered] = await runLlmCanary(); // ok (default mock) → streak reset
    expect(recovered.ok).toBe(true);
    expect(recovered.consecutiveMisses).toBe(0);

    const afterRecovery = await runLlmCanary();
    expect(afterRecovery[0]).toMatchObject({ ok: true, consecutiveMisses: 0 });
  });

  it("fails an auth error immediately, without a retry", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), { status: 401 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const [result] = await runLlmCanary();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, degraded: false, status: 401, consecutiveMisses: 1 });
    expect(result.kind).toBe("auth");
  });

  it("skips tiers listed in LLM_CANARY_SKIP", async () => {
    process.env.LLM_CANARY_SKIP = "google";
    const fetchMock = jest.fn().mockResolvedValue(okResponse());
    global.fetch = fetchMock as unknown as typeof fetch;

    expect(await runLlmCanary()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades instead of spending a token when the preflight fails", async () => {
    process.env.LLM_CANARY_PREFLIGHT = "1";
    const fetchMock = jest.fn().mockRejectedValue(timeoutError());
    global.fetch = fetchMock as unknown as typeof fetch;

    const [result] = await runLlmCanary();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/models");
    expect(result).toMatchObject({ ok: false, degraded: true, consecutiveMisses: 1 });
  });

  it("records probes in the snapshot history", async () => {
    global.fetch = jest.fn().mockResolvedValue(okResponse()) as unknown as typeof fetch;
    await runLlmCanary();
    const snapshot = canarySnapshot();
    expect(snapshot.running).toBe(false);
    expect(snapshot.last).toHaveLength(1);
    expect(snapshot.last[0].ok).toBe(true);
  });
});
