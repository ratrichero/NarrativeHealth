// Streaming tool-call accumulation: Gemini sends a whole call per delta with
// no index (and a thought_signature), Groq sends index + argument fragments.
// Merging both shapes by index alone produced invalid JSON on replay.

import {
  accumulateToolCallDeltas,
  normalizeToolArguments,
  type ToolCallAccum,
} from "../tool-call-accum";

const fresh = () => new Map<number, ToolCallAccum>();

describe("accumulateToolCallDeltas", () => {
  it("keeps two Gemini calls (same delta, no index) separate", () => {
    const accums = fresh();

    // Shape observed from the live Gemini OpenAI-compatible stream.
    accumulateToolCallDeltas(accums, [
      { id: "call_a", name: "get_live_price", argsDelta: '{"symbol":"BTC"}' },
      { id: "call_b", name: "get_narrative_health", argsDelta: '{"name":"AI"}' },
    ]);

    expect([...accums.values()]).toEqual([
      { id: "call_a", name: "get_live_price", args: '{"symbol":"BTC"}', extraContent: undefined },
      { id: "call_b", name: "get_narrative_health", args: '{"name":"AI"}', extraContent: undefined },
    ]);
    // Each call keeps its own valid JSON — the old merge produced invalid JSON.
    for (const acc of accums.values()) expect(() => JSON.parse(acc.args)).not.toThrow();
  });

  it("appends argument fragments that carry an index (Groq shape)", () => {
    const accums = fresh();

    accumulateToolCallDeltas(accums, [
      { index: 0, id: "call_1", name: "get_klines", argsDelta: '{"sym' },
    ]);
    accumulateToolCallDeltas(accums, [{ index: 0, argsDelta: 'bol":"ETH"}' }]);

    expect([...accums.values()]).toEqual([
      { id: "call_1", name: "get_klines", args: '{"symbol":"ETH"}', extraContent: undefined },
    ]);
  });

  it("appends id-less continuations to the latest call", () => {
    const accums = fresh();

    accumulateToolCallDeltas(accums, [
      { id: "call_x", name: "get_time", argsDelta: '{"city":' },
      { id: "call_y", name: "get_time", argsDelta: '{"city":' },
    ]);
    accumulateToolCallDeltas(accums, [{ argsDelta: '"Tokyo"}' }]);

    expect([...accums.values()][1]).toMatchObject({ id: "call_y", args: '{"city":"Tokyo"}' });
    expect([...accums.values()][0]).toMatchObject({ id: "call_x", args: '{"city":' });
  });

  it("captures extra_content so Gemini's signature survives the round trip", () => {
    const accums = fresh();
    const extraContent = { google: { thought_signature: "sig-123" } };

    accumulateToolCallDeltas(accums, [
      { id: "call_a", name: "get_time", argsDelta: "{}", extraContent },
    ]);

    expect([...accums.values()][0].extraContent).toEqual(extraContent);
  });
});

describe("normalizeToolArguments", () => {
  it("keeps valid JSON untouched", () => {
    expect(normalizeToolArguments('{"symbol":"BTC"}')).toEqual({
      json: '{"symbol":"BTC"}',
      malformed: false,
    });
  });

  it("replaces truncated JSON with {} and flags it", () => {
    expect(normalizeToolArguments('{"city":"Tok')).toEqual({ json: "{}", malformed: true });
  });

  it("treats empty arguments as {}", () => {
    expect(normalizeToolArguments("")).toEqual({ json: "{}", malformed: false });
  });
});
