import { SlidingWindowLimiter, clientIpFromHeaders } from "@/lib/market/rate-limit";
import { nextQuotaState } from "@/lib/market/brief-quota";

describe("SlidingWindowLimiter", () => {
  it("cho phép đúng số request trong cửa sổ rồi trả retry-after", () => {
    const limiter = new SlidingWindowLimiter(2, 60_000);
    expect(limiter.check("ip", 0).allowed).toBe(true);
    expect(limiter.check("ip", 1_000).allowed).toBe(true);

    const blocked = limiter.check("ip", 2_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(58);
    expect(blocked.remaining).toBe(0);
  });

  it("cửa sổ trượt: request cũ hết hạn thì được phép lại", () => {
    const limiter = new SlidingWindowLimiter(1, 10_000);
    expect(limiter.check("ip", 0).allowed).toBe(true);
    expect(limiter.check("ip", 5_000).allowed).toBe(false);
    expect(limiter.check("ip", 10_001).allowed).toBe(true);
  });

  it("tách key theo IP", () => {
    const limiter = new SlidingWindowLimiter(1, 60_000);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  afterEach(() => {
    delete process.env.RADAR_TRUST_XFF;
  });

  it("KHÔNG tin X-Forwarded-For do client gửi", () => {
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" });
    expect(clientIpFromHeaders(headers)).toBe("unknown");
  });

  it("dùng header do edge ghi đè: cf-connecting-ip rồi x-real-ip", () => {
    expect(clientIpFromHeaders(new Headers({ "cf-connecting-ip": "7.7.7.7" }))).toBe("7.7.7.7");
    expect(
      clientIpFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9", "x-real-ip": "5.6.7.8" }))
    ).toBe("5.6.7.8");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("chỉ đọc XFF khi opt-in, và lấy hop phải nhất", () => {
    process.env.RADAR_TRUST_XFF = "1";
    const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 2.2.2.2" });
    expect(clientIpFromHeaders(headers)).toBe("2.2.2.2");
  });
});

describe("nextQuotaState", () => {
  it("tăng used và chặn khi chạm trần", () => {
    const first = nextQuotaState(null, 2, "2026-01-01");
    expect(first.allowed).toBe(true);
    expect(first.used).toBe(1);

    const second = nextQuotaState({ date: "2026-01-01", used: 1 }, 2, "2026-01-01");
    expect(second.allowed).toBe(true);
    expect(second.used).toBe(2);

    const blocked = nextQuotaState({ date: "2026-01-01", used: 2 }, 2, "2026-01-01");
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("sang ngày mới thì reset", () => {
    const reset = nextQuotaState({ date: "2026-01-01", used: 2 }, 2, "2026-01-02");
    expect(reset.allowed).toBe(true);
    expect(reset.used).toBe(1);
  });

  it("limit <= 0 là không giới hạn", () => {
    const unlimited = nextQuotaState({ date: "2026-01-01", used: 999 }, 0, "2026-01-01");
    expect(unlimited.allowed).toBe(true);
    expect(unlimited.used).toBe(999);
  });
});
