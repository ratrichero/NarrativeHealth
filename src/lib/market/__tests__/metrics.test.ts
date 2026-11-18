import type { KlineData } from "@/lib/collectors/binance";
import {
  atrPctLast,
  computeMarketMetrics,
  emaLast,
  rangePosition,
  rsiLast,
  volumeStats,
} from "@/lib/market/metrics";

function candle(close: number, quoteVolume: number, high = close + 1, low = close - 1): KlineData {
  return {
    openTime: 0,
    open: String(close),
    high: String(high),
    low: String(low),
    close: String(close),
    volume: "1",
    closeTime: 0,
    quoteVolume: String(quoteVolume),
  };
}

describe("market metrics", () => {
  it("tính EMA đúng chiều và trả null khi thiếu dữ liệu", () => {
    const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
    const ema20 = emaLast(rising, 20);
    const ema50 = emaLast(rising, 50);
    expect(ema20).not.toBeNull();
    expect(ema50).not.toBeNull();
    expect(ema20!).toBeGreaterThan(ema50!);
    expect(emaLast([1, 2, 3], 20)).toBeNull();
  });

  it("RSI = 100 khi toàn nến tăng, thấp khi toàn nến giảm", () => {
    const up = Array.from({ length: 20 }, (_, i) => 100 + i);
    const down = Array.from({ length: 20 }, (_, i) => 200 - i);
    expect(rsiLast(up)).toBe(100);
    expect(rsiLast(down)).toBeLessThan(5);
  });

  it("ATR% tính từ true range của nến đã đóng", () => {
    const candles = Array.from({ length: 20 }, () => candle(100, 1_000_000, 101, 99));
    const atr = atrPctLast(candles, 14);
    expect(atr).not.toBeNull();
    expect(atr!).toBeCloseTo(2, 1); // TR = 2 trên giá 100
  });

  it("volume ratio và z-score so với baseline nến đã đóng", () => {
    const volumes = Array.from({ length: 29 }, (_, i) => 900_000 + (i % 5) * 50_000);
    const candles = [...volumes.map((v) => candle(100, v)), candle(100, 3_000_000)];
    const stats = volumeStats(candles, 3_000_000);
    expect(stats.ratio7d).toBeGreaterThan(2.5);
    expect(stats.z).toBeGreaterThan(1);
  });

  it("rangePosition kẹp trong 0..1", () => {
    expect(rangePosition(175, 100, 200)).toBeCloseTo(0.75);
    expect(rangePosition(50, 100, 200)).toBe(0);
    expect(rangePosition(250, 100, 200)).toBe(1);
  });

  it("computeMarketMetrics ráp đủ trường và tính OI change", () => {
    const daily = [
      ...Array.from({ length: 29 }, (_, i) =>
        candle(100 + i, 1_000_000 + i * 10_000, 101 + i, 99 + i)
      ),
      candle(130, 3_000_000, 131, 129),
    ];
    const h4 = Array.from({ length: 80 }, (_, i) => candle(100 + i, 100_000, 101 + i, 99 + i));

    const metrics = computeMarketMetrics({
      price: 130,
      changePct: 12,
      quoteVolume: 3_000_000,
      trades: 1200,
      high24h: 135,
      low24h: 110,
      dailyCandles: daily,
      h4Candles: h4,
      fundingRate: 0.0004,
      oiHistory: [
        { timestamp: 1, openInterest: 1000 },
        { timestamp: 2, openInterest: 1200 },
      ],
      listingAgeDays: 120,
    });

    expect(metrics.rangePosition).toBeCloseTo(0.8);
    expect(metrics.oiChangePct).toBeCloseTo(20);
    expect(metrics.atrPct).not.toBeNull();
    expect(metrics.changeAtrMultiple).not.toBeNull();
    expect(metrics.ema20!).toBeGreaterThan(metrics.ema50!);
    expect(metrics.isBreakout7d).toBe(true);
    expect(metrics.volumeRatio7d).toBeGreaterThan(1);
    expect(metrics.fundingRate).toBe(0.0004);
  });
});
