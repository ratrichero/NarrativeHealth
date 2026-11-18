// LLM-BREAKER-01 — persisted circuit breaker.

import {
  BREAKER_FAILS_TO_OPEN,
  _resetLlmBreakers,
  breakerSnapshot,
  isBreakerOpen,
  noteTierFailure,
  noteTierSuccess,
  resetLlmBreakers,
} from "../breaker";

const KEY = "test-key-abcd1234";

describe("circuit breaker", () => {
  beforeEach(() => _resetLlmBreakers());

  it("opens after consecutive provider failures", () => {
    for (let i = 0; i < BREAKER_FAILS_TO_OPEN; i++) {
      noteTierFailure("primary", KEY, "capacity");
    }
    expect(isBreakerOpen("primary", KEY)).toBe(true);
    expect(breakerSnapshot()).toHaveLength(1);
    expect(breakerSnapshot()[0]).toMatchObject({ tier: "primary", reason: "capacity" });
  });

  it("does not open on our own payload errors", () => {
    for (let i = 0; i < 5; i++) noteTierFailure("primary", KEY, "request_invalid");
    expect(isBreakerOpen("primary", KEY)).toBe(false);
  });

  it("closes on a success", () => {
    for (let i = 0; i < BREAKER_FAILS_TO_OPEN; i++) noteTierFailure("google", KEY, "auth");
    expect(isBreakerOpen("google", KEY)).toBe(true);
    noteTierSuccess("google", KEY);
    expect(isBreakerOpen("google", KEY)).toBe(false);
  });

  it("expires with the cooldown", () => {
    for (let i = 0; i < BREAKER_FAILS_TO_OPEN; i++) noteTierFailure("fallback1", KEY, "transport");
    const until = new Date(breakerSnapshot()[0].until).getTime();
    expect(isBreakerOpen("fallback1", KEY, until - 1)).toBe(true);
    expect(isBreakerOpen("fallback1", KEY, until + 1)).toBe(false);
  });

  it("keeps keys of the same tier independent", () => {
    for (let i = 0; i < BREAKER_FAILS_TO_OPEN; i++) noteTierFailure("google", KEY, "auth");
    expect(isBreakerOpen("google", `${KEY}zzzz`)).toBe(false);
  });

  it("resets by tier and clears the snapshot", async () => {
    for (let i = 0; i < BREAKER_FAILS_TO_OPEN; i++) noteTierFailure("primary", KEY, "capacity");
    await expect(resetLlmBreakers("primary")).resolves.toBe(1);
    expect(breakerSnapshot()).toHaveLength(0);
  });
});
