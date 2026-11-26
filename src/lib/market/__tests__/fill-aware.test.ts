// Fill-aware: TP/SL chỉ được chấm sau khi giá thực sự vào vùng entry. Trước đây
// nến chạm TP khi chưa hồi về entry vẫn bị tính là thắng, làm hit-rate lạc quan.

import type { KlineData } from "@/lib/collectors/binance";
import { evaluateHorizon, type RadarSignalRecord } from "@/lib/market/ledger";
import { buildSetup } from "@/lib/market/setup";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const { riskRewardRatio: _rr, ...setup } = buildSetup("BULLISH", 100, 2, "swing4h");

function signal(): RadarSignalRecord {
  return {
    symbol: "BREV",
    side: "gainer",
    bias: "continuation",
    score: 72,
    entryQuality: 55,
    price: 100,
    at: new Date(NOW - 2 * HOUR).toISOString(),
    regime: "risk-on",
    setupPreset: "swing4h",
    invalidationPrice: 96,
    invalidationNote: "đóng 1h dưới EMA20",
    btcPrice: 90_000,
    setup,
    actionable: true,
  };
}

function candle(openTime: number, high: number, low: number, close: number): KlineData {
  return {
    openTime,
    open: String(close),
    high: String(high),
    low: String(low),
    close: String(close),
    volume: "100",
    closeTime: openTime + HOUR - 1,
    quoteVolume: "10000",
  };
}

const BTC = [candle(NOW - 2 * HOUR, 90_100, 89_900, 90_000)];

describe("evaluateHorizon — fill-aware", () => {
  it("chạm TP trước khi vào vùng entry → không tính thắng, entryFilled false", () => {
    const result = evaluateHorizon(
      signal(),
      [candle(NOW - 2 * HOUR, 106, 105, 105.5)],
      BTC,
      "1h",
      NOW
    );
    expect(result.entryFilled).toBe(false);
    expect(result.tp1Hit).toBeNull();
    expect(result.slHit).toBeNull();
    expect(result.win).toBeNull();
    expect(result.pending).toBe(false);
  });

  it("vào vùng entry rồi chạm TP → tính thắng", () => {
    const result = evaluateHorizon(
      signal(),
      [candle(NOW - 2 * HOUR, 106, 99, 105.5)],
      BTC,
      "1h",
      NOW
    );
    expect(result.entryFilled).toBe(true);
    expect(result.tp1Hit).toBe(true);
    expect(result.slHit).toBe(false);
    expect(result.win).toBe(true);
  });

  it("vào vùng entry rồi thủng SL → tính thua", () => {
    const result = evaluateHorizon(
      signal(),
      [candle(NOW - 2 * HOUR, 101, 95, 95.5)],
      BTC,
      "1h",
      NOW
    );
    expect(result.entryFilled).toBe(true);
    expect(result.slHit).toBe(true);
    expect(result.tp1Hit).toBe(false);
    expect(result.win).toBe(false);
  });
});
