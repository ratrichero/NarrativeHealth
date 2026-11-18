// LLM-TRACE-01 — per-turn trace records.

import {
  _resetLlmTraces,
  getLlmTrace,
  newTraceId,
  recentLlmTraces,
  startLlmTrace,
  traceRef,
} from "../trace";

describe("turn traces", () => {
  beforeEach(() => _resetLlmTraces());

  it("collects steps and finishes with metadata only", async () => {
    const trace = startLlmTrace("chat", { sessionId: "session-a" });
    trace.step({ tier: "google", model: "gemini", status: 429, kind: "rate_limit", ms: 120.4 });
    trace.step({ tier: "primary", status: 200, ms: 400, tokens: 321 });
    const record = trace.finish({ ok: true, provider: "primary" });

    expect(record.id).toBe(trace.id);
    expect(record.steps).toHaveLength(2);
    expect(record.steps[0].ms).toBe(120);
    expect(record.steps[1].tokens).toBe(321);
    expect(record.sessionId).toBe("session-a");
    expect(record.ok).toBe(true);
    expect(record.provider).toBe("primary");
    expect(record).not.toHaveProperty("prompt");
  });

  it("makes the finished trace retrievable by id (newest first)", async () => {
    const first = startLlmTrace("chat");
    first.finish({ ok: false, error: "all providers failed" });
    const second = startLlmTrace("square");
    second.finish({ ok: true, provider: "google" });

    const recent = await recentLlmTraces(5);
    expect(recent.map((trace) => trace.id)).toEqual([second.id, first.id]);
    expect((await getLlmTrace(first.id))?.error).toBe("all providers failed");
    expect(await getLlmTrace("missing")).toBeNull();
  });

  it("caps the in-memory ring", async () => {
    for (let i = 0; i < 50; i++) startLlmTrace("chat").finish({ ok: true });
    expect((await recentLlmTraces(100)).length).toBeLessThanOrEqual(40);
  });

  it("appends the trace id to user-facing errors", () => {
    const trace = startLlmTrace("chat");
    expect(traceRef(trace)).toContain(trace.id);
    expect(traceRef(undefined)).toBe("");
  });

  it("generates unique ids", () => {
    expect(newTraceId()).not.toBe(newTraceId());
  });
});
