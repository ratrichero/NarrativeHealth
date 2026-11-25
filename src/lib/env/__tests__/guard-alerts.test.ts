import {
  buildGuardBlockedMessage,
  claimGuardAlert,
  guardAlertCooldownMs,
  guardAlertKey,
  GUARD_ALERT_COOLDOWN_DEFAULT_MINUTES,
  GUARD_ALERT_COOLDOWN_VAR,
} from "../guard-alerts";
import type { GuardDecision } from "../runtime-guard";

function decision(overrides: Partial<GuardDecision> = {}): GuardDecision {
  return {
    allowed: false,
    code: "HOST_ALLOWLIST_MISSING",
    message: "Scheduled jobs disabled — PRODUCTION_ALLOWED_HOSTS is empty.",
    hostname: "168.138.179.192",
    mode: "read-only",
    ...overrides,
  };
}

describe("guardAlertCooldownMs", () => {
  it("mặc định 60 phút khi env trống hoặc không hợp lệ", () => {
    expect(guardAlertCooldownMs({})).toBe(
      GUARD_ALERT_COOLDOWN_DEFAULT_MINUTES * 60_000
    );
    expect(guardAlertCooldownMs({ [GUARD_ALERT_COOLDOWN_VAR]: "abc" })).toBe(
      60 * 60_000
    );
  });

  it("đọc env và kẹp trong 1–1440 phút", () => {
    expect(guardAlertCooldownMs({ [GUARD_ALERT_COOLDOWN_VAR]: "15" })).toBe(
      15 * 60_000
    );
    expect(guardAlertCooldownMs({ [GUARD_ALERT_COOLDOWN_VAR]: "0" })).toBe(
      60_000
    );
    expect(guardAlertCooldownMs({ [GUARD_ALERT_COOLDOWN_VAR]: "9999" })).toBe(
      1440 * 60_000
    );
  });
});

describe("claimGuardAlert", () => {
  it("chặn cảnh báo lặp trong cooldown, cho lại sau khi hết", () => {
    const store = new Map<string, number>();
    const now = Date.parse("2026-11-23T00:00:00Z");

    expect(claimGuardAlert("HOST_NOT_ALLOWED|a", now, 60_000, store)).toBe(true);
    expect(claimGuardAlert("HOST_NOT_ALLOWED|a", now + 30_000, 60_000, store)).toBe(false);
    expect(claimGuardAlert("HOST_NOT_ALLOWED|a", now + 61_000, 60_000, store)).toBe(true);
  });

  it("host khác hoặc mã lỗi khác vẫn được báo", () => {
    const store = new Map<string, number>();
    const now = Date.now();

    expect(claimGuardAlert("HOST_NOT_ALLOWED|a", now, 60_000, store)).toBe(true);
    expect(claimGuardAlert("HOST_NOT_ALLOWED|b", now, 60_000, store)).toBe(true);
    expect(claimGuardAlert("HOST_ALLOWLIST_MISSING|a", now, 60_000, store)).toBe(true);
  });

  it("giới hạn kích thước store (evict key cũ nhất)", () => {
    const store = new Map<string, number>();
    for (let i = 0; i < 60; i += 1) {
      claimGuardAlert(`HOST_NOT_ALLOWED|host-${i}`, 1_000 + i, 0, store);
    }
    expect(store.size).toBeLessThanOrEqual(50);
    expect(store.has("HOST_NOT_ALLOWED|host-0")).toBe(false);
    expect(store.has("HOST_NOT_ALLOWED|host-59")).toBe(true);
  });
});

describe("nội dung cảnh báo", () => {
  it("key gồm mã lỗi + host", () => {
    expect(guardAlertKey(decision())).toBe("HOST_ALLOWLIST_MISSING|168.138.179.192");
    expect(guardAlertKey(decision({ hostname: null, code: undefined }))).toBe("READ_ONLY|-");
  });

  it("message nêu mã lỗi, host và checklist", () => {
    const text = buildGuardBlockedMessage(decision(), new Date("2026-11-23T03:00:00Z"));
    expect(text).toContain("HOST_ALLOWLIST_MISSING");
    expect(text).toContain("168.138.179.192");
    expect(text).toContain("PRODUCTION_ALLOWED_HOSTS");
    expect(text).toContain("docs/VPS_ENV_CHECKLIST.md");
    expect(text).toContain("2026-11-23T03:00:00.000Z");
  });
});
