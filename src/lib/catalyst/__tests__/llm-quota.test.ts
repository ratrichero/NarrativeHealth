// RADAR-06 — trần LLM/ngày: reset theo ngày UTC, 0 = không giới hạn.
import {
  catalystLlmDailyLimit,
  nextCatalystLlmQuotaState,
} from "@/lib/catalyst/llm-quota";

const DATE = "2026-11-18";

describe("nextCatalystLlmQuotaState", () => {
  it("dưới trần thì cho qua và tăng used", () => {
    expect(nextCatalystLlmQuotaState({ date: DATE, used: 10 }, 200, DATE)).toEqual({
      allowed: true,
      used: 11,
      limit: 200,
      date: DATE,
      remaining: 189,
    });
  });

  it("chạm đúng trần thì chặn (không vượt)", () => {
    const decision = nextCatalystLlmQuotaState({ date: DATE, used: 200 }, 200, DATE);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("limit");
    expect(decision.remaining).toBe(0);
  });

  it("sang ngày mới thì reset về 0 trước khi tăng", () => {
    expect(nextCatalystLlmQuotaState({ date: "2026-11-17", used: 200 }, 200, DATE)).toMatchObject({
      allowed: true,
      used: 1,
    });
  });

  it("chưa có state hoặc state hỏng → bắt đầu từ 0", () => {
    expect(nextCatalystLlmQuotaState(null, 200, DATE).used).toBe(1);
    expect(nextCatalystLlmQuotaState({ date: DATE, used: "x" }, 200, DATE).used).toBe(1);
    expect(nextCatalystLlmQuotaState({ date: DATE, used: -5 }, 200, DATE).used).toBe(1);
  });

  it("limit 0 = không giới hạn", () => {
    const decision = nextCatalystLlmQuotaState({ date: DATE, used: 9_999 }, 0, DATE);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("catalystLlmDailyLimit", () => {
  const original = process.env.CATALYST_LLM_DAILY_LIMIT;

  afterEach(() => {
    if (original === undefined) delete process.env.CATALYST_LLM_DAILY_LIMIT;
    else process.env.CATALYST_LLM_DAILY_LIMIT = original;
  });

  it("mặc định 200, nhận số hợp lệ, giá trị lạ quay về mặc định", () => {
    delete process.env.CATALYST_LLM_DAILY_LIMIT;
    expect(catalystLlmDailyLimit()).toBe(200);

    process.env.CATALYST_LLM_DAILY_LIMIT = "50";
    expect(catalystLlmDailyLimit()).toBe(50);

    process.env.CATALYST_LLM_DAILY_LIMIT = "0";
    expect(catalystLlmDailyLimit()).toBe(0);

    process.env.CATALYST_LLM_DAILY_LIMIT = "abc";
    expect(catalystLlmDailyLimit()).toBe(200);
  });
});
