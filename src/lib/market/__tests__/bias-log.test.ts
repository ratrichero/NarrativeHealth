import type { RadarRow, RadarSnapshot } from "@/lib/market/radar";
import {
  BIAS_ENGINE_VERSION,
  buildBiasLogRows,
  dueHorizons,
} from "@/lib/market/bias-log";

// buildBiasLogRows/dueHorizons là hàm thuần — không cần DATABASE_URL cho test.
jest.mock("@/db", () => ({ db: {} }));

const AT = new Date("2026-11-19T02:00:00.000Z");

function row(overrides: Partial<RadarRow> = {}): RadarRow {
  return {
    symbol: "MMT",
    pair: "MMTUSDT",
    price: 0.24,
    changePct: 6.4,
    quoteVolume: 120_000_000,
    trades: 51_000,
    high24h: 0.25,
    low24h: 0.21,
    rangePosition: 0.75,
    distanceFromHighPct: 4,
    volumeRatio7d: 2.4,
    volumeZ: 3.1,
    atrPct: 2.2,
    changeAtrMultiple: 2.9,
    rsi14: 71,
    fundingRate: 0.0002,
    oiChangePct: 4.5,
    listingAgeDays: 30,
    isBreakout7d: false,
    rangePct7d: 18.5,
    high7d: 0.26,
    inSystem: false,
    narratives: [],
    bias: "continuation",
    label: "Tiếp diễn tăng",
    score: 62,
    entryQuality: 48,
    composite: 56,
    reasons: [],
    warnings: [],
    ...overrides,
  } as RadarRow;
}

function snapshot(rows: RadarRow[], regime: RadarSnapshot["market"]["regime"] = "risk-on"): RadarSnapshot {
  return {
    side: "gainer",
    rows,
    minVolume: 10_000_000,
    market: {
      gainers: 120,
      losers: 80,
      totalVolumeUsd: 1,
      btcChangePct: 1.2,
      btcPrice: 92_000,
      universe: 200,
      breadthPct: 60,
      btcTrend: "up",
      regime,
    },
    collectedAt: AT.toISOString(),
  };
}

describe("bias log", () => {
  it("map đủ feature đầu vào + bối cảnh cụm/thị trường", () => {
    const [entry] = buildBiasLogRows(
      [
        {
          side: "gainer",
          snapshot: snapshot([
            row({
              clusterId: "c-1",
              clusterLabel: "AI",
              clusterSize: 4,
              clusterLeader: true,
              clusterLaggard: false,
              ema20: 0.231,
              ema50: 0.218,
              distanceFrom7dHighPct: -1.4,
              spotLed: true,
              relativeStrengthPct: 5.2,
              catalystTriggered: true,
            }),
          ]),
        },
      ],
      AT
    );

    expect(entry).toMatchObject({
      loggedAt: AT,
      symbol: "MMT",
      side: "gainer",
      price: 0.24,
      bias: "continuation",
      prevBias: null,
      biasChanged: false,
      score: 62,
      entryQuality: 48,
      clusterId: "c-1",
      clusterLabel: "AI",
      clusterSize: 4,
      clusterLeader: true,
      btcPrice: 92_000,
      regime: "risk-on",
      changePct: 6.4,
      changeAtrMultiple: 2.9,
      fundingRate: 0.0002,
      oiChangePct: 4.5,
      rsi14: 71,
      ema20: 0.231,
      ema50: 0.218,
      volumeZ: 3.1,
      volumeRatio7d: 2.4,
      rangePosition: 0.75,
      rangePct7d: 18.5,
      distanceFromHighPct: 4,
      distanceFrom7dHighPct: -1.4,
      spotLed: true,
      relativeStrengthPct: 5.2,
      catalystTriggered: true,
      invalidationPrice: null,
      engineVersion: BIAS_ENGINE_VERSION,
    });
  });

  it("điền prevBias theo symbol+side và đánh dấu lật bias", () => {
    const prev = new Map([["MMT|gainer", "exhaustion"]]);
    const [entry] = buildBiasLogRows(
      [{ side: "gainer", snapshot: snapshot([row()]) }],
      AT,
      prev
    );
    expect(entry.prevBias).toBe("exhaustion");
    expect(entry.biasChanged).toBe(true);

    const [same] = buildBiasLogRows(
      [{ side: "gainer", snapshot: snapshot([row({ bias: "exhaustion" })]) }],
      AT,
      prev
    );
    expect(same.biasChanged).toBe(false);
  });

  it("giữ nguyên bias null-prev cho side khác dù cùng symbol", () => {
    const prev = new Map([["MMT|gainer", "exhaustion"]]);
    const [entry] = buildBiasLogRows([{ side: "unusual", snapshot: snapshot([row()]) }], AT, prev);
    expect(entry.prevBias).toBeNull();
    expect(entry.biasChanged).toBe(false);
  });

  it("bỏ row giá không hợp lệ thay vì ghi NaN vào bảng", () => {
    const rows = buildBiasLogRows(
      [{ side: "gainer", snapshot: snapshot([row({ price: 0 }), row({ symbol: "BREV" })]) }],
      AT
    );
    expect(rows.map((entry) => entry.symbol)).toEqual(["BREV"]);
  });

  it("dueHorizons mở dần theo tuổi của row", () => {
    const at = AT.getTime();
    const hours = (value: number) => at + value * 3_600_000;

    expect(dueHorizons(at, hours(0.5))).toEqual([]);
    expect(dueHorizons(at, hours(1))).toEqual(["1h"]);
    expect(dueHorizons(at, hours(5))).toEqual(["1h", "4h"]);
    expect(dueHorizons(at, hours(25))).toEqual(["1h", "4h", "24h"]);
    expect(dueHorizons(at, hours(80))).toEqual(["1h", "4h", "24h", "3d"]);
    expect(dueHorizons(at, hours(24 * 8))).toEqual(["1h", "4h", "24h", "3d", "7d"]);
    expect(dueHorizons(Number.NaN, hours(24))).toEqual([]);
  });
});
