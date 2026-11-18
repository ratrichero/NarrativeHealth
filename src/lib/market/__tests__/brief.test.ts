import {
  BriefQuotaExceededError,
  getMoverBrief,
  resetBriefCache,
} from "@/lib/market/brief";
import type { RadarDetail } from "@/lib/market/radar";

function detail(): RadarDetail {
  const row = {
    symbol: "ALT",
    pair: "ALTUSDT",
    price: 0.42,
    changePct: 1.8,
    quoteVolume: 46_000_000,
    trades: 20_000,
    high24h: 0.45,
    low24h: 0.4,
    rangePosition: 0.55,
    distanceFromHighPct: 4,
    volumeRatio7d: 3.2,
    volumeZ: 4.4,
    atrPct: 3.2,
    changeAtrMultiple: 0.56,
    rsi14: 52,
    fundingRate: 0.00005,
    oiChangePct: 12,
    listingAgeDays: 180,
    isBreakout7d: false,
    rangePct7d: 8,
    high7d: 0.43,
    inSystem: true,
    narratives: ["Restaking"],
    bias: "accumulation",
    label: "Tích lũy sớm",
    score: 74,
    entryQuality: 88,
    composite: 80,
    reasons: ["Volume 3.2× TB 7 ngày"],
    warnings: [],
  };
  return {
    row,
    setup: null,
    chart: [],
    asOf: new Date().toISOString(),
  } as unknown as RadarDetail;
}

function deps(quotaAllowed = true) {
  const getDetail = jest.fn().mockResolvedValue(detail());
  const complete = jest.fn().mockResolvedValue({
    provider: "fake",
    message: { role: "assistant", content: "Brief ngắn" },
  });
  const consumeQuota = jest.fn().mockResolvedValue(
    quotaAllowed
      ? { allowed: true, used: 1, limit: 200, date: "2026-01-01", remaining: 199 }
      : { allowed: false, used: 200, limit: 200, date: "2026-01-01", remaining: 0 }
  );
  return { getDetail, complete, consumeQuota };
}

beforeEach(() => {
  resetBriefCache();
  delete process.env.RADAR_LLM_ENABLED;
});

describe("getMoverBrief quota", () => {
  it("không trừ quota khi symbol không tồn tại", async () => {
    const d = deps();
    d.getDetail.mockResolvedValue(null);
    const result = await getMoverBrief("NOPE", d);
    expect(result).toBeNull();
    expect(d.consumeQuota).not.toHaveBeenCalled();
    expect(d.complete).not.toHaveBeenCalled();
  });

  it("chỉ trừ quota đúng một lần khi thực sự gọi LLM", async () => {
    const d = deps();
    const first = await getMoverBrief("ALT", d);
    expect(first?.cached).toBe(false);
    expect(d.consumeQuota).toHaveBeenCalledTimes(1);
    expect(d.complete).toHaveBeenCalledTimes(1);

    const second = await getMoverBrief("ALT", d);
    expect(second?.cached).toBe(true);
    expect(d.consumeQuota).toHaveBeenCalledTimes(1);
    expect(d.complete).toHaveBeenCalledTimes(1);
  });

  it("cache hit không fetch detail và không tiêu quota", async () => {
    const d = deps();
    await getMoverBrief("ALT", d);
    d.getDetail.mockClear();
    await getMoverBrief("$ALTUSDT", d);
    expect(d.getDetail).not.toHaveBeenCalled();
    expect(d.consumeQuota).toHaveBeenCalledTimes(1);
  });

  it("quota hết thì throw trước khi gọi LLM", async () => {
    const d = deps(false);
    await expect(getMoverBrief("ALT", d)).rejects.toBeInstanceOf(BriefQuotaExceededError);
    expect(d.consumeQuota).toHaveBeenCalledTimes(1);
    expect(d.complete).not.toHaveBeenCalled();
  });

  it("LLM disabled thì không trừ quota", async () => {
    process.env.RADAR_LLM_ENABLED = "0";
    const d = deps();
    await expect(getMoverBrief("ALT", d)).rejects.toThrow(/đang tắt/);
    expect(d.consumeQuota).not.toHaveBeenCalled();
  });
});
