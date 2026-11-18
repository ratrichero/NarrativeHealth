// CHAT-QUOTA-01 — per-session daily budget.

import { _resetChatQuota, chatQuotaFor, chatQuotaLimits, recordChatQuota } from "../quota";

describe("chat quota", () => {
  const original = { ...process.env };

  beforeEach(() => {
    _resetChatQuota();
    process.env.CHAT_TURNS_PER_DAY = "10";
    process.env.CHAT_TOKENS_PER_DAY = "100000";
    process.env.CHAT_QUOTA_SOFT_PCT = "80";
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("starts ok with tools enabled", () => {
    const quota = chatQuotaFor("session-a");
    expect(quota.state).toBe("ok");
    expect(quota.toolsAllowed).toBe(true);
    expect(chatQuotaLimits()).toMatchObject({ turnsPerDay: 10, softPct: 80 });
  });

  it("softens at 80% (short answer, no tools), then refuses at the cap", () => {
    for (let i = 0; i < 8; i++) recordChatQuota("session-a", { tokens: 100 });
    const soft = chatQuotaFor("session-a");
    expect(soft.state).toBe("soft");
    expect(soft.toolsAllowed).toBe(false);
    expect(soft.maxTokens).toBe(400);

    recordChatQuota("session-a", { tokens: 100 });
    recordChatQuota("session-a", { tokens: 100 });
    const hard = chatQuotaFor("session-a");
    expect(hard.state).toBe("hard");
    expect(hard.reason).toContain("hạn mức");
  });

  it("counts tokens as well as turns", () => {
    recordChatQuota("session-b", { tokens: 99_000 });
    expect(chatQuotaFor("session-b").state).toBe("soft");
    recordChatQuota("session-b", { tokens: 2_000 });
    expect(chatQuotaFor("session-b").state).toBe("hard");
  });

  it("keeps sessions independent", () => {
    for (let i = 0; i < 10; i++) recordChatQuota("session-a", {});
    expect(chatQuotaFor("session-a").state).toBe("hard");
    expect(chatQuotaFor("session-c").state).toBe("ok");
  });

  it("resets the counter on a new day", () => {
    const tomorrow = Date.now() + 86_400_000;
    recordChatQuota("session-a", { tokens: 100 });
    expect(chatQuotaFor("session-a", tomorrow).turns).toBe(0);
  });
});
