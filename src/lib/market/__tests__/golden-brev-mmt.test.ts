// Golden fixture cho 2 ca thật đã rà: BREV (continuation khi đã quá xa) và MMT
// (exhaustion chỉ với một phiếu OI). Mỗi lần chỉnh scoring phải chạy lại file
// này để không tái sinh đúng hai lỗi cũ.

import type { MarketMetrics } from "@/lib/market/metrics";
import { chaseRiskOf, exhaustionCheck, invalidationFor, scoreGainer } from "@/lib/market/scoring";

const base: MarketMetrics = {
  price: 100,
  changePct: 6,
  quoteVolume: 80_000_000,
  trades: 20_000,
  high24h: 101,
  low24h: 94,
  rangePosition: 0.85,
  distanceFromHighPct: 1,
  volumeRatio7d: 2.5,
  volumeZ: 2,
  atrPct: 3,
  atrPct4h: 1.5,
  changeAtrMultiple: 2,
  ema20: 102,
  ema50: 96,
  ema20_1h: 99,
  rsi14: 68,
  high7d: 99,
  low7d: 86,
  rangePct7d: 15,
  isBreakout7d: true,
  distanceFrom7dHighPct: -1,
  fundingRate: 0.0002,
  oiChangePct: 4,
  longShortRatio: 1.1,
  listingAgeDays: 120,
  impulseAgeHours: 3,
  impulseExtensionAtr: 1.8,
};

function metrics(overrides: Partial<MarketMetrics>): MarketMetrics {
  return { ...base, ...overrides };
}

describe("BREV — không đuổi giá và mốc vô hiệu có khoảng cách thật", () => {
  const brev = metrics({
    price: 100,
    changePct: 8.7,
    atrPct: 2.5,
    atrPct4h: 1.4,
    changeAtrMultiple: 3.48,
    rangePosition: 0.97,
    distanceFromHighPct: 0.2,
    impulseAgeHours: 2,
    impulseExtensionAtr: 2.6,
    ema20_1h: 99.6,
    fundingRate: 0.0006,
    rsi14: 74,
  });

  it("gắn cờ không đuổi giá khi impulse đã đi ≥2.5 ATR", () => {
    expect(chaseRiskOf(brev)).toBe(true);
    expect(scoreGainer(brev).chaseRisk).toBe(true);
    expect(scoreGainer(brev).entryQuality).toBeLessThan(60);
  });

  it("mọi mốc vô hiệu cách giá tối thiểu 0.5 ATR 4h", () => {
    for (const bias of ["continuation", "breakout", "accumulation", "exhaustion"] as const) {
      const { invalidationPrice } = invalidationFor(bias, brev);
      expect(invalidationPrice).not.toBeNull();
      const distance = Math.abs(invalidationPrice! - brev.price);
      expect(distance).toBeGreaterThanOrEqual((brev.price * (brev.atrPct4h ?? 0)) / 100 / 2 - 1e-6);
    }
  });

  it("exhaustion khi giá đang ở đỉnh vẫn có mốc vô hiệu phía trên, không phải 0%", () => {
    const { invalidationPrice } = invalidationFor("exhaustion", brev);
    expect(invalidationPrice!).toBeGreaterThan(brev.price);
  });
});

describe("MMT — exhaustion cần ≥2 phiếu", () => {
  const oneVote = metrics({
    price: 100,
    changePct: 23,
    atrPct: 4,
    atrPct4h: 2.2,
    changeAtrMultiple: 5.75,
    rangePosition: 0.99,
    distanceFromHighPct: 0.3,
    // Giá vẫn trên EMA20 1h → chỉ OI giảm là phiếu duy nhất.
    ema20_1h: 99.5,
    oiChangePct: -2.5,
    rsi14: 81,
    impulseExtensionAtr: 4.2,
  });

  it("chỉ OI giảm (1 phiếu) chưa gọi kiệt sức", () => {
    const check = exhaustionCheck(oneVote);
    expect(check.votes).toBe(1);
    expect(check.confirmed).toBe(false);
    expect(scoreGainer(oneVote).bias).not.toBe("exhaustion");
  });

  it("OI giảm + mất EMA20 1h (2 phiếu) mới gọi kiệt sức", () => {
    const twoVotes = { ...oneVote, ema20_1h: 100.8 };
    const check = exhaustionCheck(twoVotes);
    expect(check.votes).toBe(2);
    expect(check.confirmed).toBe(true);
    expect(scoreGainer(twoVotes).bias).toBe("exhaustion");
  });
});
